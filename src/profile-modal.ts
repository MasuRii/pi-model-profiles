import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { MODAL_MIN_HEIGHT, calculateModalHeight, resolveModalOverlayOptions } from "./constants.js";
import { toErrorMessage } from "./errors.js";
import { loadModalTheme, BOX, type ResolvedModalTheme } from "./modal-theme.js";
import { formatProfileFieldValue } from "./profile-fields.js";
import { getAvailableSortOrders, getCurrentSortOrder, getSortOrderLabel, persistSortOrder, sortProfiles } from "./profile-sort-service.js";
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

type FocusedPane = "snapshots" | "details";
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
const OUTER_HORIZONTAL_PADDING = 1;
const PANE_GAP = 1;
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

function splitPaneWidths(totalWidth: number, snapshotNameWidth: number): { left: number; right: number } {
	const safeWidth = Math.max(56, totalWidth);
	const preferredLeft = clamp(snapshotNameWidth + 6, 24, 32);
	const minLeft = Math.max(22, Math.min(26, safeWidth - 46));
	const maxLeft = Math.max(minLeft, Math.min(34, safeWidth - 40));
	const left = clamp(preferredLeft, minLeft, maxLeft);
	const right = Math.max(36, safeWidth - left);
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

function renderOuterFrame(lines: string[], width: number, title: string, theme: ResolvedModalTheme): string[] {
	const frameWidth = Math.max(4, Math.floor(width));
	const innerWidth = Math.max(1, frameWidth - 2);
	const colorBorder = (text: string): string => theme.color("accent", text);
	const safeTitle = truncateToWidth(title, innerWidth, "…", true);
	const titleWidth = innerWidth >= visibleWidth(safeTitle) + 2 ? visibleWidth(safeTitle) + 2 : visibleWidth(safeTitle);
	const paddedTitle = innerWidth >= visibleWidth(safeTitle) + 2 ? ` ${theme.bold(safeTitle)} ` : theme.bold(safeTitle);
	const fillWidth = Math.max(0, innerWidth - titleWidth);
	const topLine = `${colorBorder(BOX.CORNER_TL)}${colorBorder(paddedTitle)}${colorBorder(BOX.H_LINE.repeat(fillWidth))}${colorBorder(BOX.CORNER_TR)}`;
	const bottomLine = `${colorBorder(BOX.CORNER_BL)}${colorBorder(BOX.H_LINE.repeat(innerWidth))}${colorBorder(BOX.CORNER_BR)}`;
	const contentLines = (lines.length > 0 ? lines : [""]).map((line) => {
		const padded = fitText(line, innerWidth);
		return `${colorBorder(BOX.V_LINE)}${padded}${colorBorder(BOX.V_LINE)}`;
	});

	return [topLine, ...contentLines, bottomLine];
}

function colorPaneBorder(theme: ResolvedModalTheme, active: boolean, text: string): string {
	return theme.color(active ? "accent" : "borderMuted", text, { bold: active });
}

function buildPaneTopBorder(theme: ResolvedModalTheme, width: number, title: string, active: boolean): string {
	const innerWidth = Math.max(1, width - 2);
	const label = active ? `${title} ${ACTIVE_PANE_LABEL}` : title;
	const labelText = truncateToWidth(` ${label} `, innerWidth, "…", true);
	const fillWidth = Math.max(0, innerWidth - visibleWidth(labelText));
	return `${colorPaneBorder(theme, active, BOX.CORNER_TL)}${colorPaneBorder(theme, active, labelText)}${colorPaneBorder(theme, active, BOX.H_LINE.repeat(fillWidth))}${colorPaneBorder(theme, active, BOX.CORNER_TR)}`;
}

function buildPaneBottomBorder(theme: ResolvedModalTheme, width: number, active: boolean): string {
	return `${colorPaneBorder(theme, active, BOX.CORNER_BL)}${colorPaneBorder(theme, active, BOX.H_LINE.repeat(width - 2))}${colorPaneBorder(theme, active, BOX.CORNER_BR)}`;
}

function buildPaneLine(theme: ResolvedModalTheme, width: number, content: string, active: boolean): string {
	const inner = fitText(content, width - 2);
	return `${colorPaneBorder(theme, active, BOX.V_LINE)}${inner}${colorPaneBorder(theme, active, BOX.V_LINE)}`;
}

function formatDisplayedFieldValue(agent: SavedProfileAgent, key: "model" | "temperature" | "reasoningEffort"): string {
	const raw = formatProfileFieldValue(key, agent.fields);
	return raw === "(absent)" ? ABSENT_DISPLAY_VALUE : raw;
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
	const prefix = `${label.padEnd(8, " ")}`;
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
	let maxWidth = 40;
	for (const profile of data.profiles) {
		maxWidth = Math.max(maxWidth, visibleWidth(profile.name) + 18);
		for (const agent of profile.agents) {
			maxWidth = Math.max(maxWidth, visibleWidth(agent.agentName));
			maxWidth = Math.max(maxWidth, visibleWidth(formatDisplayedFieldValue(agent, "model")));
			maxWidth = Math.max(maxWidth, visibleWidth(formatDisplayedFieldValue(agent, "temperature")));
			maxWidth = Math.max(maxWidth, visibleWidth(formatDisplayedFieldValue(agent, "reasoningEffort")));
		}
	}
	return maxWidth;
}

function buildTableLayout(profile: SavedProfile, totalWidth: number): TableColumnLayout {
	const gap = "  ";
	const gapWidth = visibleWidth(gap) * 3;
	const available = Math.max(24, totalWidth - gapWidth);
	const reasoningHeader = totalWidth >= 60 ? "REASONING" : "REASON";

	let agent = Math.max("AGENT".length, ...profile.agents.map((entry) => visibleWidth(entry.agentName)));
	agent = clamp(agent, 10, 18);

	const temp = Math.max(
		6,
		"TEMP".length,
		...profile.agents.map((entry) => visibleWidth(formatDisplayedFieldValue(entry, "temperature"))),
	);

	let reasoning = Math.max(
		reasoningHeader.length,
		...profile.agents.map((entry) => visibleWidth(formatDisplayedFieldValue(entry, "reasoningEffort"))),
	);
	reasoning = clamp(reasoning, reasoningHeader.length, 12);

	const minimumModel = 16;
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
		model = Math.max(12, model);
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
		theme.color("accent", alignRight("TEMP", layout.temp), { bold: true }),
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
		theme.color("text", alignRight(formatDisplayedFieldValue(agent, "temperature"), layout.temp)),
		layout.gap,
		theme.color("text", fitText(formatDisplayedFieldValue(agent, "reasoningEffort"), layout.reasoning)),
	].join("");
}

