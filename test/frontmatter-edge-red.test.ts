import test from "node:test";
import assert from "node:assert/strict";

import { readProfileFieldsFromMarkdown } from "../src/frontmatter-parser.js";
import { ModelProfilesError } from "../src/errors.js";
import { normalizeProfileFields } from "../src/profile-fields.js";

test("readProfileFieldsFromMarkdown rejects partial numeric temperature scalars instead of truncating them", () => {
	const markdown = [
		"---",
		"name: code",
		"description: Code agent",
		"temperature: 0.7abc",
		"---",
		"Body",
	].join("\n");

	assert.throws(
		() => readProfileFieldsFromMarkdown(markdown),
		(error: unknown) => {
			if (!(error instanceof ModelProfilesError)) {
				return false;
			}
			assert.equal(error.code, "INVALID_TEMPERATURE");
			assert.match(error.message, /temperature/);
			return true;
		},
	);
});

test("normalizeProfileFields drops partial numeric temperature strings from malformed stored profiles", () => {
	assert.deepEqual(normalizeProfileFields({ temperature: "0.7abc", model: "openai/gpt-5" }), {
		model: "openai/gpt-5",
	});
});
