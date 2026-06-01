import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
	INITIAL_PROFILE_NAME,
	PROFILE_NAME_SUFFIX,
	PROFILE_STORE_PATH,
} from "./constants.js";
import { applySavedProfile, captureAgentSnapshots, detectActiveAgentName } from "./agent-writer.js";
import { toErrorMessage } from "./errors.js";
import { loadAndPrepareProfiles } from "./import-service.js";
import { updateProfileAndReturn } from "./profile-update-service.js";
import {
	appendProfile,
	createProfile,
	findProfileById,
	renameStoredProfile,
	resolveUniqueProfileName,
	saveProfilesFile,
} from "./profile-store.js";
import { removeProfileAndUpdate } from "./profile-removal-service.js";
import { openProfilesModal, type ProfileModalResult } from "./profile-modal.js";
import type { AppliedProfileOutcome, ProfilesFile } from "./types.js";

function buildCurrentProfileName(activeAgentName: string | null, data: ProfilesFile): string {
	const baseName = activeAgentName ? `${activeAgentName} ${PROFILE_NAME_SUFFIX}` : INITIAL_PROFILE_NAME;
	return resolveUniqueProfileName(baseName, data.profiles);
}

function notifyWarnings(ctx: ExtensionCommandContext, warnings: readonly string[]): void {
	if (warnings.length === 0) {
		return;
	}
	ctx.ui.notify(warnings.join(" "), "warning");
}

function summarizeApplyOutcome(outcome: AppliedProfileOutcome): string {
	const appliedCount = outcome.appliedAgents.length;
	const missingCount = outcome.missingAgents.length;
	const appliedLabel = `${appliedCount} agent file${appliedCount === 1 ? "" : "s"}`;
	if (missingCount === 0) {
		return appliedLabel;
	}
	return `${appliedLabel}; ${missingCount} missing`;
}

async function reloadAfterApply(ctx: ExtensionCommandContext, outcome: AppliedProfileOutcome): Promise<void> {
	const summary = summarizeApplyOutcome(outcome);
	ctx.ui.notify(`Profile '${outcome.profileName}' applied across ${summary}. Reloading…`, "info");

	try {
		await ctx.reload();
	} catch (error) {
		ctx.ui.notify(
			`Profile '${outcome.profileName}' applied across ${summary}, but automatic reload failed: ${toErrorMessage(error)}. Run /reload.`,
			"error",
		);
	}
}

export async function handleModelProfilesCommand(ctx: ExtensionCommandContext): Promise<void> {
	const agentOptions = { cwd: ctx.cwd, scope: "both" as const };
	const prepared = loadAndPrepareProfiles(PROFILE_STORE_PATH, agentOptions);
	notifyWarnings(ctx, prepared.warnings);

	let data = prepared.data;
	const activeAgentName = detectActiveAgentName(ctx.sessionManager, ctx.getSystemPrompt());

	const result: ProfileModalResult = await openProfilesModal(ctx, data, activeAgentName, {
		renameProfile: async (profileId, nextName) => {
			data = renameStoredProfile(data, profileId, nextName);
			saveProfilesFile(data, PROFILE_STORE_PATH);
			return {
				data,
				message: `Renamed saved snapshot to '${nextName.trim()}'.`,
				selectedProfileId: profileId,
			};
		},
		addCurrentProfile: async () => {
			const snapshot = captureAgentSnapshots(agentOptions);
			notifyWarnings(ctx, snapshot.warnings);
			const profile = createProfile(buildCurrentProfileName(activeAgentName, data), snapshot.agents);
			data = appendProfile(data, profile);
			saveProfilesFile(data, PROFILE_STORE_PATH);
			return {
				data,
				message: `Saved current agents snapshot (${snapshot.agents.length} agents).`,
				selectedProfileId: profile.id,
			};
		},
		applyProfile: async (profileId) => {
			const profile = findProfileById(data, profileId);
			if (!profile) {
				throw new Error(`Saved profile '${profileId}' was not found.`);
			}
			const applied = applySavedProfile(profile, agentOptions);
			notifyWarnings(ctx, applied.warnings);
			return {
				...applied,
				profileName: profile.name,
			};
		},
		removeProfile: async (profileId) => {
			const profile = findProfileById(data, profileId);
			if (!profile) {
				throw new Error(`Saved profile '${profileId}' was not found.`);
			}
			const removal = removeProfileAndUpdate(data, profileId);
			data = removal.data;
			saveProfilesFile(data, PROFILE_STORE_PATH);
			return {
				data,
				message: `Removed saved snapshot '${removal.result.removedProfileName}' (${removal.result.remainingCount} snapshots remaining).`,
				selectedProfileId: data.profiles[0]?.id,
			};
		},
		updateProfile: async (profileId) => {
			const profile = findProfileById(data, profileId);
			if (!profile) {
				throw new Error(`Saved profile '${profileId}' was not found.`);
			}
			const update = updateProfileAndReturn(data, profileId, agentOptions);
			notifyWarnings(ctx, update.result.warnings);
			data = update.data;
			saveProfilesFile(data, PROFILE_STORE_PATH);
			return {
				data,
				message: `Updated '${profile.name}' with current agent state (${update.result.updatedAgents} agents).`,
				selectedProfileId: profileId,
			};
		},
	});

	if (result.type === "applied") {
		await reloadAfterApply(ctx, result.outcome);
		return;
	}
}
