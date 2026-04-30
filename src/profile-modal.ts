import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { MODAL_MIN_HEIGHT, calculateModalHeight, resolveModalOverlayOptions } from "./constants.js";
import { toErrorMessage } from "./errors.js";
import { loadModalTheme, BOX, type ResolvedModalTheme } from "./modal-theme.js";
import { formatProfileFieldValue } from "./profile-fields.js";
import { getAvailableSortOrders, getCurrentSortOrder, persistSortOrder, sortProfiles } from "./profile-sort-service.js";
import type { AppliedProfileOutcome, ProfileSortOrder, ProfilesFile, SavedProfile, SavedProfileAgent } from "./types.js";

interface ThemeLike {
	name?: unknown;
	fg?: unknown;
	bold?: unknown;
}

interface ModalMessage {
	text: string;
	level: "info" | "warning" | "error";
}

interface ProfileModalMutationResult {
	data: ProfilesFile;
	message: string;
	selectedProfileId?: string;
}

interface ProfileModalActions {
	renameProfile(profileId: string, nextName: string): Promise<ProfileModalMutationResult>;
	addCurrentProfile(): Promise<ProfileModalMutationResult>;
	applyProfile(profileId: string): Promise<AppliedProfileOutcome>;
	removeProfile(profileId: string): Promise<ProfileModalMutationResult>;
	updateProfile(profileId: string): Promise<ProfileModalMutationResult>;
}

interface SortMenuOption {
	order: ProfileSortOrder;
	label: string;
	isSelected: boolean;
}

export type ProfileModalResult =
	| { type: "closed" }
	| {
			type: "applied";
			outcome: AppliedProfileOutcome;
	  };

type ConfirmationAction = "remove" | "update";

interface ConfirmationState {
	action: ConfirmationAction;
	profileId: string;
	prompt: string;
	input: Input;
}

interface ConfirmationRequest {
	action: ConfirmationAction;
	profile: SavedProfile;
	prompt: string;
	busyMessage: string;
	onConfirm(profileId: string): Promise<void>;
}

interface TableColumnLayout {
	agent: number;
	model: number;
	temp: number;
	reasoning: number;
	reasoningHeader: string;
	gap: string;
}

const MODAL_FALLBACK_VIEWPORT = 10;
const SNAPSHOT_TITLE = "SNAPSHOTS";
const DETAILS_TITLE = "DETAILS";
const ACTIVE_PANE_LABEL = "[ACTIVE]";
const EMPTY_PROFILE_HINT = "No saved snapshots yet.";
const EMPTY_DETAILS_HINT = "Select a snapshot to inspect its saved agent models.";
const ABSENT_DISPLAY_VALUE = "absent";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "short",
		timeStyle: "short",
	}).format(date);
}

function padEndToWidth(text: string, width: number): string {
	const safeWidth = Math.max(0, width);
	const padding = Math.max(0, safeWidth - visibleWidth(text));
	return `${text}${" ".repeat(padding)}`;
}

function fitText(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	return padEndToWidth(truncateToWidth(text, safeWidth, "…", true), safeWidth);
}

function centerText(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = truncateToWidth(text, safeWidth, "…", true);
	const remaining = Math.max(0, safeWidth - visibleWidth(clipped));
	const left = Math.floor(remaining / 2);
	const right = remaining - left;
	return `${" ".repeat(left)}${clipped}${" ".repeat(right)}`;
}

function alignRight(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = truncateToWidth(text, safeWidth, "…", true);
	const padding = Math.max(0, safeWidth - visibleWidth(clipped));
	return `${" ".repeat(padding)}${clipped}`;
}

function fitLineToWidth(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	if (visibleWidth(text) > safeWidth) {
		return truncateToWidth(text, safeWidth, "…", true);
	}
	return padEndToWidth(text, safeWidth);
}

function centerLineInWidth(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = visibleWidth(text) > safeWidth ? truncateToWidth(text, safeWidth, "…", true) : text;
	const padding = Math.max(0, Math.floor((safeWidth - visibleWidth(clipped)) / 2));
	return fitLineToWidth(`${" ".repeat(padding)}${clipped}`, safeWidth);
}

function splitGridCellWidths(innerWidth: number, snapshotNameWidth: number): { left: number; right: number } {
	const safeWidth = Math.max(3, innerWidth);
	const minRight = Math.min(24, Math.max(1, safeWidth - 25));
	const maxLeft = Math.max(1, safeWidth - minRight - 1);
	const minLeft = Math.min(maxLeft, Math.max(1, Math.min(28, Math.floor(safeWidth * 0.35))));
	const preferredLeft = clamp(snapshotNameWidth + 6, 28, 32);
	const left = clamp(preferredLeft, minLeft, maxLeft);
	const right = Math.max(1, safeWidth - left - 1);
	return { left, right };
}

