import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
	AGENTS_DIR,
	INITIAL_PROFILE_NAME,
	LEGACY_PROFILE_NAME_SUFFIX,
	PROFILE_NAME_SUFFIX,
	PROFILE_STORE_PATH,
	PROFILE_STORE_VERSION,
} from "./constants.js";
import { captureAgentSnapshots, type AgentSelectionOptions } from "./agent-writer.js";
import { writeFileAtomic } from "./atomic-write.js";
import { ModelProfilesError } from "./errors.js";
import { normalizeProfileFields, sanitizeProfileName } from "./profile-fields.js";
import type { ProfileStoreLoadResult, ProfilesFile, SavedProfile, SavedProfileAgent, ProfileFields } from "./types.js";

interface LegacySavedProfile {
	id: string;
	name: string;
	fields: ProfileFields;
	sourceAgent?: string;
	createdAt: string;
	updatedAt: string;
}

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

function normalizeTimestamp(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : fallback;
}

function normalizeSavedAgents(agents: readonly SavedProfileAgent[]): SavedProfileAgent[] {
	return [...agents]
		.map((agent) => ({
			fileName: agent.fileName,
			agentName: agent.agentName,
			fields: normalizeProfileFields(agent.fields),
		}))
		.sort((left, right) => left.fileName.localeCompare(right.fileName) || left.agentName.localeCompare(right.agentName));
}

function cloneSavedAgents(agents: readonly SavedProfileAgent[]): SavedProfileAgent[] {
	return normalizeSavedAgents(agents);
}

function normalizeSavedAgent(raw: unknown, warnings: string[]): SavedProfileAgent | null {
	const source = toRecord(raw);
	const fileName = normalizeOptionalString(source.fileName) ?? normalizeOptionalString(source.sourceAgent);
	const agentName = sanitizeProfileName(typeof source.agentName === "string" ? source.agentName : "");
	if (!fileName || !agentName) {
		warnings.push("Skipped one malformed saved agent snapshot entry.");
		return null;
	}

	return {
		fileName,
		agentName,
		fields: normalizeProfileFields(source.fields),
	};
}

function dedupeSavedAgents(agents: readonly SavedProfileAgent[], warnings: string[]): SavedProfileAgent[] {
	const byFileName = new Map<string, SavedProfileAgent>();
	for (const agent of agents) {
		const key = agent.fileName.toLowerCase();
		if (byFileName.has(key)) {
			warnings.push(`Saved profile snapshot contained duplicate agent '${agent.fileName}'; kept the last entry.`);
		}
		byFileName.set(key, agent);
	}
	return normalizeSavedAgents([...byFileName.values()]);
}

function normalizeSnapshotProfile(raw: unknown, warnings: string[]): SavedProfile | null {
	const source = toRecord(raw);
	const id = normalizeOptionalString(source.id);
	const name = sanitizeProfileName(typeof source.name === "string" ? source.name : "");
	if (!id || !name) {
		warnings.push("Skipped one malformed saved profile entry.");
		return null;
	}

	if (!Array.isArray(source.agents)) {
		warnings.push(`Saved profile '${name}' was missing its agent snapshot list and was skipped.`);
		return null;
	}

	const timestamp = new Date().toISOString();
	const agents = dedupeSavedAgents(
		source.agents.map((entry) => normalizeSavedAgent(entry, warnings)).filter((entry): entry is SavedProfileAgent => entry !== null),
		warnings,
	);
	if (agents.length === 0) {
		warnings.push(`Saved profile '${name}' had no valid agent snapshots and was skipped.`);
		return null;
	}

	return {
		id,
		name,
		agents,
		createdAt: normalizeTimestamp(source.createdAt, timestamp),
		updatedAt: normalizeTimestamp(source.updatedAt, timestamp),
	};
}

function normalizeLegacySavedProfile(raw: unknown, warnings: string[]): LegacySavedProfile | null {
	const source = toRecord(raw);
	const id = normalizeOptionalString(source.id);
	const name = sanitizeProfileName(typeof source.name === "string" ? source.name : "");
	if (!id || !name) {
		warnings.push("Skipped one malformed legacy saved profile entry.");
		return null;
	}

	const timestamp = new Date().toISOString();
	return {
		id,
		name,
		fields: normalizeProfileFields(source.fields),
		sourceAgent: normalizeOptionalString(source.sourceAgent),
		createdAt: normalizeTimestamp(source.createdAt, timestamp),
		updatedAt: normalizeTimestamp(source.updatedAt, timestamp),
	};
}

