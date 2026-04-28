import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SETTINGS_PATH, THEMES_DIR } from "./constants.js";

interface ThemeLike {
	name?: unknown;
	fg?: unknown;
	bold?: unknown;
}

interface RawThemeFile {
	name?: unknown;
	vars?: unknown;
	colors?: unknown;
	export?: unknown;
}

type ModalThemeSlot =
	| "text"
	| "accent"
	| "muted"
	| "dim"
	| "success"
	| "warning"
	| "error"
	| "border"
	| "borderMuted"
	| "selectedText"
	| "selectedBg"
	| "panelBg";

interface ModalThemePalette {
	text?: string;
	accent?: string;
	muted?: string;
	dim?: string;
	success?: string;
	warning?: string;
	error?: string;
	border?: string;
	borderMuted?: string;
	selectedText?: string;
	selectedBg?: string;
	panelBg?: string;
}

interface ThemeSourceMaps {
	vars: Record<string, unknown>;
	colors: Record<string, unknown>;
	export: Record<string, unknown>;
}

export interface ResolvedModalTheme {
	name: string;
	warnings: string[];
	color(slot: ModalThemeSlot, text: string, options?: { background?: ModalThemeSlot; bold?: boolean }): string;
	bold(text: string): string;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const NAMED_COLOR_CODES: Record<string, number> = {
	black: 16,
	white: 255,
	red: 196,
	green: 46,
	blue: 45,
	yellow: 226,
	cyan: 51,
	magenta: 201,
	gray: 245,
	grey: 245,
	orange: 166,
	darkGray: 239,
	amber: 208,
};

// Box-drawing characters for TUI borders
export const BOX = {
	CORNER_TL: "╭",
	CORNER_TR: "╮",
	CORNER_BL: "╰",
	CORNER_BR: "╯",
	H_LINE: "─",
	V_LINE: "│",
	T_DOWN: "├",
	T_UP: "┤",
	T_RIGHT: "├",
	T_LEFT: "┤",
	CROSS: "┼",
} as const;

function toRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeThemeName(theme: ThemeLike): string {
	return normalizeOptionalString(theme.name) ?? "current";
}

function expandHexColor(value: string): string | undefined {
	const trimmed = value.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
		return trimmed;
	}
	if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
		const [red, green, blue] = trimmed.slice(1).split("");
		return `#${red}${red}${green}${green}${blue}${blue}`;
	}
	return undefined;
}

function resolveThemeReference(reference: string, source: ThemeSourceMaps, visited: Set<string>): string | undefined {
	const directHex = expandHexColor(reference);
	if (directHex) {
		return directHex;
	}

	const normalizedName = reference.trim();
	if (!normalizedName) {
		return undefined;
	}

	const lowerName = normalizedName.toLowerCase();
	if (NAMED_COLOR_CODES[lowerName] !== undefined) {
		return lowerName;
	}

	if (visited.has(normalizedName)) {
		return undefined;
	}
	visited.add(normalizedName);

	const chained =
		normalizeOptionalString(source.vars[normalizedName])
		?? normalizeOptionalString(source.colors[normalizedName])
		?? normalizeOptionalString(source.export[normalizedName]);
	if (!chained) {
		return undefined;
	}

	return resolveThemeReference(chained, source, visited);
}

function toAnsiForeground(color: string): string {
	const hex = expandHexColor(color);
	if (hex) {
		const red = Number.parseInt(hex.slice(1, 3), 16);
		const green = Number.parseInt(hex.slice(3, 5), 16);
		const blue = Number.parseInt(hex.slice(5, 7), 16);
		return `\x1b[38;2;${red};${green};${blue}m`;
	}

	const code = NAMED_COLOR_CODES[color.toLowerCase()] ?? NAMED_COLOR_CODES.white;
	return `\x1b[38;5;${code}m`;
}

function toAnsiBackground(color: string): string {
	const hex = expandHexColor(color);
	if (hex) {
		const red = Number.parseInt(hex.slice(1, 3), 16);
		const green = Number.parseInt(hex.slice(3, 5), 16);
		const blue = Number.parseInt(hex.slice(5, 7), 16);
		return `\x1b[48;2;${red};${green};${blue}m`;
	}

	const code = NAMED_COLOR_CODES[color.toLowerCase()] ?? NAMED_COLOR_CODES.black;
	return `\x1b[48;5;${code}m`;
}

function formatWithFallback(theme: ThemeLike, colorName: string, text: string): string {
	try {
		if (typeof theme.fg === "function") {
			const formatter = theme.fg as (resolvedColor: string, value: string) => string;
			return formatter(colorName, text);
		}
	} catch {
		// Fall back to plain text.
	}
	return text;
}

function formatBold(theme: ThemeLike, text: string): string {
	try {
		if (typeof theme.bold === "function") {
			const formatter = theme.bold as (value: string) => string;
			return formatter(text);
		}
	} catch {
		// Fall back to ANSI bold below.
	}
	return `${ANSI_BOLD}${text}${ANSI_RESET}`;
}