class ProfileListModal {
	private data: ProfilesFile;
	private selectedProfileId: string | null;
	private listScrollOffset = 0;
	private detailScrollOffset = 0;
	private focusedPane: FocusedPane = "snapshots";
	private lastPaneContentRows = MODAL_FALLBACK_VIEWPORT;
	private lastDetailViewportRows = 1;
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
		const contentWidth = Math.max(1, Math.floor(width));
		const paneAreaWidth = Math.max(40, contentWidth - OUTER_HORIZONTAL_PADDING * 2 - PANE_GAP);
		const paneWidths = splitPaneWidths(paneAreaWidth, computeProfileNameWidth(this.data));
		const footerLines = this.buildFooterLines(contentWidth);
		const selectedProfile = this.getSelectedProfile();
		const agentCount = selectedProfile?.agents.length ?? 0;
		const paneContentRows = this.resolvePaneContentRows(agentCount, footerLines.length);
		this.lastPaneContentRows = paneContentRows;
		const leftPaneLines = this.buildSnapshotPaneBox(paneWidths.left, paneContentRows);
		const rightPaneLines = this.buildDetailsPaneBox(selectedProfile, paneWidths.right, paneContentRows);
		const paneRowCount = Math.max(leftPaneLines.length, rightPaneLines.length);
		const lines: string[] = [];

		for (let index = 0; index < paneRowCount; index += 1) {
			const left = leftPaneLines[index] ?? " ".repeat(paneWidths.left);
			const right = rightPaneLines[index] ?? " ".repeat(paneWidths.right);
			const content = `${" ".repeat(OUTER_HORIZONTAL_PADDING)}${left}${" ".repeat(PANE_GAP)}${right}${" ".repeat(OUTER_HORIZONTAL_PADDING)}`;
			lines.push(fitText(content, contentWidth));
		}

		lines.push(" ".repeat(contentWidth));
		for (const footerLine of footerLines) {
			lines.push(fitText(footerLine, contentWidth));
		}

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

		if (matchesKey(data, "tab")) {
			this.toggleFocusedPane();
			return;
		}

		if (matchesKey(data, "left")) {
			this.setFocusedPane("snapshots");
			return;
		}

