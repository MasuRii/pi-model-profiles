import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applySavedProfile, captureAgentSnapshots, detectActiveAgentName } from "../src/agent-writer.js";
import { readProfileFieldsFromMarkdown } from "../src/frontmatter-parser.js";
import { createProfile } from "../src/profile-store.js";

test("detectActiveAgentName prefers saved session entry and falls back to system prompt", () => {
	const fromEntry = detectActiveAgentName(
		{
			getEntries() {
				return [{ type: "custom", customType: "active_agent", data: { name: "docs" } }];
			},
		},
		"<active_agent_identity name=\"code\">",
	);
	assert.equal(fromEntry, "docs");

	const fromPrompt = detectActiveAgentName(
		{
			getEntries() {
				return [];
			},
		},
		'<active_agent_identity name="product" mode="delegated">',
	);
	assert.equal(fromPrompt, "product");

	const disabled = detectActiveAgentName(
		{
			getEntries() {
				return [{ type: "custom", customType: "active_agent", data: { name: null } }];
			},
		},
		"",
	);
	assert.equal(disabled, null);
});

test("captureAgentSnapshots prefers project-local agents when cwd scope includes project", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-model-profiles-capture-"));
	const globalAgentsDir = join(root, "global-agents");
	const projectAgentsDir = join(root, ".pi", "agents");

	try {
		mkdirSync(globalAgentsDir, { recursive: true });
		mkdirSync(projectAgentsDir, { recursive: true });
		writeFileSync(
			join(globalAgentsDir, "code.md"),
			["---", "name: code", "description: Global code", "model: global/model", "---", "Body"].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(projectAgentsDir, "code.md"),
			["---", "name: code", "description: Project code", "model: project/model", "---", "Body"].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(projectAgentsDir, "anki-flashcard-generator.md"),
			["---", "name: anki-flashcard-generator", "description: Project only", "temperature: 0.2", "---", "Body"].join("\n"),
			"utf-8",
		);

		const snapshot = captureAgentSnapshots({ agentsDir: globalAgentsDir, cwd: root, scope: "both" });
		assert.deepEqual(snapshot.agents, [
			{
				fileName: "anki-flashcard-generator.md",
				agentName: "anki-flashcard-generator",
				fields: { temperature: 0.2 },
			},
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "project/model" },
			},
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("applySavedProfile writes the selected whole-directory snapshot across matching agent files", () => {
	const agentsDir = mkdtempSync(join(tmpdir(), "pi-model-profiles-apply-"));

	try {
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "code.md"),
			[
				"---",
				"name: code",
				"description: Code agent",
				"model: old/model",
				"temperature: 0.7",
				"permission:",
				"  tools:",
				"    bash: allow",
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(agentsDir, "docs.md"),
			[
				"---",
				"name: docs",
				"description: Docs agent",
				"model: stale/model",
				"reasoningEffort: low",
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);

		const snapshot = createProfile("release snapshot", [
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "openai/gpt-5", reasoningEffort: "high" },
			},
			{
				fileName: "docs.md",
				agentName: "docs",
				fields: { temperature: 0.1 },
			},
		]);

		const applied = applySavedProfile(snapshot, agentsDir);
		assert.equal(applied.appliedAgents.length, 2);
		assert.deepEqual(applied.missingAgents, []);
		assert.deepEqual(applied.warnings, []);

		assert.deepEqual(readProfileFieldsFromMarkdown(readFileSync(join(agentsDir, "code.md"), "utf-8")), {
			model: "openai/gpt-5",
			reasoningEffort: "high",
		});
		assert.deepEqual(readProfileFieldsFromMarkdown(readFileSync(join(agentsDir, "docs.md"), "utf-8")), {
			temperature: 0.1,
		});
		assert.match(readFileSync(join(agentsDir, "code.md"), "utf-8"), /permission:\n  tools:\n    bash: allow/);
	} finally {
		rmSync(agentsDir, { recursive: true, force: true });
	}
});

test("applySavedProfile updates project-local overrides when cwd scope includes project", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-model-profiles-apply-project-"));
	const globalAgentsDir = join(root, "global-agents");
	const projectAgentsDir = join(root, ".pi", "agents");

	try {
		mkdirSync(globalAgentsDir, { recursive: true });
		mkdirSync(projectAgentsDir, { recursive: true });
		writeFileSync(
			join(globalAgentsDir, "code.md"),
			["---", "name: code", "description: Global code", "model: global/model", "---", "Body"].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(projectAgentsDir, "code.md"),
			["---", "name: code", "description: Project code", "model: project/model", "---", "Body"].join("\n"),
			"utf-8",
		);

		const snapshot = createProfile("project snapshot", [
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "openai/gpt-5", reasoningEffort: "high" },
			},
		]);

		const applied = applySavedProfile(snapshot, { agentsDir: globalAgentsDir, cwd: root, scope: "both" });
		assert.equal(applied.appliedAgents.length, 1);
		assert.equal(readProfileFieldsFromMarkdown(readFileSync(join(projectAgentsDir, "code.md"), "utf-8")).model, "openai/gpt-5");
		assert.equal(readProfileFieldsFromMarkdown(readFileSync(join(globalAgentsDir, "code.md"), "utf-8")).model, "global/model");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
