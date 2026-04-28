import { multiProfilesDebugLogger } from "./debug-logger.js";
import { ModelProfilesError } from "./errors.js";
import { captureAgentSnapshots, type AgentSelectionOptions } from "./agent-writer.js";
import type { ProfilesFile, ProfileUpdateResult, SavedProfile } from "./types.js";

/**
 * Error code for profile not found during update.
 */
export const PROFILE_NOT_FOUND_CODE = "PROFILE_NOT_FOUND";

export interface ProfileUpdateDataResult {
	data: ProfilesFile;
	result: ProfileUpdateResult;
}

interface ProfileUpdatePlan {
	updatedData: ProfilesFile;
	updatedProfile: SavedProfile;
	previousProfile: SavedProfile;
	result: ProfileUpdateResult;
}

function createProfileNotFoundError(profileId: string): ModelProfilesError {
	return new ModelProfilesError(
		`Profile '${profileId}' not found. It may have been removed already.`,
		PROFILE_NOT_FOUND_CODE,
	);
}

function buildUpdatePlan(
	data: ProfilesFile,
	profileId: string,
	agentOptions: AgentSelectionOptions,
): ProfileUpdatePlan {
	const profileIndex = data.profiles.findIndex((profile) => profile.id === profileId);
	const profile = data.profiles[profileIndex];

	if (profileIndex === -1 || !profile) {
		multiProfilesDebugLogger.log("profile-update", {
			event: "update_failed",
			profileId,
			reason: "profile_not_found",
			profileCount: data.profiles.length,
		});
		throw createProfileNotFoundError(profileId);
	}

	const snapshot = captureAgentSnapshots(agentOptions);
	const updatedProfile: SavedProfile = {
		id: profile.id,
		name: profile.name,
		agents: snapshot.agents,
		createdAt: profile.createdAt,
		updatedAt: new Date().toISOString(),
	};
	const updatedProfiles = [
		...data.profiles.slice(0, profileIndex),
		updatedProfile,
		...data.profiles.slice(profileIndex + 1),
	];

	return {
		updatedData: {
			version: data.version,
			importedAt: data.importedAt,
			profiles: updatedProfiles,
		},
		updatedProfile,
		previousProfile: profile,
		result: {
			updatedProfileId: profile.id,
			updatedProfileName: profile.name,
			updatedAgents: snapshot.agents.length,
			warnings: snapshot.warnings,
		},
	};
}

function logProfileUpdated(plan: ProfileUpdatePlan): void {
	multiProfilesDebugLogger.log("profile-update", {
		event: "profile_updated",
		profileId: plan.updatedProfile.id,
		profileName: plan.updatedProfile.name,
		beforeAgentCount: plan.previousProfile.agents.length,
		afterAgentCount: plan.updatedProfile.agents.length,
		warnings: plan.result.warnings,
	});
}

/**
 * Update a profile with the current agent state.
 *
 * Captures the current agent snapshots and replaces the profile's agents array.
 * Preserves profile.id, profile.name, and profile.createdAt.
 * Updates profile.updatedAt timestamp to current time.
 * Logs update event with before/after agent counts via debug logger.
 *
 * @param data - The profiles file data
 * @param profileId - The ID of the profile to update
 * @param agentOptions - Options for capturing agent snapshots
 * @returns ProfileUpdateResult with updated profile info and agent counts
 * @throws ModelProfilesError with code PROFILE_NOT_FOUND if profile doesn't exist
 */
export function updateProfile(
	data: ProfilesFile,
	profileId: string,
	agentOptions: AgentSelectionOptions,
): ProfileUpdateResult {
	const plan = buildUpdatePlan(data, profileId, agentOptions);
	logProfileUpdated(plan);
	return plan.result;
}

/**
 * Update a profile and return the updated profiles file with update metadata.
 *
 * @param data - The profiles file data
 * @param profileId - The ID of the profile to update
 * @param agentOptions - Options for capturing agent snapshots
 * @returns New ProfilesFile with the profile updated and update metadata
 * @throws ModelProfilesError with code PROFILE_NOT_FOUND if profile doesn't exist
 */
export function updateProfileAndReturn(
	data: ProfilesFile,
	profileId: string,
	agentOptions: AgentSelectionOptions,
): ProfileUpdateDataResult {
	const plan = buildUpdatePlan(data, profileId, agentOptions);
	logProfileUpdated(plan);
	return {
		data: plan.updatedData,
		result: plan.result,
	};
}
