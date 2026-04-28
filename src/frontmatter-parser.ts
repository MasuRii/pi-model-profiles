import { PROFILE_FIELD_KEYS, type ProfileFieldKey, type ProfileFields } from "./types.js";
import { ModelProfilesError } from "./errors.js";

interface FrontmatterDocument {
	frontmatter: string;
	body: string;
}

interface FrontmatterBlock {
	key: string | null;
	lines: string[];
}

const ANCHOR_KEYS = new Set(["name", "mode", "color", "description"]);
const SAFE_UNQUOTED_SCALAR = /^[A-Za-z0-9._/@:-]+$/;
const PROFILE_KEY_SET = new Set<string>(PROFILE_FIELD_KEYS);

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractTopLevelKey(line: string): string | null {
	if (!line || line.startsWith(" ") || line.startsWith("\t")) {
		return null;
	}

	const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
	if (!match) {
		return null;
	}

	return match[1] ?? null;
}

function parseScalarText(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/''/g, "'");
	}
	return trimmed;
}

function splitFrontmatterBlocks(frontmatter: string): FrontmatterBlock[] {
	const lines = frontmatter.split("\n");
	const starts: Array<{ index: number; key: string }> = [];

	for (let index = 0; index < lines.length; index += 1) {
		const key = extractTopLevelKey(lines[index] ?? "");
		if (key) {
			starts.push({ index, key });
		}
	}

	if (starts.length === 0) {
		return [{ key: null, lines }];
	}

	const blocks: FrontmatterBlock[] = [];
	if ((starts[0]?.index ?? 0) > 0) {
		blocks.push({ key: null, lines: lines.slice(0, starts[0]?.index) });
	}

	for (let index = 0; index < starts.length; index += 1) {
		const current = starts[index];
		const next = starts[index + 1];
		blocks.push({
			key: current?.key ?? null,
			lines: lines.slice(current?.index ?? 0, next ? next.index : lines.length),
		});
	}

	return blocks.filter((block) => block.lines.length > 0);
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !(lines[start] ?? "").trim()) {
		start += 1;
	}
	while (end > start && !(lines[end - 1] ?? "").trim()) {
		end -= 1;
	}
	return lines.slice(start, end);
}

function joinBlocks(blocks: FrontmatterBlock[]): string {
	const lines = blocks.flatMap((block) => block.lines);
	return trimBlankEdges(lines).join("\n");
}

function serializeScalar(value: string): string {
	return SAFE_UNQUOTED_SCALAR.test(value) ? value : JSON.stringify(value);
}

function serializeProfileLines(fields: ProfileFields): string[] {
	const lines: string[] = [];
	if (fields.model !== undefined) {
		lines.push(`model: ${serializeScalar(fields.model)}`);
	}
	if (fields.temperature !== undefined) {
		lines.push(`temperature: ${String(fields.temperature)}`);
	}
	if (fields.reasoningEffort !== undefined) {
		lines.push(`reasoningEffort: ${serializeScalar(fields.reasoningEffort)}`);
	}
	return lines;
}

function findInsertIndex(blocks: FrontmatterBlock[]): number {
	const firstProfileIndex = blocks.findIndex((block) => block.key !== null && PROFILE_KEY_SET.has(block.key));
	if (firstProfileIndex !== -1) {
		let keptBefore = 0;
		for (let index = 0; index < firstProfileIndex; index += 1) {
			if (!PROFILE_KEY_SET.has(blocks[index]?.key ?? "")) {
				keptBefore += 1;
			}
		}
		return keptBefore;
	}

	let lastAnchorIndex = -1;
	for (let index = 0; index < blocks.length; index += 1) {
		const key = blocks[index]?.key;
		if (key && ANCHOR_KEYS.has(key)) {
			lastAnchorIndex = index;
		}
	}

	if (lastAnchorIndex !== -1) {
		return lastAnchorIndex + 1;
	}

	return blocks[0]?.key === null ? 1 : 0;
}

export function extractFrontmatterDocument(markdown: string): FrontmatterDocument {
	const normalized = normalizeNewlines(markdown);
	const lines = normalized.split("\n");
	if ((lines[0] ?? "") !== "---") {
		throw new ModelProfilesError("Agent markdown is missing opening frontmatter delimiter.", "INVALID_FRONTMATTER");
	}

	let endIndex = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if ((lines[index] ?? "") === "---") {
			endIndex = index;
			break;
		}
	}

	if (endIndex === -1) {
		throw new ModelProfilesError("Agent markdown is missing closing frontmatter delimiter.", "INVALID_FRONTMATTER");
	}

	return {
		frontmatter: lines.slice(1, endIndex).join("\n"),
		body: lines.slice(endIndex + 1).join("\n"),
	};
}

export function readTopLevelScalarMap(frontmatter: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of frontmatter.split("\n")) {
		const key = extractTopLevelKey(line);
		if (!key) {
			continue;
		}
		const separatorIndex = line.indexOf(":");
		const rawValue = line.slice(separatorIndex + 1).trim();
		if (!rawValue) {
			continue;
		}
		values[key] = parseScalarText(rawValue);
	}
	return values;
}

export function readAgentNameFromMarkdown(markdown: string): string {
	const { frontmatter } = extractFrontmatterDocument(markdown);
	const name = readTopLevelScalarMap(frontmatter).name?.trim();
	if (!name) {
		throw new ModelProfilesError("Agent markdown frontmatter is missing a non-empty 'name' field.", "INVALID_AGENT_NAME");
	}
	return name;
}

export function readProfileFieldsFromMarkdown(markdown: string): ProfileFields {
	const { frontmatter } = extractFrontmatterDocument(markdown);
	const values = readTopLevelScalarMap(frontmatter);
	const fields: ProfileFields = {};

	const model = values.model?.trim();
	if (model) {
		fields.model = model;
	}

	if (values.temperature !== undefined) {
		const parsedTemperature = Number.parseFloat(values.temperature);
		if (!Number.isFinite(parsedTemperature)) {
			throw new ModelProfilesError(
				`Frontmatter field 'temperature' must be numeric, received '${values.temperature}'.`,
				"INVALID_TEMPERATURE",
			);
		}
		fields.temperature = parsedTemperature;
	}

	const reasoningEffort = values.reasoningEffort?.trim();
	if (reasoningEffort) {
		fields.reasoningEffort = reasoningEffort;
	}

	return fields;
}

export function updateMarkdownProfileFields(markdown: string, fields: ProfileFields): string {
	const document = extractFrontmatterDocument(markdown);
	const originalBlocks = splitFrontmatterBlocks(document.frontmatter);
	const keptBlocks = originalBlocks.filter((block) => !PROFILE_KEY_SET.has(block.key ?? ""));
	const insertIndex = findInsertIndex(originalBlocks);
	const profileLines = serializeProfileLines(fields);
	const nextBlocks = [...keptBlocks];

	if (profileLines.length > 0) {
		nextBlocks.splice(insertIndex, 0, { key: null, lines: profileLines });
	}

	const nextFrontmatter = joinBlocks(nextBlocks);
	return `---\n${nextFrontmatter}\n---\n${document.body}`;
}

export function listAppliedKeys(fields: ProfileFields): ProfileFieldKey[] {
	return PROFILE_FIELD_KEYS.filter((key) => fields[key] !== undefined);
}

export function listRemovedKeys(fields: ProfileFields): ProfileFieldKey[] {
	return PROFILE_FIELD_KEYS.filter((key) => fields[key] === undefined);
}
