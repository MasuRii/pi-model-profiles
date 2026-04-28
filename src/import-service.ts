import { AGENTS_DIR, INITIAL_PROFILE_NAME, PROFILE_STORE_PATH } from "./constants.js";
import { captureAgentSnapshots, type AgentSelectionOptions } from "./agent-writer.js";
import { appendProfile, createProfile, loadProfilesFile, resolveUniqueProfileName, saveProfilesFile } from "./profile-store.js";
import { loadMultiProfilesConfig } from "./config.js";
import { multiProfilesDebugLogger } from "./debug-logger.js";
import type { ImportProfilesResult, ProfilesFile } from "./types.js";

export function ensureProfilesImported(
	data: ProfilesFile,
	agentOptions: string | AgentSelectionOptions = AGENTS_DIR,
): ImportProfilesResult {
	if (data.importedAt) {
		return {
			data,
			imported: false,
			importedCount: 0,
			warnings: [],
		};
	}

	const snapshot = captureAgentSnapshots(agentOptions);
	const timestamp = new Date().toISOString();
	const profile = createProfile(resolveUniqueProfileName(INITIAL_PROFILE_NAME, data.profiles), snapshot.agents, { timestamp });

	return {
		data: {
			...appendProfile(data, profile),
			importedAt: timestamp,
		},
		imported: true,
		importedCount: 1,
		warnings: snapshot.warnings,
	};
}

export function loadAndPrepareProfiles(
	storePath = PROFILE_STORE_PATH,
	agentOptions: string | AgentSelectionOptions = AGENTS_DIR,
): ImportProfilesResult {
	const configLoad = loadMultiProfilesConfig();

	multiProfilesDebugLogger.log("extension.initialized", {
		configCreated: configLoad.created,
		timestamp: new Date().toISOString(),
		profilesVersion: 2,
	});

	const loaded = loadProfilesFile(storePath, agentOptions);
	const prepared = ensureProfilesImported(loaded.data, agentOptions);

	if (loaded.needsSave || prepared.imported) {
		saveProfilesFile(prepared.data, storePath);
	}

	const warnings = [configLoad.warning, loaded.warning, ...prepared.warnings].filter((message): message is string => Boolean(message));
	return {
		...prepared,
		warnings,
	};
}
