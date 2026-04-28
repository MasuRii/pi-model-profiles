import test from "node:test";
import assert from "node:assert/strict";

import { readAgentNameFromMarkdown, readProfileFieldsFromMarkdown, updateMarkdownProfileFields } from "../src/frontmatter-parser.js";

test("updateMarkdownProfileFields preserves unrelated content and removes absent keys", () => {
	const original = [
		"---",
		"name: code",
		"description: Example agent",
		"model: old/model",
		"temperature: 0.7",
		"permission:",
		"  tools:",
		"    bash: allow",
		"---",
		"<role>",
		"Keep this body intact.",
		"</role>",
		"",
	].join("\n");

	const updated = updateMarkdownProfileFields(original, {
		model: "new/model",
		reasoningEffort: "high",
	});

	assert.equal(readAgentNameFromMarkdown(updated), "code");
	assert.deepEqual(readProfileFieldsFromMarkdown(updated), {
		model: "new/model",
		reasoningEffort: "high",
	});
	assert.ok(updated.includes("permission:\n  tools:\n    bash: allow"));
	assert.ok(updated.includes("<role>\nKeep this body intact.\n</role>\n"));
	assert.ok(!updated.includes("temperature: 0.7"));
});