function wrapText(text: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const normalized = text.trim();
	if (!normalized) {
		return [""];
	}

	const words = normalized.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) <= safeWidth) {
			current = candidate;
			continue;
		}

		if (current) {
			lines.push(current);
			current = "";
		}

		if (visibleWidth(word) <= safeWidth) {
			current = word;
			continue;
		}

		let remainder = word;
		while (visibleWidth(remainder) > safeWidth) {
			lines.push(truncateToWidth(remainder, safeWidth, "", false));
			remainder = remainder.slice(Math.max(1, safeWidth));
		}
		current = remainder;
	}

	if (current) {
		lines.push(current);
	}

	return lines.length > 0 ? lines : [""];
}

function colorFrameBorder(theme: ResolvedModalTheme, text: string): string {
	return theme.color("accent", text);
}

function buildTopBorder(theme: ResolvedModalTheme, innerWidth: number): string {
	return colorFrameBorder(theme, `${BOX.CORNER_TL}${BOX.H_LINE.repeat(innerWidth)}${BOX.CORNER_TR}`);
}

function buildBottomBorder(theme: ResolvedModalTheme, innerWidth: number): string {
	return colorFrameBorder(theme, `${BOX.CORNER_BL}${BOX.H_LINE.repeat(innerWidth)}${BOX.CORNER_BR}`);
}

function buildGridSeparator(theme: ResolvedModalTheme, leftWidth: number, rightWidth: number, join: "┬" | "┼" | "┴"): string {
	return colorFrameBorder(theme, `${BOX.T_RIGHT}${BOX.H_LINE.repeat(leftWidth)}${join}${BOX.H_LINE.repeat(rightWidth)}${BOX.T_LEFT}`);
}

function buildFullWidthRow(theme: ResolvedModalTheme, innerWidth: number, content: string): string {
	return `${colorFrameBorder(theme, BOX.V_LINE)}${fitText(content, innerWidth)}${colorFrameBorder(theme, BOX.V_LINE)}`;
}

function buildGridRow(theme: ResolvedModalTheme, leftWidth: number, rightWidth: number, left: string, right: string): string {
	return `${colorFrameBorder(theme, BOX.V_LINE)}${fitText(left, leftWidth)}${colorFrameBorder(theme, BOX.V_LINE)}${fitText(right, rightWidth)}${colorFrameBorder(theme, BOX.V_LINE)}`;
}

function buildModalTitleLine(theme: ResolvedModalTheme, innerWidth: number): string {
	const title = "  MODEL PROFILES";
	const close = "[Esc] Close";
	const gap = " ".repeat(Math.max(1, innerWidth - visibleWidth(title) - visibleWidth(close)));
	return `${theme.color("accent", title, { bold: true })}${gap}${theme.color("dim", close)}`;
}

function buildPaneTitleLine(theme: ResolvedModalTheme, title: string, active: boolean, suffix: string | null, width: number): string {
	const activeLabel = active ? ` ${ACTIVE_PANE_LABEL}` : "";
	const suffixLabel = suffix ? `: ${suffix}` : "";
	return theme.color(active ? "accent" : "text", fitText(`  ${title}${activeLabel}${suffixLabel}`, width), { bold: active });
}

function indentStyledLine(line: string, width: number): string {
	return fitText(`  ${line}`, width);
}

function formatDisplayedFieldValue(agent: SavedProfileAgent, key: "model" | "temperature" | "reasoningEffort"): string {
	const raw = formatProfileFieldValue(key, agent.fields);
	return raw === "(absent)" ? ABSENT_DISPLAY_VALUE : raw;
}

function formatTemperatureValue(agent: SavedProfileAgent): string {
	const value = formatDisplayedFieldValue(agent, "temperature");
	const numeric = Number(value);
	if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
		return String(numeric);
	}
	return value;
}

function formatReasoningValue(agent: SavedProfileAgent): string {
	const value = formatDisplayedFieldValue(agent, "reasoningEffort");
	const normalized = value.trim().toLowerCase();
	if (["extra-high", "extra high", "x-high", "very-high", "very high"].includes(normalized)) {
		return "xhigh";
	}
	return value;
}

