import { multiProfilesDebugLogger } from "./debug-logger.js";
import { ModelProfilesError } from "./errors.js";
import type { ProfilesFile, ProfileRemovalResult, SavedProfile } from "./types.js";

/**
 * Error code for profile not found during removal.
 */
export const PROFILE_NOT_FOUND_CODE = "PROFILE_NOT_FOUND";

export interface ProfileRemovalUpdateResult {
	data: ProfilesFile;
	result: ProfileRemovalResult;
}

interface ProfileRemovalPlan {
	profile: SavedProfile;
	remainingProfiles: SavedProfile[];
	result: ProfileRemovalResult;
}

function createProfileNotFoundError(profileId: string): ModelProfilesError {
	return new ModelProfilesError(
		`Profile '${profileId}' not found. It may have been removed already.`,
		PROFILE_NOT_FOUND_CODE,
	);
}

function buildRemovalPlan(data: ProfilesFile, profileId: string): ProfileRemovalPlan {
	const profileIndex = data.profiles.findIndex((profile) => profile.id === profileId);
	const profile = data.profiles[profileIndex];

	if (profileIndex === -1 || !profile) {
		multiProfilesDebugLogger.log("profile-removal", {
			event: "removal_failed",
			profileId,
			reason: "profile_not_found",
			profileCount: data.profiles.length,
		});
		throw createProfileNotFoundError(profileId);
	}

	const remainingProfiles = [
		...data.profiles.slice(0, profileIndex),
		...data.profiles.slice(profileIndex + 1),
	];

	return {
		profile,
		remainingProfiles,
		result: {
			removedProfileId: profile.id,
			removedProfileName: profile.name,
			remainingCount: remainingProfiles.length,
		},
	};
}

function logProfileRemoved(plan: ProfileRemovalPlan): void {
	multiProfilesDebugLogger.log("profile-removal", {
		event: "profile_removed",
		profileId: plan.profile.id,
		profileName: plan.profile.name,
		agentCount: plan.profile.agents.length,
		remainingCount: plan.result.remainingCount,
	});
}

/**
 * Remove a profile from the profiles file.
 *
 * Validates that the profile exists before removal.
 * Preserves other profiles unchanged (immutable pattern).
 * Logs removal event via debug logger.
 *
 * @param data - The profiles file data
 * @param profileId - The ID of the profile to remove
 * @returns ProfileRemovalResult with removed profile info and remaining count
 * @throws ModelProfilesError with code PROFILE_NOT_FOUND if profile doesn't exist
 */
export function removeProfile(data: ProfilesFile, profileId: string): ProfileRemovalResult {
	const plan = buildRemovalPlan(data, profileId);
	logProfileRemoved(plan);
	return plan.result;
}

/**
 * Remove a profile and return the updated profiles file with removal metadata.
 *
 * @param data - The profiles file data
 * @param profileId - The ID of the profile to remove
 * @returns New ProfilesFile with the profile removed and removal metadata
 * @throws ModelProfilesError with code PROFILE_NOT_FOUND if profile doesn't exist
 */
export function removeProfileAndUpdate(data: ProfilesFile, profileId: string): ProfileRemovalUpdateResult {
	const plan = buildRemovalPlan(data, profileId);
	logProfileRemoved(plan);

	return {
		data: {
			version: data.version,
			importedAt: data.importedAt,
			profiles: plan.remainingProfiles,
		},
		result: plan.result,
	};
}
