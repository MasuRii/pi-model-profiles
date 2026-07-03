/**
 * Shared record and string coercion utilities for pi-model-profiles.
 *
 * These helpers were previously duplicated across agent-writer, config,
 * modal-theme, profile-fields, and profile-store. They are consolidated
 * here to satisfy the Avoid Redundancies axis without changing behavior.
 */

/**
 * Coerce an unknown value into a plain object record.
 *
 * Returns an empty record for `null`, `undefined`, non-objects, and arrays;
 * otherwise returns the value cast to a record. Behavior matches the
 * per-module implementations that previously existed in every consumer.
 */
export function toRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

/**
 * Normalize an unknown value into a trimmed non-empty string, or `undefined`.
 *
 * Returns `undefined` for non-strings and for strings that are empty or
 * contain only whitespace.
 */
export function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}