function buildProfileScrollIndicator(offset: number, totalItems: number, visibleItems: number): string {
	const shownEnd = Math.min(totalItems, offset + visibleItems);
	const remainingAbove = offset;
	const remainingBelow = Math.max(0, totalItems - shownEnd);

	if (remainingAbove > 0 && remainingBelow > 0) {
		return `[↑ ${remainingAbove} | ↓ ${remainingBelow}]`;
	}
	if (remainingBelow > 0) {
		return `[↓ ${remainingBelow} more]`;
	}
	return `[↑ ${remainingAbove} above]`;
}

function buildAgentScrollIndicator(offset: number, totalItems: number, visibleItems: number): string {
	const shownEnd = Math.min(totalItems, offset + visibleItems);
	const remainingAbove = offset;
	const remainingBelow = Math.max(0, totalItems - shownEnd);

	if (remainingAbove > 0 && remainingBelow > 0) {
		return `[ ↑ ${remainingAbove} | ↓ ${remainingBelow} more ]`;
	}
	if (remainingBelow > 0) {
		return `[ ↓ Scroll (${remainingBelow} more) ]`;
	}
	return `[ ↑ Scroll (${remainingAbove} above) ]`;
}

function renderMetadataLine(theme: ResolvedModalTheme, label: string, value: string, width: number): string {
	const prefix = `${label.padEnd(9, " ")}`;
	const safeValueWidth = Math.max(1, width - visibleWidth(prefix));
	const valueText = truncateToWidth(value, safeValueWidth, "…", true);
	const trailing = " ".repeat(Math.max(0, width - visibleWidth(prefix) - visibleWidth(valueText)));
	return `${theme.color("dim", prefix)}${theme.color("text", valueText)}${trailing}`;
}

function computeProfileNameWidth(data: ProfilesFile): number {
	let maxWidth = 0;
	for (const profile of data.profiles) {
		maxWidth = Math.max(maxWidth, visibleWidth(profile.name));
	}
	return maxWidth;
}

function getMaximumContentWidth(data: ProfilesFile): number {
	let maxWidth = 8;
	for (const profile of data.profiles) {
		maxWidth = Math.max(maxWidth, visibleWidth(profile.name));
		for (const agent of profile.agents) {
			maxWidth = Math.max(maxWidth, visibleWidth(agent.agentName));
		}
	}
	return maxWidth;
}

function buildTableLayout(profile: SavedProfile, totalWidth: number): TableColumnLayout {
	const gap = "  ";
	const gapWidth = visibleWidth(gap) * 3;
	const available = Math.max(24, totalWidth - gapWidth);
	const reasoningHeader = "REASONING";

	let agent = Math.max("AGENT".length, ...profile.agents.map((entry) => visibleWidth(entry.agentName)));
	agent = clamp(agent, 10, 14);

	let temp = Math.max("TEMPERATURE".length, ...profile.agents.map((entry) => visibleWidth(formatTemperatureValue(entry))));
	temp = clamp(temp, "TEMPERATURE".length, 14);

	let reasoning = Math.max(reasoningHeader.length, ...profile.agents.map((entry) => visibleWidth(formatReasoningValue(entry))));
	reasoning = clamp(reasoning, reasoningHeader.length, 12);

	const minimumModel = 14;
	let model = available - agent - temp - reasoning;

	while (model < minimumModel && agent > 10) {
		agent -= 1;
		model += 1;
	}

	while (model < minimumModel && reasoning > reasoningHeader.length) {
		reasoning -= 1;
		model += 1;
	}

	if (model < minimumModel) {
		model = Math.max(10, model);
	}

	const totalUsed = agent + model + temp + reasoning;
	const slack = Math.max(0, available - totalUsed);
	model += slack;

	return {
		agent,
		model,
		temp,
		reasoning,
		reasoningHeader,
		gap,
	};
}

function buildTableHeaderLine(theme: ResolvedModalTheme, layout: TableColumnLayout): string {
	return [
		theme.color("accent", fitText("AGENT", layout.agent), { bold: true }),
		layout.gap,
		theme.color("accent", fitText("MODEL", layout.model), { bold: true }),
		layout.gap,
		theme.color("accent", alignRight("TEMPERATURE", layout.temp), { bold: true }),
		layout.gap,
		theme.color("accent", fitText(layout.reasoningHeader, layout.reasoning), { bold: true }),
	].join("");
}

function buildTableSeparatorLine(theme: ResolvedModalTheme, width: number): string {
	return theme.color("borderMuted", BOX.H_LINE.repeat(width));
}

