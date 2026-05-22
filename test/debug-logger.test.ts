import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AsyncBufferedLogWriter } from "../src/debug-logger.js";

function createWriterFixture() {
	const root = mkdtempSync(join(tmpdir(), "pi-model-profiles-debug-"));
	const debugDir = join(root, "debug");
	const logPath = join(debugDir, "debug.log");
	return {
		root,
		debugDir,
		logPath,
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test("async buffered log writer enforces buffer limits and preserves newest entries", async () => {
	const fixture = createWriterFixture();
	const writer = new AsyncBufferedLogWriter({
		enabled: true,
		logPath: fixture.logPath,
		ensureDirectory: () => {
			mkdirSync(fixture.debugDir, { recursive: true });
			return fixture.debugDir;
		},
		flushIntervalMs: 60_000,
		flushEntryLimit: 100,
		maxBufferedEntries: 2,
		createDroppedEntriesLine: (count) => `dropped:${count}\n`,
	});

	try {
		writer.writeLine("one");
		writer.writeLine("two");
		writer.writeLine("three");
		writer.writeLine("four");

		await Promise.all([writer.flush(), writer.flush()]);
		const log = readFileSync(fixture.logPath, "utf-8");
		assert.equal(log, "dropped:2\nthree\nfour\n");
	} finally {
		await writer.dispose();
		fixture.cleanup();
	}
});

test("async buffered log writer unrefs timers and removes exact lifecycle hook", async () => {
	const fixture = createWriterFixture();
	const beforeExitListeners = process.listenerCount("beforeExit");
	const exitListeners = process.listenerCount("exit");
	const sigintListeners = process.listenerCount("SIGINT");
	const sigtermListeners = process.listenerCount("SIGTERM");
	const writer = new AsyncBufferedLogWriter({
		enabled: true,
		logPath: fixture.logPath,
		ensureDirectory: () => {
			mkdirSync(fixture.debugDir, { recursive: true });
			return fixture.debugDir;
		},
		flushIntervalMs: 60_000,
		flushEntryLimit: 100,
	});

	try {
		writer.writeLine("scheduled");
		const timer = (writer as unknown as { flushTimer: { hasRef?: () => boolean } | null }).flushTimer;
		assert.notEqual(timer, null);
		if (typeof timer?.hasRef === "function") {
			assert.equal(timer.hasRef(), false);
		}
		assert.equal(process.listenerCount("beforeExit"), beforeExitListeners + 1);
		assert.equal(process.listenerCount("exit"), exitListeners);
		assert.equal(process.listenerCount("SIGINT"), sigintListeners);
		assert.equal(process.listenerCount("SIGTERM"), sigtermListeners);

		await writer.dispose();
		assert.equal(process.listenerCount("beforeExit"), beforeExitListeners);
	} finally {
		await writer.dispose();
		fixture.cleanup();
	}
});
