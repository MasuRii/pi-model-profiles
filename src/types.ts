export const PROFILE_FIELD_KEYS = ["model", "temperature", "reasoningEffort"] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/** Sort order for profile listing */
export type ProfileSortOrder = "name-asc" | "name-desc" | "date-asc" | "date-desc";

export interface ProfileFields {
	model?: string;
	temperature?: number;
	reasoningEffort?: string;
}

export interface SavedProfileAgent {
	fileName: string;
	agentName: string;
	fields: ProfileFields;
}

export interface SavedProfile {
	id: string;
	name: string;
	agents: SavedProfileAgent[];
	createdAt: string;
	updatedAt: string;
}

export interface ProfilesFile {
	version: 2;
	importedAt?: string;
	profiles: SavedProfile[];
}

export interface ProfileStoreLoadResult {
	data: ProfilesFile;
	warning?: string;
	needsSave: boolean;
}

export interface AgentFileRecord {
	path: string;
	fileName: string;
	agentName: string;
	fields: ProfileFields;
}

export interface AgentScanResult {
	agents: AgentFileRecord[];
	warnings: string[];
}

export interface AgentSnapshotResult {
	agents: SavedProfileAgent[];
	warnings: string[];
}

export interface AppliedAgentUpdate {
	updatedPath: string;
	fileName: string;
	agentName: string;
	appliedKeys: ProfileFieldKey[];
	removedKeys: ProfileFieldKey[];
}

export interface ApplyProfileResult {
	appliedAgents: AppliedAgentUpdate[];
	missingAgents: string[];
	warnings: string[];
}

export interface ImportProfilesResult {
	data: ProfilesFile;
	imported: boolean;
	importedCount: number;
	warnings: string[];
}

export interface AppliedProfileOutcome extends ApplyProfileResult {
	profileName: string;
}

/** Result of profile removal operation */
export interface ProfileRemovalResult {
	removedProfileId: string;
	removedProfileName: string;
	remainingCount: number;
}

/** Result of profile update operation */
export interface ProfileUpdateResult {
	updatedProfileId: string;
	updatedProfileName: string;
	updatedAgents: number;
	warnings: string[];
}

/** Result of profile sort operation */
export interface ProfileSortResult {
	sortedProfiles: SavedProfile[];
	sortOrder: ProfileSortOrder;
}

// Re-export config types for type access
export type { MultiProfilesConfig } from "./config.js";