function basenameWithoutMarkdown(fileName: string): string {
	return fileName.replace(/\.md$/i, "");
}

function isLegacyImportedProfile(profile: LegacySavedProfile, importedAt: string | undefined): boolean {
	if (!importedAt || !profile.sourceAgent) {
		return false;
	}

	if (profile.createdAt !== importedAt || profile.updatedAt !== importedAt) {
		return false;
	}

	const expectedName = `${basenameWithoutMarkdown(profile.sourceAgent)} ${LEGACY_PROFILE_NAME_SUFFIX}`;
	return profile.name.toLowerCase() === expectedName.toLowerCase();
}

function buildMigrationBaseline(
	agentOptions: string | AgentSelectionOptions,
	warnings: string[],
): SavedProfileAgent[] {
	try {
		const snapshot = captureAgentSnapshots(agentOptions);
		warnings.push(...snapshot.warnings);
		return cloneSavedAgents(snapshot.agents);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`Legacy model profile migration could not read the current agents snapshot: ${message}`);
		return [];
	}
}

function buildImportedSnapshotProfile(importedAt: string, baseline: readonly SavedProfileAgent[], id: string): SavedProfile | null {
	if (baseline.length === 0) {
		return null;
	}

	return {
		id,
		name: INITIAL_PROFILE_NAME,
		agents: cloneSavedAgents(baseline),
		createdAt: importedAt,
		updatedAt: importedAt,
	};
}

function migrateLegacyProfile(profile: LegacySavedProfile, baseline: readonly SavedProfileAgent[], warnings: string[]): SavedProfile | null {
	const nextAgents = cloneSavedAgents(baseline);
	const sourceAgent = profile.sourceAgent;

	if (sourceAgent) {
		const targetIndex = nextAgents.findIndex((agent) => agent.fileName.toLowerCase() === sourceAgent.toLowerCase());
		const agentName = nextAgents[targetIndex]?.agentName ?? basenameWithoutMarkdown(sourceAgent);
		const migratedAgent = {
			fileName: sourceAgent,
			agentName,
			fields: normalizeProfileFields(profile.fields),
		};
		if (targetIndex === -1) {
			nextAgents.push(migratedAgent);
		} else {
			nextAgents[targetIndex] = migratedAgent;
		}
	} else if (nextAgents.length === 0) {
		warnings.push(`Legacy saved profile '${profile.name}' had no source agent and could not be migrated.`);
		return null;
	}

	const agents = normalizeSavedAgents(nextAgents);
	if (agents.length === 0) {
		warnings.push(`Legacy saved profile '${profile.name}' could not be migrated because no agent snapshots were available.`);
		return null;
	}

	return {
		id: profile.id,
		name: profile.name,
		agents,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
	};
}

function normalizeProfilesFile(
	raw: unknown,
	agentOptions: string | AgentSelectionOptions = AGENTS_DIR,
): { data: ProfilesFile; warnings: string[]; needsSave: boolean } {
	const source = toRecord(raw);
	const warnings: string[] = [];
	const importedAt = normalizeOptionalString(source.importedAt);
	const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];

	if (!Array.isArray(source.profiles) && source.profiles !== undefined) {
		warnings.push("Saved profiles file was malformed and has been reset.");
	}

	const snapshotProfiles: SavedProfile[] = [];
	const legacyProfiles: LegacySavedProfile[] = [];
	let needsSave = source.version !== PROFILE_STORE_VERSION;

	for (const rawProfile of rawProfiles) {
		const record = toRecord(rawProfile);
		if (Array.isArray(record.agents)) {
			const normalized = normalizeSnapshotProfile(record, warnings);
			if (normalized) {
				snapshotProfiles.push(normalized);
			}
			continue;
		}

		needsSave = true;
		const legacy = normalizeLegacySavedProfile(record, warnings);
		if (legacy) {
			legacyProfiles.push(legacy);
		}
	}

	if (legacyProfiles.length > 0) {
		const baseline = buildMigrationBaseline(agentOptions, warnings);
		const importedLegacy = legacyProfiles.filter((profile) => isLegacyImportedProfile(profile, importedAt));
		const userLegacy = legacyProfiles.filter((profile) => !isLegacyImportedProfile(profile, importedAt));

		if (importedLegacy.length > 0) {
			const importedProfile = buildImportedSnapshotProfile(importedAt ?? importedLegacy[0]?.createdAt ?? new Date().toISOString(), baseline, importedLegacy[0].id);
			if (importedProfile) {
				snapshotProfiles.push(importedProfile);
			}
		}

		for (const legacy of userLegacy) {
			const migrated = migrateLegacyProfile(legacy, baseline, warnings);
			if (migrated) {
				snapshotProfiles.push(migrated);
			}
		}

		warnings.push("Migrated legacy per-agent model profiles to whole-agents snapshot profiles.");
	}

	const profiles = snapshotProfiles
		.filter((profile, index, allProfiles) => index === allProfiles.findIndex((candidate) => candidate.id === profile.id))
		.map((profile) => ({
			...profile,
			agents: dedupeSavedAgents(profile.agents, warnings),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));

	return {
		data: {
			version: PROFILE_STORE_VERSION,
			importedAt,
			profiles,
		},
		warnings,
		needsSave: needsSave || warnings.length > 0,
	};
}

