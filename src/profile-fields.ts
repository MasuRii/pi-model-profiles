import type { ProfileFieldKey, ProfileFields } from "./types.js";

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

function normalizeTemperatureValue(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function normalizeProfileFields(value: unknown): ProfileFields {
	const source = toRecord(value);
	const fields: ProfileFields = {};

	const model = normalizeOptionalString(source.model);
	if (model) {
		fields.model = model;
	}

	const temperature = normalizeTemperatureValue(source.temperature);
	if (temperature !== undefined) {
		fields.temperature = temperature;
	}

	const reasoningEffort = normalizeOptionalString(source.reasoningEffort);
	if (reasoningEffort) {
		fields.reasoningEffort = reasoningEffort;
	}

	return fields;
}

export function hasProfileFields(fields: ProfileFields): boolean {
	return fields.model !== undefined || fields.temperature !== undefined || fields.reasoningEffort !== undefined;
}

export function describeProfileFields(fields: ProfileFields): string {
	const parts: string[] = [];
	if (fields.model !== undefined) {
		parts.push("model");
	}
	if (fields.temperature !== undefined) {
		parts.push("temperature");
	}
	if (fields.reasoningEffort !== undefined) {
		parts.push("reasoning");
	}
	return parts.length > 0 ? parts.join(", ") : "clears model overrides";
}

export function formatProfileFieldValue(key: ProfileFieldKey, fields: ProfileFields): string {
	switch (key) {
		case "model":
			return fields.model ?? "(absent)";
		case "temperature":
			return fields.temperature !== undefined ? String(fields.temperature) : "(absent)";
		case "reasoningEffort":
			return fields.reasoningEffort ?? "(absent)";
	}
}

export function sanitizeProfileName(value: string): string | null {
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}
