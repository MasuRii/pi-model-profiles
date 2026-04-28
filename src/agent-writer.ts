import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { AGENTS_DIR } from "./constants.js";
import { writeFileAtomic } from "./atomic-write.js";
import { ModelProfilesError } from "./errors.js";
import {
	listAppliedKeys,
	listRemovedKeys,
	readAgentNameFromMarkdown,
	readProfileFieldsFromMarkdown,
	updateMarkdownProfileFields,
} from "./frontmatter-parser.js";
import { normalizeProfileFields } from "./profile-fields.js";
import type {
	AgentFileRecord,
	AgentScanResult,
	AgentSnapshotResult,
	AppliedAgentUpdate,
	ApplyProfileResult,
	ProfileFields,
	SavedProfile,
	SavedProfileAgent,
} from "./types.js";

interface SessionEntryLike {
	type?: unknown;
	customType?: unknown;
	data?: unknown;
}

interface SessionManagerLike {
	getEntries(): readonly unknown[];
}

type AgentScope = "user" | "project" | "both";

export interface AgentSelectionOptions {
	cwd?: string;
	agentsDir?: string;
	scope?: AgentScope;
}

const PROJECT_AGENT_SOURCE_DIRS = [
	[".omp", "agents"],
	[".pi", "agents"],
	[".claude", "agents"],
] as const;

function toRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function normalizeName(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeCompareValue(value: string): string {
	return value.trim().toLowerCase();
}

function parseActiveAgentFromPrompt(systemPrompt: string): string | null {
	const identityMatch = /<active_agent_identity\s+name=["']([^"']+)["']/i.exec(systemPrompt);
	if (identityMatch?.[1]) {
		return identityMatch[1].trim() || null;
	}

	const summaryMatch = /The selected active agent identity is "([^"]+)"\./i.exec(systemPrompt);
	if (summaryMatch?.[1]) {
		return summaryMatch[1].trim() || null;
	}

	return null;
}

function cloneSavedAgent(agent: SavedProfileAgent): SavedProfileAgent {
	return {
		fileName: agent.fileName,
		agentName: agent.agentName,
		fields: normalizeProfileFields(agent.fields),
	};
}

function normalizeSavedAgents(agents: readonly SavedProfileAgent[]): SavedProfileAgent[] {
	return [...agents]
		.map((agent) => cloneSavedAgent(agent))
		.sort((left, right) => left.fileName.localeCompare(right.fileName) || left.agentName.localeCompare(right.agentName));
}

export function detectActiveAgentName(sessionManager: SessionManagerLike, systemPrompt = ""): string | null {
	const entries = sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as SessionEntryLike | undefined;
		if (entry?.type !== "custom" || entry.customType !== "active_agent") {
			continue;
		}

		const data = toRecord(entry.data);
		if (data.name === null) {
			return null;
		}

		const name = normalizeName(data.name);
		if (name) {
			return name;
		}

		return null;
	}

	return parseActiveAgentFromPrompt(systemPrompt);
}

function normalizeCompareKey(value: string): string {
	return value.trim().toLowerCase();
}

function isDirectory(path: string): boolean {
	try {
		return existsSync(path) && readdirSync(path, { withFileTypes: true }).length >= 0;
	} catch {
		return false;
	}
}

function findNearestProjectAgentDirs(cwd: string): string[] {
	let currentDir = resolve(cwd);

	while (true) {
		const candidates = PROJECT_AGENT_SOURCE_DIRS.map((segments) => join(currentDir, ...segments)).filter((candidate) =>
			isDirectory(candidate),
		);
		if (candidates.length > 0) {
			return candidates;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return [];
		}
		currentDir = parentDir;
	}
}

function resolveAgentSourceDirs(options: string | AgentSelectionOptions = AGENTS_DIR): string[] {
	if (typeof options === "string") {
		return [options];
	}

	const scope = options.scope ?? "user";
	const cwd = resolve(options.cwd ?? process.cwd());
	const projectDirs = scope === "user" ? [] : findNearestProjectAgentDirs(cwd);
	const userAgentsDir = options.agentsDir ?? AGENTS_DIR;
	const userDirs = scope === "project" ? [] : [userAgentsDir].filter((candidate) => isDirectory(candidate));
	return [...userDirs.slice().reverse(), ...projectDirs.slice().reverse()];
}

export function readAgentFileRecord(filePath: string): AgentFileRecord {
	if (!existsSync(filePath)) {
		throw new ModelProfilesError(`Agent file '${filePath}' was not found.`, "AGENT_NOT_FOUND");
	}

	const markdown = readFileSync(filePath, "utf-8");
	return {
		path: filePath,
		fileName: basename(filePath),
		agentName: readAgentNameFromMarkdown(markdown),
		fields: readProfileFieldsFromMarkdown(markdown),
	};
}