		if (matchesKey(data, "right")) {
			this.setFocusedPane("details");
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

		if (this.focusedPane === "snapshots") {
			this.handleSnapshotPaneInput(data);
			return;
		}

		this.handleDetailsPaneInput(data);
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

	private handleDetailsPaneInput(data: string): void {
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.scrollDetails(-1);
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.scrollDetails(1);
			return;
		}

		if (matchesKey(data, "pageup")) {
			this.scrollDetails(-Math.max(1, this.lastDetailViewportRows));
			return;
		}

		if (matchesKey(data, "pagedown")) {
			this.scrollDetails(Math.max(1, this.lastDetailViewportRows));
			return;
		}

		if (matchesKey(data, "home")) {
			this.scrollDetailsToBoundary("start");
			return;
		}

		if (matchesKey(data, "end")) {
			this.scrollDetailsToBoundary("end");
			return;
		}

		if (matchesKey(data, "return")) {
			this.applySelectedProfile();
		}
	}

	private buildSnapshotPaneBox(width: number, contentRows: number): string[] {
		const lines: string[] = [];
		const innerWidth = Math.max(1, width - 2);
		const profiles = this.getSortedProfiles();
		const isFocused = this.focusedPane === "snapshots";
		const needsIndicator = profiles.length > contentRows;
		const viewportRows = Math.max(1, contentRows - (needsIndicator ? 1 : 0));
		this.ensureSelectedVisible(viewportRows);

		lines.push(buildPaneTopBorder(this.theme, width, SNAPSHOT_TITLE, isFocused));

		if (profiles.length === 0) {
			lines.push(buildPaneLine(this.theme, width, this.theme.color("dim", fitText(EMPTY_PROFILE_HINT, innerWidth)), isFocused));
			for (let index = 1; index < contentRows; index += 1) {
				lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
			}
			lines.push(buildPaneBottomBorder(this.theme, width, isFocused));
			return lines;
		}

		for (let index = 0; index < viewportRows; index += 1) {
			const profile = profiles[this.listScrollOffset + index];
			if (!profile) {
				lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
				continue;
			}

			const isSelected = profile.id === this.selectedProfileId;
			const label = fitText(`${isSelected ? ">" : " "} ${profile.name}`, innerWidth);
			if (isSelected) {
				const content = isFocused
					? this.theme.color("selectedText", label, { background: "selectedBg", bold: true })
					: this.theme.color("accent", label, { bold: true });
				lines.push(buildPaneLine(this.theme, width, content, isFocused));
				continue;
			}

			lines.push(buildPaneLine(this.theme, width, this.theme.color("text", label), isFocused));
		}

		if (needsIndicator) {
			const indicator = alignRight(buildProfileScrollIndicator(this.listScrollOffset, profiles.length, viewportRows), innerWidth);
			lines.push(buildPaneLine(this.theme, width, this.theme.color("dim", indicator), isFocused));
		}

		while (lines.length < contentRows + 1) {
			lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
		}

		lines.push(buildPaneBottomBorder(this.theme, width, isFocused));
		return lines;
	}

