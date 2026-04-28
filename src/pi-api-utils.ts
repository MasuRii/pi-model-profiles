/**
 * Type-safe wrappers for pi extension APIs.
 *
 * These wrappers exist because the pi-coding-agent `skipLibCheck` tsconfig
 * setting can prevent TypeScript from fully resolving chained re-exports
 * from the library's internal module structure. The wrapper functions
 * provide explicit type signatures that TypeScript can verify at compile time
 * while delegating to the actual runtime APIs.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * ModelRegistry interface - subset of methods we need.
 * Defined locally to avoid skipLibCheck resolution issues.
 */
interface ModelRegistry {
	refresh(): void;
}

interface ResourcesDiscoverEvent {
	type: "resources_discover";
	cwd: string;
	reason: "startup" | "reload";
}

/**
 * Register a handler for the resources_discover lifecycle event.
 *
 * The `resources_discover` event fires after `session_start` with
 * `reason: "startup"` on initial load and `reason: "reload"` when
 * the user runs `/reload`.
 *
 * @param pi - The extension API instance
 * @param handler - Handler called with the event and extension context
 */
export function onResourcesDiscover(
	pi: ExtensionAPI,
	handler: (event: ResourcesDiscoverEvent, ctx: ExtensionContext) => void,
): void {
	(pi as unknown as { on(event: "resources_discover", handler: (event: ResourcesDiscoverEvent, ctx: ExtensionContext) => void): void }).on("resources_discover", handler);
}

/**
 * Refresh the model registry to reload model definitions from disk.
 *
 * This is needed as a workaround because `AgentSession.reload()` does not
 * call `ModelRegistry.refresh()`, so custom model profiles in `models.json`
 * are not refreshed when `/reload` is executed.
 *
 * @param ctx - The extension context providing access to the model registry
 */
export function refreshModelRegistry(ctx: ExtensionContext): void {
	const registry = (ctx as unknown as { modelRegistry: ModelRegistry }).modelRegistry;
	registry.refresh();
}