export function createEmptyProfilesFile(): ProfilesFile {
	return {
		version: PROFILE_STORE_VERSION,
		profiles: [],
	};
}

export function getProfileStorePath(): string {
	return PROFILE_STORE_PATH;
}

export function loadProfilesFile(
	storePath = PROFILE_STORE_PATH,
	agentOptions: string | AgentSelectionOptions = AGENTS_DIR,
): ProfileStoreLoadResult {
	if (!existsSync(storePath)) {
		return { data: createEmptyProfilesFile(), needsSave: false };
	}

	try {
		const rawText = readFileSync(storePath, "utf-8");
		const parsed = JSON.parse(rawText) as unknown;
		const normalized = normalizeProfilesFile(parsed, agentOptions);
		return {
			data: normalized.data,
			warning: normalized.warnings.length > 0 ? normalized.warnings.join(" ") : undefined,
			needsSave: normalized.needsSave,
		};
	} catch {
		return {
			data: createEmptyProfilesFile(),
			warning: `Failed to parse ${storePath}. Saved model profiles were reset in memory until the next successful save.`,
			needsSave: false,
		};
	}
}

export function saveProfilesFile(data: ProfilesFile, storePath = PROFILE_STORE_PATH): void {
	const normalized = normalizeProfilesFile(data).data;
	writeFileAtomic(storePath, `${JSON.stringify(normalized, null, 2)}\n`);
}

export function createProfile(name: string, agents: readonly SavedProfileAgent[], options: { timestamp?: string } = {}): SavedProfile {
	const sanitizedName = sanitizeProfileName(name);
	if (!sanitizedName) {
		throw new ModelProfilesError("Profile names must not be empty.", "INVALID_PROFILE_NAME");
	}

	const normalizedAgents = normalizeSavedAgents(agents);
	if (normalizedAgents.length === 0) {
		throw new ModelProfilesError("Saved profiles must include at least one agent snapshot.", "INVALID_PROFILE_AGENTS");
	}

	const timestamp = options.timestamp ?? new Date().toISOString();
	return {
		id: randomUUID(),
		name: sanitizedName,
		agents: normalizedAgents,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function findProfileById(data: ProfilesFile, profileId: string): SavedProfile | undefined {
	return data.profiles.find((profile) => profile.id === profileId);
}

export function appendProfile(data: ProfilesFile, profile: SavedProfile): ProfilesFile {
	return {
		...data,
		profiles: [...data.profiles, { ...profile, agents: cloneSavedAgents(profile.agents) }],
	};
}

export function renameStoredProfile(data: ProfilesFile, profileId: string, nextName: string): ProfilesFile {
	const sanitizedName = sanitizeProfileName(nextName);
	if (!sanitizedName) {
		throw new ModelProfilesError("Profile names must not be empty.", "INVALID_PROFILE_NAME");
	}

	let found = false;
	const nextProfiles = data.profiles.map((profile) => {
		if (profile.id !== profileId) {
			return profile;
		}
		found = true;
		return {
			...profile,
			name: sanitizedName,
			updatedAt: new Date().toISOString(),
		};
	});

	if (!found) {
		throw new ModelProfilesError(`Saved profile '${profileId}' was not found.`, "PROFILE_NOT_FOUND");
	}

	return {
		...data,
		profiles: nextProfiles,
	};
}

export function resolveUniqueProfileName(baseName: string, profiles: readonly SavedProfile[]): string {
	const sanitizedBase = sanitizeProfileName(baseName) ?? PROFILE_NAME_SUFFIX;
	const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
	if (!existing.has(sanitizedBase.toLowerCase())) {
		return sanitizedBase;
	}

	let counter = 2;
	while (existing.has(`${sanitizedBase} ${counter}`.toLowerCase())) {
		counter += 1;
	}
	return `${sanitizedBase} ${counter}`;
}