function buildTableDataLine(theme: ResolvedModalTheme, layout: TableColumnLayout, agent: SavedProfileAgent): string {
	return [
		theme.color("text", fitText(agent.agentName, layout.agent)),
		layout.gap,
		theme.color("text", fitText(formatDisplayedFieldValue(agent, "model"), layout.model)),
		layout.gap,
		theme.color("text", alignRight(formatTemperatureValue(agent), layout.temp)),
		layout.gap,
		theme.color("text", fitText(formatReasoningValue(agent), layout.reasoning)),
	].join("");
}

class ProfileListModal {
	private data: ProfilesFile;
	private selectedProfileId: string | null;
	private listScrollOffset = 0;
	private detailScrollOffset = 0;
	private lastPaneContentRows = MODAL_FALLBACK_VIEWPORT;
	private renameInput: Input | null = null;
	private renameTargetId: string | null = null;
	private confirmation: ConfirmationState | null = null;
	private sortMenuOpen = false;
	private sortMenuSelectedIndex = 0;
	private message: ModalMessage | null = null;
	private busyMessage: string | null = null;
	private finished = false;
	private currentSortOrder: ProfileSortOrder;

	constructor(
		initialData: ProfilesFile,
		private readonly theme: ResolvedModalTheme,
		private readonly actions: ProfileModalActions,
		private readonly activeAgentName: string | null,
		private readonly done: (result: ProfileModalResult) => void,
		private readonly requestRender: () => void,
	) {
		this.data = initialData;
		this.currentSortOrder = getCurrentSortOrder();
		this.selectedProfileId = this.getSortedProfiles()[0]?.id ?? null;
		if (theme.warnings.length > 0) {
			this.message = { text: theme.warnings.join(" "), level: "warning" };
		}
	}

	invalidate(): void {
		// Rendering is fully state driven.
	}

	render(width: number): string[] {
		const frameWidth = Math.max(4, Math.floor(width));
		const innerWidth = Math.max(1, frameWidth - 2);
		const paneWidths = splitGridCellWidths(innerWidth, computeProfileNameWidth(this.data));
		const footerLines = this.buildFooterLines(innerWidth);
		const selectedProfile = this.getSelectedProfile();
		const agentCount = selectedProfile?.agents.length ?? 0;
		const paneContentRows = this.resolvePaneContentRows(agentCount, footerLines.length);
		this.lastPaneContentRows = paneContentRows;
		const leftPaneLines = this.buildSnapshotPaneRows(paneWidths.left, paneContentRows);
		const rightPaneLines = this.buildDetailsPaneRows(selectedProfile, paneWidths.right, paneContentRows);
		const detailTitle = selectedProfile?.name ?? "No selection";
		const lines: string[] = [
			buildTopBorder(this.theme, innerWidth),
			buildFullWidthRow(this.theme, innerWidth, buildModalTitleLine(this.theme, innerWidth)),
			buildGridSeparator(this.theme, paneWidths.left, paneWidths.right, "┬"),
			buildGridRow(
				this.theme,
				paneWidths.left,
				paneWidths.right,
				buildPaneTitleLine(this.theme, SNAPSHOT_TITLE, true, null, paneWidths.left),
				buildPaneTitleLine(this.theme, DETAILS_TITLE, false, detailTitle, paneWidths.right),
			),
			buildGridSeparator(this.theme, paneWidths.left, paneWidths.right, "┼"),
		];

		for (let index = 0; index < paneContentRows; index += 1) {
			lines.push(buildGridRow(this.theme, paneWidths.left, paneWidths.right, leftPaneLines[index] ?? "", rightPaneLines[index] ?? ""));
		}

		lines.push(buildGridSeparator(this.theme, paneWidths.left, paneWidths.right, "┴"));
		for (const footerLine of footerLines) {
			lines.push(buildFullWidthRow(this.theme, innerWidth, footerLine));
		}
		lines.push(buildBottomBorder(this.theme, innerWidth));

		return lines;
	}

	handleInput(data: string): void {
		if (this.renameInput) {
			this.renameInput.handleInput(data);
			this.requestRender();
			return;
		}

		if (this.confirmation) {
			this.confirmation.input.handleInput(data);
			this.requestRender();
			return;
		}

		if (this.busyMessage) {
			return;
		}

		if (this.sortMenuOpen) {
			this.handleSortMenuInput(data);
			return;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.finish({ type: "closed" });
			return;
		}

		if (matchesKey(data, "r")) {
			this.startRename();
			return;
		}

		if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) {
			this.startRemove();
			return;
		}

