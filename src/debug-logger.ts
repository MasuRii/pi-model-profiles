import { appendFile, chmod } from "node:fs/promises";
import {
	CONFIG_PATH,
	DEBUG_DIR,
	DEBUG_LOG_PATH,
	EXTENSION_NAME,
	ensureMultiProfilesDebugDirectory,
	loadMultiProfilesConfig,
} from "./config.js";

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_FLUSH_ENTRY_LIMIT = 100;
const DEFAULT_FLUSH_BYTE_LIMIT = 50 * 1024;
const DEFAULT_MAX_BUFFERED_ENTRIES = 1_000;
const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;

export interface MultiProfilesDebugLoggerOptions {
	configPath?: string;
	debugDir?: string;
	logPath?: string;
}

function safeJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, currentValue) => {
		if (currentValue instanceof Error) {
			return {
				name: currentValue.name,
				message: currentValue.message,
				stack: currentValue.stack,
			};
		}

		if (typeof currentValue === "bigint") {
			return currentValue.toString();
		}

		if (typeof currentValue === "object" && currentValue !== null) {
			if (seen.has(currentValue)) {
				return "[Circular]";
			}
			seen.add(currentValue);
		}

		return currentValue;
	});
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return fallback;
}

export interface AsyncBufferedLogWriterOptions {
	enabled: boolean;
	logPath: string;
	ensureDirectory: () => string | undefined;
	flushIntervalMs?: number;
	flushEntryLimit?: number;
	flushByteLimit?: number;
	maxBufferedEntries?: number;
	maxBufferedBytes?: number;
	createDroppedEntriesLine?: (droppedEntries: number) => string;
}

export class AsyncBufferedLogWriter {
	private readonly flushIntervalMs: number;
	private readonly flushEntryLimit: number;
	private readonly flushByteLimit: number;
	private readonly maxBufferedEntries: number;
	private readonly maxBufferedBytes: number;
	private readonly createDroppedEntriesLine?: (droppedEntries: number) => string;
	private readonly lines: string[] = [];
	private enabled: boolean;
	private bufferedBytes = 0;
	private droppedEntries = 0;
	private directoryReady = false;
	private initializationError: string | undefined;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushPromise: Promise<void> | null = null;
	private flushRequestedWhileBusy = false;
	private shutdownHooksRegistered = false;

	constructor(private readonly options: AsyncBufferedLogWriterOptions) {
		this.enabled = options.enabled;
		this.flushIntervalMs = normalizePositiveInteger(
			options.flushIntervalMs,
			DEFAULT_FLUSH_INTERVAL_MS,
		);
		this.flushEntryLimit = normalizePositiveInteger(
			options.flushEntryLimit,
			DEFAULT_FLUSH_ENTRY_LIMIT,
		);
		this.flushByteLimit = normalizePositiveInteger(
			options.flushByteLimit,
			DEFAULT_FLUSH_BYTE_LIMIT,
		);
		this.maxBufferedEntries = Math.max(
			this.flushEntryLimit,
			normalizePositiveInteger(options.maxBufferedEntries, DEFAULT_MAX_BUFFERED_ENTRIES),
		);
		this.maxBufferedBytes = Math.max(
			this.flushByteLimit,
			normalizePositiveInteger(options.maxBufferedBytes, DEFAULT_MAX_BUFFERED_BYTES),
		);
		this.createDroppedEntriesLine = options.createDroppedEntriesLine;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) {
			return;
		}

