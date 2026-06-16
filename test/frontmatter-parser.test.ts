import test from "node:test";
import assert from "node:assert/strict";

import { readAgentNameFromMarkdown, readProfileFieldsFromMarkdown, updateMarkdownProfileFields } from "../src/frontmatter-parser.js";

test("updateMarkdownProfileFields preserves upstream-style tools scalar while updating profile fields", () => {
	const original = [
		"---",
		"name: planner",
		"description: Creates implementation plans from context and requirements",
		"tools: read, grep, find, ls",
		"model: claude-sonnet-4-5",
		"---",
		"",
		"You are a planning specialist.",
	].join("\n");

	const updated = updateMarkdownProfileFields(original, {
		model: "openai/gpt-5",
		temperature: 0.2,
		reasoningEffort: "high",
	});

	assert.equal(readAgentNameFromMarkdown(updated), "planner");
	assert.deepEqual(readProfileFieldsFromMarkdown(updated), {
		model: "openai/gpt-5",
		temperature: 0.2,
		reasoningEffort: "high",
	});
	assert.equal(
		updated,
		[
			"---",
			"name: planner",
			"description: Creates implementation plans from context and requirements",
			"tools: read, grep, find, ls",
			"model: openai/gpt-5",
			"temperature: 0.2",
			"reasoningEffort: high",
			"---",
			"",
			"You are a planning specialist.",
		].join("\n"),
	);
});

test("updateMarkdownProfileFields preserves local-style agent metadata and nested permissions", () => {
	const original = [
		"---",
		"name: test",
		"mode: subagent",
		"color: '#2D9CDB'",
		"description: Testing agent",
		"model: old/model",
		"temperature: 1",
		"reasoningEffort: xhigh",
		"permission:",
		"  tools:",
		"    bash: allow",
		"    read: allow",
		"  mcp:",
		"    context7_*: allow",
		"---",
		"",
		"<role>",
		"Test role body.",
		"</role>",
	].join("\n");

	const updated = updateMarkdownProfileFields(original, {
		model: "myproxy/gpt-5.5",
		temperature: 0.4,
		reasoningEffort: "high",
	});

	assert.equal(readAgentNameFromMarkdown(updated), "test");
	assert.deepEqual(readProfileFieldsFromMarkdown(updated), {
		model: "myproxy/gpt-5.5",
		temperature: 0.4,
		reasoningEffort: "high",
	});
	assert.equal(
		updated,
		[
			"---",
			"name: test",
			"mode: subagent",
			"color: '#2D9CDB'",
			"description: Testing agent",
			"model: myproxy/gpt-5.5",
			"temperature: 0.4",
			"reasoningEffort: high",
			"permission:",
			"  tools:",
			"    bash: allow",
			"    read: allow",
			"  mcp:",
			"    context7_*: allow",
			"---",
			"",
			"<role>",
			"Test role body.",
			"</role>",
		].join("\n"),
	);
});

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
