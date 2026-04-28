import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { CONFIG_PATH, DEBUG_DIR, DEBUG_LOG_PATH, EXTENSION_ROOT } from "./config.js";

export const EXTENSION_NAME = "pi-model-profiles";
export const COMMAND_NAME = "model-profiles";
export const PROFILE_STORE_VERSION = 2 as const;
export const PROFILE_NAME_SUFFIX = "snapshot";
export const LEGACY_PROFILE_NAME_SUFFIX = "profile";
export const INITIAL_PROFILE_NAME = "Current agents snapshot";
const AGENT_DIR = getAgentDir();

export const AGENTS_DIR = join(AGENT_DIR, "agents");
export const THEMES_DIR = join(AGENT_DIR, "themes");
export const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
export const PROFILE_STORE_PATH = join(AGENT_DIR, "extensions", EXTENSION_NAME, "profiles.json");

// Re-export config paths for convenience
export { CONFIG_PATH, DEBUG_DIR, DEBUG_LOG_PATH, EXTENSION_ROOT };
export function resolveModalOverlayOptions(maxContentWidth: number): {
	anchor: "center";
	width: number;
	maxHeight: number;
	margin: number;
} {
	const terminalWidth =
		typeof process.stdout.columns === "number" && Number.isFinite(process.stdout.columns)
			? process.stdout.columns
			: MODAL_MAX_WIDTH;
	const terminalHeight =
		typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows)
			? process.stdout.rows
			: 36;
	const margin = 1;
	const availableWidth = Math.max(24, terminalWidth - margin * 2);
	const preferredWidth = calculateModalWidth(maxContentWidth);
	const minimumWidth = Math.min(MODAL_MIN_WIDTH, availableWidth);
	const width = Math.max(minimumWidth, Math.min(preferredWidth, availableWidth));
	const availableHeight = Math.max(10, terminalHeight - margin * 2);
	const preferredHeight = Math.max(10, Math.floor(terminalHeight * 0.9));
	const maxHeight = Math.min(preferredHeight, availableHeight);

	return {
		anchor: "center",
		width,
		maxHeight,
		margin,
	};
}

/**
 * Minimum modal height in rows
 */
export const MODAL_MIN_HEIGHT = 20;

/**
 * Base height for modal (header, footer, padding)
 */
export const MODAL_BASE_HEIGHT = 10;

/**
 * Rows per agent in the details panel
 */
export const MODAL_ROWS_PER_AGENT = 3;

/**
 * Calculate dynamic modal height based on agent count.
 * Formula: base height (10) + (agentCount * 3) clamped to min 20, max 90% of terminal
 */
export function calculateModalHeight(agentCount: number): number {
	const terminalHeight = process.stdout.rows || 24;
	const maxAllowedHeight = Math.floor(terminalHeight * 0.9);
	const calculatedHeight = MODAL_BASE_HEIGHT + agentCount * MODAL_ROWS_PER_AGENT;
	return Math.max(MODAL_MIN_HEIGHT, Math.min(calculatedHeight, maxAllowedHeight));
}

/**
 * Minimum modal width in columns
 */
export const MODAL_MIN_WIDTH = 80;

/**
 * Maximum modal width in columns
 */
export const MODAL_MAX_WIDTH = 140;

/**
 * Base width for modal (borders, padding, labels)
 */
export const MODAL_BASE_WIDTH = 80;

/**
 * Calculate dynamic modal width based on content.
 * Formula: base width (80) + maxAgentNameLength clamped to min 80, max 140
 */
export function calculateModalWidth(maxAgentNameLength: number): number {
	const calculatedWidth = MODAL_BASE_WIDTH + maxAgentNameLength;
	return Math.max(MODAL_MIN_WIDTH, Math.min(calculatedWidth, MODAL_MAX_WIDTH));
}