	private buildDetailsPaneBox(profile: SavedProfile | null, width: number, contentRows: number): string[] {
		const lines: string[] = [];
		const innerWidth = Math.max(1, width - 2);
		const isFocused = this.focusedPane === "details";
		lines.push(buildPaneTopBorder(this.theme, width, DETAILS_TITLE, isFocused));

		if (!profile) {
			this.lastDetailViewportRows = 1;
			lines.push(buildPaneLine(this.theme, width, renderMetadataLine(this.theme, "Name:", "-", innerWidth), isFocused));
			lines.push(buildPaneLine(this.theme, width, renderMetadataLine(this.theme, "Updated:", "-", innerWidth), isFocused));
			lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
			lines.push(buildPaneLine(this.theme, width, this.theme.color("dim", fitText(EMPTY_DETAILS_HINT, innerWidth)), isFocused));
			while (lines.length < contentRows + 1) {
				lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
			}
			lines.push(buildPaneBottomBorder(this.theme, width, isFocused));
			return lines;
		}

		const fixedRowsBeforeData = 5;
		const availableDataArea = Math.max(1, contentRows - fixedRowsBeforeData);
		const needsIndicator = profile.agents.length > availableDataArea;
		const viewportRows = Math.max(1, availableDataArea - (needsIndicator ? 1 : 0));
		this.lastDetailViewportRows = viewportRows;
		const maxOffset = Math.max(0, profile.agents.length - viewportRows);
		this.detailScrollOffset = clamp(this.detailScrollOffset, 0, maxOffset);
		const layout = buildTableLayout(profile, innerWidth);

		lines.push(buildPaneLine(this.theme, width, renderMetadataLine(this.theme, "Name:", profile.name, innerWidth), isFocused));
		lines.push(buildPaneLine(this.theme, width, renderMetadataLine(this.theme, "Updated:", formatTimestamp(profile.updatedAt), innerWidth), isFocused));
		lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
		lines.push(buildPaneLine(this.theme, width, buildTableHeaderLine(this.theme, layout), isFocused));
		lines.push(buildPaneLine(this.theme, width, buildTableSeparatorLine(this.theme, innerWidth), isFocused));

		for (let index = 0; index < viewportRows; index += 1) {
			const agent = profile.agents[this.detailScrollOffset + index];
			const content = agent ? buildTableDataLine(this.theme, layout, agent) : " ".repeat(innerWidth);
			lines.push(buildPaneLine(this.theme, width, content, isFocused));
		}

		if (needsIndicator) {
			const indicator = centerText(buildAgentScrollIndicator(this.detailScrollOffset, profile.agents.length, viewportRows), innerWidth);
			lines.push(buildPaneLine(this.theme, width, this.theme.color("dim", indicator), isFocused));
		}

		while (lines.length < contentRows + 1) {
			lines.push(buildPaneLine(this.theme, width, " ".repeat(innerWidth), isFocused));
		}

		lines.push(buildPaneBottomBorder(this.theme, width, isFocused));
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

		const gap = "    ";
		const leftWidth = Math.max(24, Math.min(34, Math.floor((width - visibleWidth(gap)) * 0.44)));
		const rightWidth = Math.max(24, width - visibleWidth(gap) - leftWidth);
		const row = (left: string, right: string, accent = false): string => {
			const leftText = accent ? this.theme.color("accent", fitText(left, leftWidth), { bold: true }) : this.theme.color("dim", fitText(left, leftWidth));
			const rightText = accent ? this.theme.color("accent", fitText(right, rightWidth), { bold: true }) : this.theme.color("dim", fitText(right, rightWidth));
			return `${leftText}${gap}${rightText}`;
		};

		const sortLabel = getSortOrderLabel(this.currentSortOrder);

		return [
			row("NAVIGATION", "ACTIONS", true),
			row("[↑↓]    Select Item", "[Enter] Apply Snapshot"),
			row("[Tab/→] Switch Pane", "[s]     Save Current"),
			row("[Esc]   Close Modal", "[r]     Rename Snapshot"),
			row("", "[Del/Ctrl+D] Delete Snapshot"),
			row("", "[Ctrl+U] Update Snapshot"),
			row("", "[Ctrl+S] Sort Profiles"),
			row("", `[Sort: ${sortLabel}]`),
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
			return Math.max(MODAL_MIN_HEIGHT - footerRows - 6, MODAL_FALLBACK_VIEWPORT);
		}

		return Math.max(8, calculateModalHeight(agentCount) - footerRows - 6);
	}

	private getSnapshotViewportRows(): number {
		return Math.max(1, this.lastPaneContentRows - 1);
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

	private setFocusedPane(nextPane: FocusedPane): void {
		if (this.focusedPane === nextPane) {
			return;
		}
		this.focusedPane = nextPane;
		this.requestRender();
	}

	private toggleFocusedPane(): void {
		this.focusedPane = this.focusedPane === "snapshots" ? "details" : "snapshots";
		this.requestRender();
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

	private scrollDetails(delta: number): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			return;
		}

		const maxOffset = Math.max(0, profile.agents.length - this.lastDetailViewportRows);
		this.detailScrollOffset = clamp(this.detailScrollOffset + delta, 0, maxOffset);
		this.requestRender();
	}

	private scrollDetailsToBoundary(boundary: "start" | "end"): void {
		const profile = this.getSelectedProfile();
		if (!profile) {
			return;
		}

		if (boundary === "start") {
			this.detailScrollOffset = 0;
			this.requestRender();
			return;
		}

		this.detailScrollOffset = Math.max(0, profile.agents.length - this.lastDetailViewportRows);
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
					return renderOuterFrame(contentInstance.render(Math.max(1, width - 2)), width, "MODEL PROFILES", resolvedTheme);
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