export function scanAgentFiles(options: string | AgentSelectionOptions = AGENTS_DIR): AgentScanResult {
	const sourceDirs = resolveAgentSourceDirs(options);
	if (sourceDirs.length === 0) {
		const targetDescription = typeof options === "string" ? options : options.agentsDir ?? options.cwd ?? AGENTS_DIR;
		throw new ModelProfilesError(`Unable to read agents directory '${targetDescription}'.`, "AGENTS_DIR_UNAVAILABLE");
	}

	const warnings: string[] = [];
	const agentsByName = new Map<string, AgentFileRecord>();

	for (const agentsDir of sourceDirs) {
		let entries: Array<{ name: string; isFile(): boolean }>;
		try {
			entries = readdirSync(agentsDir, { withFileTypes: true }) as Array<{ name: string; isFile(): boolean }>;
		} catch {
			throw new ModelProfilesError(`Unable to read agents directory '${agentsDir}'.`, "AGENTS_DIR_UNAVAILABLE");
		}

		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) {
				continue;
			}

			const filePath = join(agentsDir, entry.name);
			try {
				const record = readAgentFileRecord(filePath);
				agentsByName.set(normalizeCompareKey(record.agentName), record);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push(`Skipped agent file '${filePath}': ${message}`);
			}
		}
	}

	return {
		agents: [...agentsByName.values()].sort(
			(left, right) => left.fileName.localeCompare(right.fileName) || left.agentName.localeCompare(right.agentName),
		),
		warnings,
	};
}

export function findAgentRecordByName(agentName: string, options: string | AgentSelectionOptions = AGENTS_DIR): AgentFileRecord | null {
	const target = normalizeCompareValue(agentName);
	const scan = scanAgentFiles(options);
	return scan.agents.find((agent) => normalizeCompareValue(agent.agentName) === target) ?? null;
}

export function captureAgentSnapshots(options: string | AgentSelectionOptions = AGENTS_DIR): AgentSnapshotResult {
	const scan = scanAgentFiles(options);
	if (scan.agents.length === 0) {
		const targetDescription = typeof options === "string" ? options : options.agentsDir ?? options.cwd ?? AGENTS_DIR;
		throw new ModelProfilesError(`No readable agent markdown files were found in '${targetDescription}'.`, "NO_AGENT_FILES");
	}

	return {
		agents: normalizeSavedAgents(
			scan.agents.map((agent) => ({
				fileName: agent.fileName,
				agentName: agent.agentName,
				fields: agent.fields,
			})),
		),
		warnings: scan.warnings,
	};
}

export function applyProfileToAgentRecord(agent: AgentFileRecord, fields: ProfileFields): AppliedAgentUpdate {
	const normalizedFields = normalizeProfileFields(fields);
	const markdown = readFileSync(agent.path, "utf-8");
	const updatedMarkdown = updateMarkdownProfileFields(markdown, normalizedFields);
	writeFileAtomic(agent.path, updatedMarkdown);
	return {
		updatedPath: agent.path,
		fileName: agent.fileName,
		agentName: agent.agentName,
		appliedKeys: listAppliedKeys(normalizedFields),
		removedKeys: listRemovedKeys(normalizedFields),
	};
}

export function applySavedProfile(profile: SavedProfile, options: string | AgentSelectionOptions = AGENTS_DIR): ApplyProfileResult {
	if (profile.agents.length === 0) {
		throw new ModelProfilesError(`Saved profile '${profile.name}' does not contain any agent snapshots.`, "EMPTY_PROFILE");
	}

	const warnings: string[] = [];
	const missingAgents: string[] = [];
	const pendingWrites: Array<{ target: AgentFileRecord; updatedMarkdown: string; fields: ProfileFields }> = [];
	const seenFiles = new Set<string>();
	const scan = scanAgentFiles(options);
	const targetByFileName = new Map(scan.agents.map((agent) => [normalizeCompareKey(agent.fileName), agent] as const));
	const targetByAgentName = new Map(scan.agents.map((agent) => [normalizeCompareKey(agent.agentName), agent] as const));
	const targetDescription = typeof options === "string" ? options : options.agentsDir ?? options.cwd ?? AGENTS_DIR;

	for (const savedAgent of normalizeSavedAgents(profile.agents)) {
		const sourceKey = savedAgent.fileName.toLowerCase();
		if (seenFiles.has(sourceKey)) {
			throw new ModelProfilesError(
				`Saved profile '${profile.name}' contains duplicate agent entry '${savedAgent.fileName}'.`,
				"DUPLICATE_PROFILE_AGENT",
			);
		}
		seenFiles.add(sourceKey);

		const target =
			targetByFileName.get(normalizeCompareKey(savedAgent.fileName)) ??
			targetByAgentName.get(normalizeCompareKey(savedAgent.agentName));
		if (!target) {
			missingAgents.push(savedAgent.fileName);
			warnings.push(`Skipped missing agent file '${savedAgent.fileName}' while resolving '${targetDescription}'.`);
			continue;
		}

		const markdown = readFileSync(target.path, "utf-8");
		const normalizedFields = normalizeProfileFields(savedAgent.fields);
		const updatedMarkdown = updateMarkdownProfileFields(markdown, normalizedFields);
		const currentAgentName = readAgentNameFromMarkdown(markdown);
		pendingWrites.push({
			target: {
				path: target.path,
				fileName: target.fileName,
				agentName: currentAgentName,
				fields: normalizedFields,
			},
			updatedMarkdown,
			fields: normalizedFields,
		});
	}

	if (pendingWrites.length === 0) {
		throw new ModelProfilesError(
			`Saved profile '${profile.name}' does not match any existing agent markdown files in '${targetDescription}'.`,
			"NO_MATCHING_AGENT_FILES",
		);
	}

	for (const pending of pendingWrites) {
		writeFileAtomic(pending.target.path, pending.updatedMarkdown);
	}

	return {
		appliedAgents: pendingWrites.map((pending) => ({
			updatedPath: pending.target.path,
			fileName: pending.target.fileName,
			agentName: pending.target.agentName,
			appliedKeys: listAppliedKeys(pending.fields),
			removedKeys: listRemovedKeys(pending.fields),
		})),
		missingAgents,
		warnings,
	};
}