		this.enabled = enabled;
		if (!enabled) {
			this.clearBuffer();
		}
	}

	writeLine(line: string): string | undefined {
		if (!this.enabled) {
			return undefined;
		}

		const directoryError = this.ensureReady();
		if (directoryError) {
			return directoryError;
		}

		this.registerShutdownHooks();
		this.pushLine(line);
		if (
			this.lines.length >= this.flushEntryLimit ||
			this.bufferedBytes >= this.flushByteLimit
		) {
			void this.flush();
		} else {
			this.scheduleFlush();
		}
		return undefined;
	}

	async flush(): Promise<void> {
		if (!this.enabled || this.lines.length === 0) {
			return;
		}

		if (this.flushPromise) {
			this.flushRequestedWhileBusy = true;
			await this.flushPromise;
			return;
		}

		this.clearFlushTimer();

		const linesToFlush = [...this.lines];
		const droppedEntries = this.droppedEntries;
		this.clearBuffer();

		this.flushPromise = this.performFlush(linesToFlush, droppedEntries);
		try {
			await this.flushPromise;
		} finally {
			this.flushPromise = null;
			if (this.flushRequestedWhileBusy) {
				this.flushRequestedWhileBusy = false;
				void this.flush();
			}
		}
	}

	private ensureReady(): string | undefined {
		if (this.directoryReady) {
			return undefined;
		}

		if (this.initializationError) {
			return this.initializationError;
		}

		try {
			const result = this.options.ensureDirectory();
			if (!result) {
				this.initializationError = "Debug directory could not be created or accessed.";
				return this.initializationError;
			}
			this.directoryReady = true;
			return undefined;
		} catch (error) {
			this.initializationError =
				error instanceof Error ? error.message : "Failed to initialize debug directory.";
			return this.initializationError;
		}
	}

	private pushLine(line: string): void {
		const lineBytes = Buffer.byteLength(line, "utf-8");

		if (
			this.lines.length >= this.maxBufferedEntries ||
			this.bufferedBytes + lineBytes > this.maxBufferedBytes
		) {
			this.droppedEntries++;
			return;
		}

		this.lines.push(line);
		this.bufferedBytes += lineBytes;
	}

	private clearBuffer(): void {
		this.lines.length = 0;
		this.bufferedBytes = 0;
		this.droppedEntries = 0;
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			return;
		}

		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, this.flushIntervalMs);
	}

	private clearFlushTimer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private async performFlush(lines: string[], droppedEntries: number): Promise<void> {
		let content = lines.join("");

		if (droppedEntries > 0 && this.createDroppedEntriesLine) {
			const droppedLine = this.createDroppedEntriesLine(droppedEntries);
			content = droppedLine + content;
		}

		try {
			await appendFile(this.options.logPath, content, "utf-8");
			if (process.platform !== "win32") {
				await chmod(this.options.logPath, 0o600);
			}
		} catch (error) {
			this.initializationError =
				error instanceof Error ? error.message : "Failed to write debug log.";
			this.directoryReady = false;
		}
	}

	private registerShutdownHooks(): void {
		if (this.shutdownHooksRegistered) {
			return;
		}

		this.shutdownHooksRegistered = true;

		const flushAndExit = async (signal: string): Promise<void> => {
			try {
				await this.flush();
			} finally {
				process.removeListener(signal, flushAndExit as never);
			}
		};

		process.on("exit", () => {
			try {
				const flushResult = this.flush();
				if (flushResult && typeof flushResult.then === "function") {
					flushResult.catch(() => {
						// Ignore flush errors on exit
					});
				}
			} catch {
				// Ignore sync flush errors on exit
			}
		});

		process.on("beforeExit", () => {
			void this.flush();
		});

		process.on("SIGINT", () => {
			void flushAndExit("SIGINT");
		});

		process.on("SIGTERM", () => {
			void flushAndExit("SIGTERM");
		});
	}
}

export class MultiProfilesDebugLogger {
	private initialized = false;
	private readonly writer: AsyncBufferedLogWriter;

	constructor(private readonly options: MultiProfilesDebugLoggerOptions = {}) {
		this.writer = new AsyncBufferedLogWriter({
			enabled: false,
			logPath: this.options.logPath ?? DEBUG_LOG_PATH,
			ensureDirectory: () => ensureMultiProfilesDebugDirectory(this.options.debugDir ?? DEBUG_DIR),
			createDroppedEntriesLine: (droppedEntries) =>
				`${safeJsonStringify({
					timestamp: new Date().toISOString(),
					level: "warn",
					extension: EXTENSION_NAME,
					event: "debug_log_overflow",
					droppedEntries,
				})}\n`,
		});
	}

	private initialize(): void {
		if (this.initialized) {
			return;
		}

		this.initialized = true;
		const configResult = loadMultiProfilesConfig(this.options.configPath ?? CONFIG_PATH);
		this.writer.setEnabled(configResult.config.debug);
	}

	log(event: string, payload: Record<string, unknown> = {}): void {
		try {
			this.initialize();
			this.writer.writeLine(
				`${safeJsonStringify({
					timestamp: new Date().toISOString(),
					level: "debug",
					extension: EXTENSION_NAME,
					event,
					...payload,
				})}\n`,
			);
		} catch {
			// Debug log failures must never affect extension functionality.
		}
	}

	flush(): Promise<void> {
		return this.writer.flush();
	}
}

export const multiProfilesDebugLogger = new MultiProfilesDebugLogger();
