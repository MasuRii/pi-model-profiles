import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { COMMAND_NAME, toErrorMessage } from "./errors.js";
import { onResourcesDiscover, refreshModelRegistry } from "./pi-api-utils.js";

export default function modelProfilesExtension(pi: ExtensionAPI): void {
	// Register handler to refresh model registry on /reload
	// This works around the issue where AgentSession.reload() doesn't call ModelRegistry.refresh()
	onResourcesDiscover(pi, (event, ctx): void => {
		if (event.reason === "reload") {
			refreshModelRegistry(ctx);
		}
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Open saved whole-agent model profile snapshots",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			if (args.trim()) {
				ctx.ui.notify(`Usage: /${COMMAND_NAME}`, "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(`/${COMMAND_NAME} requires interactive TUI mode.`, "warning");
				return;
			}

			try {
				const { handleModelProfilesCommand } = await import("./command-handler.js");
				await handleModelProfilesCommand(ctx);
			} catch (error) {
				ctx.ui.notify(`/${COMMAND_NAME} failed: ${toErrorMessage(error)}`, "error");
			}
		},
	});
}
