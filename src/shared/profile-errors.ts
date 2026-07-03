/**
 * Shared profile error helpers for pi-model-profiles.
 *
 * `createProfileNotFoundError` and `PROFILE_NOT_FOUND_CODE` were previously
 * duplicated in profile-removal-service and profile-update-service. They are
 * consolidated here to satisfy the Avoid Redundancies axis without changing
 * behavior. Both services re-export the symbol to preserve their public API.
 *
 * `findProfileOrThrow` consolidates the lookup-or-throw-with-logging preamble
 * shared by the removal and update services.
 */

import { multiProfilesDebugLogger } from "../debug-logger.js";
import type { ProfilesFile, SavedProfile } from "../types.js";
import { ModelProfilesError } from "../errors.js";

export const PROFILE_NOT_FOUND_CODE = "PROFILE_NOT_FOUND";

/**
 * Build the standard "profile not found" error thrown by the removal and
 * update services when a profile id cannot be located.
 */
export function createProfileNotFoundError(profileId: string): ModelProfilesError {
	return new ModelProfilesError(
		`Profile '${profileId}' not found. It may have been removed already.`,
		PROFILE_NOT_FOUND_CODE,
	);
}

export interface ProfileLookupResult {
	profile: SavedProfile;
	profileIndex: number;
}

/**
 * Locate a profile by id, logging a structured "not found" event and throwing
 * a {@link createProfileNotFoundError} when it is absent.
 *
 * @param data - The profiles file to search.
 * @param profileId - The profile id to locate.
 * @param logChannel - Debug logger channel for the failure event.
 * @param logEvent - Debug logger event name for the failure event.
 * @returns The located profile and its index.
 * @throws {ModelProfilesError} with code {@link PROFILE_NOT_FOUND_CODE}.
 */
export function findProfileOrThrow(
	data: ProfilesFile,
	profileId: string,
	logChannel: string,
	logEvent: string,
): ProfileLookupResult {
	const profileIndex = data.profiles.findIndex((profile) => profile.id === profileId);
	const profile = data.profiles[profileIndex];
	if (profileIndex === -1 || !profile) {
		multiProfilesDebugLogger.log(logChannel, {
			event: logEvent,
			profileId,
			reason: "profile_not_found",
			profileCount: data.profiles.length,
		});
		throw createProfileNotFoundError(profileId);
	}
	return { profile, profileIndex };
}
