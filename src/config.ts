import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProfileSortOrder } from "./types.js";

export const EXTENSION_NAME = "pi-model-profiles";

export { ProfileSortOrder as SortOrder } from "./types.js";

export interface ProfilesConfig {
	/** Enable automatic saving of profiles on changes (default: true) */
	autoSave: boolean;
	/** Maximum number of profiles to retain (default: 100, min: 1, max: 1000) */
	maxProfiles: number;
}

export interface SortingConfig {
	/** Default sort order for profile list (default: 'date-desc') */
	defaultSort: ProfileSortOrder;
}

export interface MultiProfilesConfig {
	/** Enable debug logging (default: false) */
	debug: boolean;
	/** Profile storage configuration */
	profiles: ProfilesConfig;
	/** Sorting configuration */
	sorting: SortingConfig;
}

export interface MultiProfilesConfigLoadResult {
	config: MultiProfilesConfig;
	created: boolean;
	warning?: string;
}

export const DEFAULT_PROFILES_CONFIG: ProfilesConfig = {
	autoSave: true,
	maxProfiles: 100,
};

export const DEFAULT_SORTING_CONFIG: SortingConfig = {
	defaultSort: "date-desc" as ProfileSortOrder,
};

export const DEFAULT_MULTI_PROFILES_CONFIG: MultiProfilesConfig = {
	debug: false,
	profiles: { ...DEFAULT_PROFILES_CONFIG },
	sorting: { ...DEFAULT_SORTING_CONFIG },
};

function cloneProfilesConfig(config: ProfilesConfig = DEFAULT_PROFILES_CONFIG): ProfilesConfig {
	return {
		autoSave: config.autoSave,
		maxProfiles: config.maxProfiles,
	};
}

function cloneSortingConfig(config: SortingConfig = DEFAULT_SORTING_CONFIG): SortingConfig {
	return {
		defaultSort: config.defaultSort,
	};
}

function cloneMultiProfilesConfig(config: MultiProfilesConfig = DEFAULT_MULTI_PROFILES_CONFIG): MultiProfilesConfig {
	return {
		debug: config.debug,
		profiles: cloneProfilesConfig(config.profiles),
		sorting: cloneSortingConfig(config.sorting),
	};
}

/**
 * Resolve the extension root directory from a module URL.
 */
export function resolveExtensionRoot(moduleUrl: string = import.meta.url): string {
	const __filename = fileURLToPath(moduleUrl);
	const __dirname = dirname(__filename);
	// Navigate up from src/ to extension root
	return dirname(__dirname);
}

export const EXTENSION_ROOT = resolveExtensionRoot();
export const CONFIG_PATH = join(EXTENSION_ROOT, "config.json");
export const DEBUG_DIR = join(EXTENSION_ROOT, "debug");
export const DEBUG_LOG_PATH = join(DEBUG_DIR, `${EXTENSION_NAME}-debug.jsonl`);

function createDefaultConfigContent(): string {
	return JSON.stringify(DEFAULT_MULTI_PROFILES_CONFIG, null, "\t");
}

function toRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function formatValue(value: unknown): string {
	if (typeof value === "string") {
		return `"${value}"`;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(formatValue).join(", ")}]`;
	}
	if (typeof value === "object") {
		return "{...}";
	}
	return String(value);
}

function createValidationWarning(path: string, reason: string, fallback: unknown): string {
	return `Config validation: '${path}' ${reason}. Using default: ${formatValue(fallback)}`;
}

function appendWarning(warnings: string[], warning: string | undefined): void {
	if (warning) {
		warnings.push(warning);
	}
}

function readBoolean(value: unknown, path: string, fallback: boolean, warnings: string[]): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	appendWarning(warnings, createValidationWarning(path, "must be a boolean", fallback));
	return fallback;
}

function readNonNegativeInteger(value: unknown, path: string, fallback: number, min: number, max: number, warnings: string[]): number {
	if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) {
		return value;
	}
	appendWarning(warnings, createValidationWarning(path, `must be an integer between ${min} and ${max}`, fallback));
	return fallback;
}

function readStringEnum<T extends string>(value: unknown, path: string, validValues: readonly T[], fallback: T, warnings: string[]): T {
	if (typeof value === "string" && (validValues as readonly string[]).includes(value)) {
		return value as T;
	}
	appendWarning(warnings, createValidationWarning(path, `must be one of: ${validValues.join(", ")}`, fallback));
	return fallback;
}

function normalizeProfilesConfig(value: unknown, warnings: string[]): ProfilesConfig {
	const obj = toRecord(value);
	const autoSave = readBoolean(obj.autoSave, "profiles.autoSave", DEFAULT_PROFILES_CONFIG.autoSave, warnings);
	const maxProfiles = readNonNegativeInteger(
		obj.maxProfiles,
		"profiles.maxProfiles",
		DEFAULT_PROFILES_CONFIG.maxProfiles,
		1,
		1000,
		warnings,
	);
	return { autoSave, maxProfiles };
}

function normalizeSortingConfig(value: unknown, warnings: string[]): SortingConfig {
	const obj = toRecord(value);
	const validSortOrders: ProfileSortOrder[] = ["name-asc", "name-desc", "date-asc", "date-desc"];
	const defaultSort = readStringEnum<ProfileSortOrder>(
		obj.defaultSort,
		"sorting.defaultSort",
		validSortOrders,
		DEFAULT_SORTING_CONFIG.defaultSort,
		warnings,
	);
	return { defaultSort };
}

function normalizeConfig(raw: unknown): { config: MultiProfilesConfig; warnings: string[] } {
	const warnings: string[] = [];
	const obj = toRecord(raw);

	const debug = readBoolean(obj.debug, "debug", DEFAULT_MULTI_PROFILES_CONFIG.debug, warnings);
	const profiles = normalizeProfilesConfig(obj.profiles, warnings);
	const sorting = normalizeSortingConfig(obj.sorting, warnings);

	return {
		config: { debug, profiles, sorting },
		warnings,
	};
}

function joinWarnings(warnings: Array<string | undefined>): string | undefined {
	const filtered = warnings.filter((w): w is string => w !== undefined);
	return filtered.length > 0 ? filtered.join("\n") : undefined;
}

function ensureConfigDirectory(configPath: string): void {
	const configDir = dirname(configPath);
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}
}

export function ensureMultiProfilesConfig(configPath: string = CONFIG_PATH): { created: boolean; warning?: string } {
	if (existsSync(configPath)) {
		return { created: false };
	}

	ensureConfigDirectory(configPath);
	writeFileSync(configPath, createDefaultConfigContent(), "utf-8");
	return { created: true };
}

export function loadMultiProfilesConfig(configPath: string = CONFIG_PATH): MultiProfilesConfigLoadResult {
	const created = ensureMultiProfilesConfig(configPath);

	try {
		const content = readFileSync(configPath, "utf-8");
		const raw = JSON.parse(content) as unknown;
		const { config, warnings } = normalizeConfig(raw);
		const warning = joinWarnings(warnings);

		return { config, created: created.created, warning };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			config: cloneMultiProfilesConfig(DEFAULT_MULTI_PROFILES_CONFIG),
			created: created.created,
			warning: `Failed to parse config.json: ${message}. Using defaults.`,
		};
	}
}

export function saveMultiProfilesConfig(config: MultiProfilesConfig, configPath: string = CONFIG_PATH): void {
	ensureConfigDirectory(configPath);
	writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");
}

export function ensureMultiProfilesDebugDirectory(debugDir: string = DEBUG_DIR): string | undefined {
	try {
		if (!existsSync(debugDir)) {
			mkdirSync(debugDir, { recursive: true });
		}
		return debugDir;
	} catch {
		return undefined;
	}
}