		if (matchesKey(data, "ctrl+u")) {
			this.startUpdate();
			return;
		}

		if (matchesKey(data, "ctrl+s")) {
			this.toggleSortMenu();
			return;
		}

		if (matchesKey(data, "s") && !this.sortMenuOpen) {
			this.addCurrentProfile();
			return;
		}

		this.handleSnapshotPaneInput(data);
	}

	private handleSnapshotPaneInput(data: string): void {
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.moveSelection(-1);
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.moveSelection(1);
			return;
		}

		if (matchesKey(data, "pageup")) {
			this.moveSelection(-Math.max(1, this.getSnapshotViewportRows()));
			return;
		}

		if (matchesKey(data, "pagedown")) {
			this.moveSelection(Math.max(1, this.getSnapshotViewportRows()));
			return;
		}

		if (matchesKey(data, "home")) {
			this.moveSelectionToBoundary("start");
			return;
		}

		if (matchesKey(data, "end")) {
			this.moveSelectionToBoundary("end");
			return;
		}

		if (matchesKey(data, "return")) {
			this.applySelectedProfile();
		}
	}

	private buildSnapshotPaneRows(width: number, contentRows: number): string[] {
		const lines: string[] = [];
		const profiles = this.getSortedProfiles();
		const needsIndicator = profiles.length > contentRows;
		const viewportRows = Math.max(1, contentRows - (needsIndicator ? 1 : 0));
		this.ensureSelectedVisible(viewportRows);

		if (profiles.length === 0) {
			lines.push(this.theme.color("dim", fitText(`  ${EMPTY_PROFILE_HINT}`, width)));
			while (lines.length < contentRows) {
				lines.push(" ".repeat(width));
			}
			return lines;
		}

		for (let index = 0; index < viewportRows; index += 1) {
			const profile = profiles[this.listScrollOffset + index];
			if (!profile) {
				lines.push(" ".repeat(width));
				continue;
			}

			const isSelected = profile.id === this.selectedProfileId;
			const label = fitText(` ${isSelected ? ">" : " "} ${profile.name}`, width);
			if (isSelected) {
				lines.push(this.theme.color("selectedText", label, { background: "selectedBg", bold: true }));
				continue;
			}

			lines.push(this.theme.color("text", label));
		}

		if (needsIndicator) {
			const indicator = alignRight(buildProfileScrollIndicator(this.listScrollOffset, profiles.length, viewportRows), width);
			lines.push(this.theme.color("dim", indicator));
		}

		while (lines.length < contentRows) {
			lines.push(" ".repeat(width));
		}

		return lines;
	}

	private buildDetailsPaneRows(profile: SavedProfile | null, width: number, contentRows: number): string[] {
		const lines: string[] = [];

		if (!profile) {
			lines.push(indentStyledLine(renderMetadataLine(this.theme, "Updated:", "-", Math.max(1, width - 2)), width));
			lines.push(" ".repeat(width));
			lines.push(this.theme.color("dim", fitText(`  ${EMPTY_DETAILS_HINT}`, width)));
			while (lines.length < contentRows) {
				lines.push(" ".repeat(width));
			}
			return lines;
		}

		const fixedRowsBeforeData = 4;
		const availableDataArea = Math.max(1, contentRows - fixedRowsBeforeData);
		const needsIndicator = profile.agents.length > availableDataArea;
		const viewportRows = Math.max(1, availableDataArea - (needsIndicator ? 1 : 0));
		const maxOffset = Math.max(0, profile.agents.length - viewportRows);
		this.detailScrollOffset = clamp(this.detailScrollOffset, 0, maxOffset);
		const tableWidth = Math.max(1, width - 4);
		const layout = buildTableLayout(profile, tableWidth);

		lines.push(indentStyledLine(renderMetadataLine(this.theme, "Updated:", formatTimestamp(profile.updatedAt), tableWidth), width));
		lines.push(" ".repeat(width));
		lines.push(indentStyledLine(buildTableHeaderLine(this.theme, layout), width));
		lines.push(indentStyledLine(buildTableSeparatorLine(this.theme, tableWidth), width));

		for (let index = 0; index < viewportRows; index += 1) {
			const agent = profile.agents[this.detailScrollOffset + index];
			const content = agent ? indentStyledLine(buildTableDataLine(this.theme, layout, agent), width) : " ".repeat(width);
			lines.push(content);
		}

		if (needsIndicator) {
			const indicator = centerText(buildAgentScrollIndicator(this.detailScrollOffset, profile.agents.length, viewportRows), width);
			lines.push(this.theme.color("dim", indicator));
		}

		while (lines.length < contentRows) {
			lines.push(" ".repeat(width));
		}

		return lines;
	}

	private buildFooterLines(width: number): string[] {
		if (this.busyMessage) {
			return [this.theme.color("warning", fitText(`Working: ${this.busyMessage}`, width))];
		}

		if (this.renameInput) {
			const renameLine = this.renameInput.render(width)[0] ?? "";
			return [
				this.theme.color("warning", fitText("Rename selected snapshot:", width)),
				fitText(renameLine, width),
				this.theme.color("dim", fitText("[Enter] Save  [Esc] Cancel Rename", width)),
			];
		}

		if (this.confirmation) {
			const confirmLine = this.confirmation.input.render(width)[0] ?? "";
			return [
				this.theme.color("warning", fitText(this.confirmation.prompt, width)),
				fitText(confirmLine, width),
				this.theme.color("dim", fitText("Type 'yes', then [Enter] to confirm. [Esc] Cancel", width)),
			];
		}

		if (this.sortMenuOpen) {
			return [
				this.theme.color("dim", fitText("Use ↑↓ to select sort order, [Enter] to apply", width)),
				...this.buildSortMenuLines(width),
			];
		}

		if (this.message) {
			const slot = this.message.level === "error" ? "error" : this.message.level === "warning" ? "warning" : "success";
			return wrapText(this.message.text, width).map((line) => this.theme.color(slot, fitText(line, width)));
		}

		return [
			this.theme.color("dim", fitText("  NAVIGATION: [↑↓] Select Item   [Esc] Close Modal", width)),
			this.theme.color("dim", fitText("  ACTIONS:    [Enter] Apply   [s] Save   [r] Rename   [Del] Delete   [Ctrl+U] Update", width)),
		];
	}

	private getSortedProfiles(): SavedProfile[] {
		return sortProfiles(this.data, this.currentSortOrder).sortedProfiles;
	}

	private getSelectedProfile(): SavedProfile | null {
		const selected = this.getSortedProfiles().find((profile) => profile.id === this.selectedProfileId);
		return selected ?? null;
	}

	private resolvePaneContentRows(agentCount: number, footerRows: number): number {
		const hasTerminalRows =
			typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows) && process.stdout.rows > 0;
		if (!hasTerminalRows) {
			return Math.max(MODAL_MIN_HEIGHT - footerRows - 7, MODAL_FALLBACK_VIEWPORT);
		}

		return Math.max(8, calculateModalHeight(agentCount) - footerRows - 7);
	}

	private getSnapshotViewportRows(): number {
		return Math.max(1, this.lastPaneContentRows);
	}

	private ensureSelectedVisible(viewportSize: number): void {
		const profiles = this.getSortedProfiles();
		if (profiles.length === 0) {
			this.listScrollOffset = 0;
			return;
		}

		const selectedIndex = Math.max(0, profiles.findIndex((profile) => profile.id === this.selectedProfileId));
		if (selectedIndex < this.listScrollOffset) {
			this.listScrollOffset = selectedIndex;
		}
		if (selectedIndex >= this.listScrollOffset + viewportSize) {
			this.listScrollOffset = selectedIndex - viewportSize + 1;
		}
	}

	private moveSelection(delta: number): void {
		const profiles = this.getSortedProfiles();
		if (profiles.length === 0) {
			return;
		}

		const currentIndex = Math.max(0, profiles.findIndex((profile) => profile.id === this.selectedProfileId));
		const nextIndex = clamp(currentIndex + delta, 0, profiles.length - 1);
		this.selectedProfileId = profiles[nextIndex]?.id ?? null;
		this.detailScrollOffset = 0;
		this.message = null;
		this.ensureSelectedVisible(this.getSnapshotViewportRows());
		this.requestRender();
	}

	private moveSelectionToBoundary(boundary: "start" | "end"): void {
		const profiles = this.getSortedProfiles();
		if (profiles.length === 0) {
			return;
		}
		this.selectedProfileId = boundary === "start" ? profiles[0]?.id ?? null : profiles[profiles.length - 1]?.id ?? null;
		this.detailScrollOffset = 0;
		this.message = null;
		this.ensureSelectedVisible(this.getSnapshotViewportRows());
		this.requestRender();
	}

	private startRename(): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			this.message = { text: "Select a saved snapshot before renaming.", level: "warning" };
			this.requestRender();
			return;
		}

		const input = new Input();
		input.focused = true;
		input.setValue(profile.name);
		input.onSubmit = (value: string) => {
			const targetId = this.renameTargetId;
			this.renameInput = null;
			this.renameTargetId = null;
			if (!targetId) {
				return;
			}
			this.runAction(`Renaming '${profile.name}'...`, async () => {
				const result = await this.actions.renameProfile(targetId, value);
				this.data = result.data;
				this.selectedProfileId = result.selectedProfileId ?? targetId;
				this.message = { text: result.message, level: "info" };
			});
		};
		input.onEscape = () => {
			this.renameInput = null;
			this.renameTargetId = null;
			this.message = { text: "Rename cancelled.", level: "info" };
			this.requestRender();
		};

		this.renameInput = input;
		this.renameTargetId = profile.id;
		this.message = null;
		this.requestRender();
	}

	private startConfirmation(request: ConfirmationRequest): void {
		const input = new Input();
		input.focused = true;
		input.setValue("");
		input.onSubmit = (value: string) => {
			const confirmation = this.confirmation;
			this.confirmation = null;

			if (
				!confirmation ||
				confirmation.action !== request.action ||
				confirmation.profileId !== request.profile.id ||
				value.trim().toLowerCase() !== "yes"
			) {
				this.message = { text: `${request.action === "remove" ? "Remove" : "Update"} cancelled.`, level: "info" };
				this.requestRender();
				return;
			}

			this.runAction(request.busyMessage, async () => request.onConfirm(confirmation.profileId));
		};
		input.onEscape = () => {
			this.confirmation = null;
			this.message = { text: `${request.action === "remove" ? "Remove" : "Update"} cancelled.`, level: "info" };
			this.requestRender();
		};

		this.confirmation = {
			action: request.action,
			profileId: request.profile.id,
			prompt: request.prompt,
			input,
		};
		this.message = null;
		this.requestRender();
	}

	private startRemove(): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			this.message = { text: "Select a saved snapshot before removing.", level: "warning" };
			this.requestRender();
			return;
		}

		this.startConfirmation({
			action: "remove",
			profile,
			prompt: `Remove profile '${profile.name}'? This cannot be undone.`,
			busyMessage: `Removing '${profile.name}'...`,
			onConfirm: async (targetId) => {
				const result = await this.actions.removeProfile(targetId);
				this.data = result.data;
				this.selectedProfileId = result.selectedProfileId ?? this.getSortedProfiles()[0]?.id ?? null;
				this.detailScrollOffset = 0;
				this.message = { text: result.message, level: "info" };
			},
		});
	}

	private addCurrentProfile(): void {
		const activeHint = this.activeAgentName ? ` from ${this.activeAgentName}` : "";
		this.runAction(`Capturing current snapshot${activeHint}...`, async () => {
			const result = await this.actions.addCurrentProfile();
			this.data = result.data;
			this.selectedProfileId = result.selectedProfileId ?? this.selectedProfileId;
			this.detailScrollOffset = 0;
			this.message = { text: result.message, level: "info" };
		});
	}

	private startUpdate(): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			this.message = { text: "Select a saved snapshot before updating.", level: "warning" };
			this.requestRender();
			return;
		}

		const currentAgentCount = profile.agents.length;
		this.startConfirmation({
			action: "update",
			profile,
			prompt: `Update '${profile.name}' with current agent state? This will overwrite ${currentAgentCount} agents.`,
			busyMessage: `Updating '${profile.name}' with current agent state...`,
			onConfirm: async (targetId) => {
				const result = await this.actions.updateProfile(targetId);
				this.data = result.data;
				this.selectedProfileId = result.selectedProfileId ?? targetId;
				this.detailScrollOffset = 0;
				this.message = { text: result.message, level: "info" };
			},
		});
	}

	private applySelectedProfile(): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			this.message = { text: "Select a saved snapshot before applying.", level: "warning" };
			this.requestRender();
			return;
		}

		this.runAction(`Applying '${profile.name}' across saved agent files...`, async () => {
			const outcome = await this.actions.applyProfile(profile.id);
			this.finish({
				type: "applied",
				outcome,
			});
		});
	}

	private runAction(label: string, action: () => Promise<void>): void {
		if (this.busyMessage) {
			return;
		}

		this.busyMessage = label;
		this.requestRender();
		void action()
			.catch((error: unknown) => {
				this.message = { text: toErrorMessage(error), level: "error" };
			})
			.finally(() => {
				this.busyMessage = null;
				this.requestRender();
			});
	}

	private finish(result: ProfileModalResult): void {
		if (this.finished) {
			return;
		}
		this.finished = true;
		this.done(result);
	}

	private getSortMenuOptions(): SortMenuOption[] {
		return getAvailableSortOrders().map((option) => ({
			...option,
			isSelected: this.currentSortOrder === option.order,
		}));
	}

	private toggleSortMenu(): void {
		if (this.sortMenuOpen) {
			this.closeSortMenu();
		} else {
			this.openSortMenu();
		}
	}

	private openSortMenu(): void {
		const options = this.getSortMenuOptions();
		const currentIndex = options.findIndex((option) => option.order === this.currentSortOrder);
		this.sortMenuOpen = true;
		this.sortMenuSelectedIndex = Math.max(0, currentIndex);
		this.requestRender();
	}

	private closeSortMenu(): void {
		this.sortMenuOpen = false;
		this.sortMenuSelectedIndex = 0;
		this.requestRender();
	}

	private handleSortMenuInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.closeSortMenu();
			return;
		}

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.sortMenuSelectedIndex = Math.max(0, this.sortMenuSelectedIndex - 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			const lastIndex = Math.max(0, this.getSortMenuOptions().length - 1);
			this.sortMenuSelectedIndex = Math.min(lastIndex, this.sortMenuSelectedIndex + 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, "return")) {
			this.applySortFromMenu();
			return;
		}
	}

	private applySortFromMenu(): void {
		const options = this.getSortMenuOptions();
		const selected = options[this.sortMenuSelectedIndex];
		if (!selected) {
			this.closeSortMenu();
			return;
		}

		this.currentSortOrder = selected.order;
		persistSortOrder(selected.order);
		this.detailScrollOffset = 0;
		this.ensureSelectedVisible(this.getSnapshotViewportRows());
		this.message = { text: `Sorted by ${selected.label}`, level: "info" };
		this.closeSortMenu();
	}

	private buildSortMenuLines(width: number): string[] {
		if (!this.sortMenuOpen) {
			return [];
		}

		const options = this.getSortMenuOptions();
		const menuWidth = clamp(width - 2, 32, 54);
		const innerWidth = Math.max(1, menuWidth - 2);
		const lines: string[] = [];
		const title = this.theme.color("accent", " SORT PROFILES ", { bold: true });
		const titleFill = Math.max(0, innerWidth - visibleWidth(title));
		lines.push(`${BOX.CORNER_TL}${title}${BOX.H_LINE.repeat(titleFill)}${BOX.CORNER_TR}`);

		for (let i = 0; i < options.length; i++) {
			const option = options[i];
			const isSelected = i === this.sortMenuSelectedIndex;
			const marker = isSelected ? ">" : " ";
			const checkmark = option.isSelected ? "✓" : " ";
			const label = `${marker} [${checkmark}] ${option.label}`;
			const padded = fitText(label, innerWidth);
			const styled = isSelected
				? this.theme.color("selectedText", padded, { background: "selectedBg", bold: true })
				: this.theme.color("text", padded);
			lines.push(`${BOX.V_LINE}${styled}${BOX.V_LINE}`);
		}

		const hint = "[Enter] Apply  [Esc] Cancel";
		lines.push(`${BOX.V_LINE}${this.theme.color("dim", fitText(hint, innerWidth))}${BOX.V_LINE}`);
		lines.push(`${BOX.CORNER_BL}${BOX.H_LINE.repeat(innerWidth)}${BOX.CORNER_BR}`);

		return lines.map((line) => centerLineInWidth(line, width));
	}
}

export async function openProfilesModal(
	ctx: ExtensionCommandContext,
	data: ProfilesFile,
	activeAgentName: string | null,
	actions: ProfileModalActions,
): Promise<ProfileModalResult> {
	const overlayOptions = resolveModalOverlayOptions(getMaximumContentWidth(data));

	return await ctx.ui.custom<ProfileModalResult>(
		(
			tui: { requestRender(): void },
			theme: ThemeLike,
			_keybindings: unknown,
			done: (result: ProfileModalResult) => void,
		) => {
			const resolvedTheme = loadModalTheme(theme);
			const contentInstance = new ProfileListModal(data, resolvedTheme, actions, activeAgentName, done, () => tui.requestRender());

			return {
				render(width: number): string[] {
					return contentInstance.render(width);
				},
				invalidate(): void {
					contentInstance.invalidate();
				},
				handleInput(input: string): void {
					contentInstance.handleInput(input);
					tui.requestRender();
				},
			};
		},
		{ overlay: true, overlayOptions },
	);
}