function loadSelectedThemeName(settingsPath: string, warnings: string[]): string | undefined {
	if (!existsSync(settingsPath)) {
		return undefined;
	}

	try {
		const raw = readFileSync(settingsPath, "utf-8");
		const parsed = toRecord(JSON.parse(raw) as unknown);
		return normalizeOptionalString(parsed.theme);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Failed to read model profiles theme settings from '${settingsPath}': ${message}`);
		return undefined;
	}
}

function loadThemePalette(themeName: string | undefined, themesDir: string, warnings: string[]): { name: string; palette: ModalThemePalette } {
	const fallbackName = themeName ?? "current";
	if (!themeName) {
		return { name: fallbackName, palette: {} };
	}

	const candidatePath = join(themesDir, themeName.endsWith(".json") ? themeName : `${themeName}.json`);
	if (!existsSync(candidatePath)) {
		warnings.push(`Theme '${themeName}' was not found in '${themesDir}'. Falling back to the active Pi theme.`);
		return { name: fallbackName, palette: {} };
	}

	try {
		const rawTheme = JSON.parse(readFileSync(candidatePath, "utf-8")) as RawThemeFile;
		const source: ThemeSourceMaps = {
			vars: toRecord(rawTheme.vars),
			colors: toRecord(rawTheme.colors),
			export: toRecord(rawTheme.export),
		};
		const resolveColor = (key: string, fallbackKey?: string): string | undefined => {
			const direct = normalizeOptionalString(source.colors[key]) ?? normalizeOptionalString(source.export[key]);
			if (direct) {
				return resolveThemeReference(direct, source, new Set<string>());
			}

			if (!fallbackKey) {
				return undefined;
			}
			const fallback = normalizeOptionalString(source.colors[fallbackKey]) ?? normalizeOptionalString(source.export[fallbackKey]);
			return fallback ? resolveThemeReference(fallback, source, new Set<string>()) : undefined;
		};

		return {
			name: normalizeOptionalString(rawTheme.name) ?? themeName,
			palette: {
				text: resolveColor("text"),
				accent: resolveColor("accent"),
				muted: resolveColor("muted"),
				dim: resolveColor("dim"),
				success: resolveColor("success"),
				warning: resolveColor("warning"),
				error: resolveColor("error"),
				border: resolveColor("border", "borderAccent"),
				borderMuted: resolveColor("borderMuted", "border"),
				selectedText: resolveColor("text"),
				selectedBg: resolveColor("selectedBg") ?? resolveColor("customMessageBg") ?? resolveColor("borderMuted") ?? resolveColor("accent"),
				panelBg: resolveColor("cardBg") ?? resolveColor("customMessageBg") ?? resolveColor("userMessageBg"),
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Failed to parse theme '${themeName}': ${message}. Falling back to the active Pi theme.`);
		return { name: fallbackName, palette: {} };
	}
}

function applyAnsi(text: string, foreground: string | undefined, background: string | undefined, bold: boolean): string {
	const prefix = `${bold ? ANSI_BOLD : ""}${foreground ?? ""}${background ?? ""}`;
	if (!prefix) {
		return text;
	}
	return `${prefix}${text}${ANSI_RESET}`;
}

export function loadModalTheme(
	theme: ThemeLike,
	options: { settingsPath?: string; themesDir?: string } = {},
): ResolvedModalTheme {
	const warnings: string[] = [];
	const settingsPath = options.settingsPath ?? SETTINGS_PATH;
	const themesDir = options.themesDir ?? THEMES_DIR;
	const selectedThemeName = loadSelectedThemeName(settingsPath, warnings);
	const resolvedPalette = loadThemePalette(selectedThemeName, themesDir, warnings);
	const palette = resolvedPalette.palette;
	const fallbackSlotMap: Record<ModalThemeSlot, string> = {
		text: "fg",
		accent: "accent",
		muted: "muted",
		dim: "dim",
		success: "success",
		warning: "warning",
		error: "error",
		border: "border",
		borderMuted: "borderMuted",
		selectedText: "fg",
		selectedBg: "accent",
		panelBg: "bg",
	};

	return {
		name: resolvedPalette.name || normalizeThemeName(theme),
		warnings,
		color(slot, text, options = {}) {
			const foregroundColor = palette[slot];
			const backgroundColor = options.background ? palette[options.background] : undefined;
			if (foregroundColor || backgroundColor) {
				return applyAnsi(
					text,
					foregroundColor ? toAnsiForeground(foregroundColor) : undefined,
					backgroundColor ? toAnsiBackground(backgroundColor) : undefined,
					options.bold === true,
				);
			}

			const fallbackText = options.bold ? formatBold(theme, text) : text;
			return formatWithFallback(theme, fallbackSlotMap[slot], fallbackText);
		},
		bold(text) {
			return formatBold(theme, text);
		},
	};
}
