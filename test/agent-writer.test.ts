import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applySavedProfile, captureAgentSnapshots, detectActiveAgentName } from "../src/agent-writer.js";
import { readProfileFieldsFromMarkdown } from "../src/frontmatter-parser.js";
import { createProfile } from "../src/profile-store.js";

interface SymlinkTestContext {
	skip(reason?: string): void;
}

const symlinkSync = (fs as unknown as {
	symlinkSync(target: string, path: string, type?: "file" | "dir" | "junction"): void;
}).symlinkSync;

function createFileSymlinkOrSkip(t: SymlinkTestContext, targetPath: string, linkPath: string): boolean {
	try {
		symlinkSync(targetPath, linkPath, "file");
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		t.skip(`symlink creation unsupported in this environment: ${message}`);
		return false;
	}
}

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

test("captureAgentSnapshots discovers symlinked markdown agents like upstream Pi mono", (t: SymlinkTestContext) => {
	const root = mkdtempSync(join(tmpdir(), "pi-model-profiles-symlink-scan-"));
	const sourceDir = join(root, "source");
	const agentsDir = join(root, "agents");

	try {
		mkdirSync(sourceDir, { recursive: true });
		mkdirSync(agentsDir, { recursive: true });
		const targetPath = join(sourceDir, "linked-agent.md");
		const linkPath = join(agentsDir, "linked-agent.md");
		writeFileSync(
			targetPath,
			[
				"---",
				"name: linked-agent",
				"description: Agent exposed through a symlink",
				"model: upstream/model",
				"temperature: 0.3",
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);
		if (!createFileSymlinkOrSkip(t, targetPath, linkPath)) {
			return;
		}

		const snapshot = captureAgentSnapshots(agentsDir);

		assert.deepEqual(snapshot.agents, [
			{
				fileName: "linked-agent.md",
				agentName: "linked-agent",
				fields: { model: "upstream/model", temperature: 0.3 },
			},
		]);
		assert.deepEqual(snapshot.warnings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("applySavedProfile updates symlinked markdown agents like upstream Pi mono", (t: SymlinkTestContext) => {
	const root = mkdtempSync(join(tmpdir(), "pi-model-profiles-symlink-apply-"));
	const sourceDir = join(root, "source");
	const agentsDir = join(root, "agents");

	try {
		mkdirSync(sourceDir, { recursive: true });
		mkdirSync(agentsDir, { recursive: true });
		const targetPath = join(sourceDir, "linked-agent.md");
		const linkPath = join(agentsDir, "linked-agent.md");
		writeFileSync(
			targetPath,
			[
				"---",
				"name: linked-agent",
				"description: Agent exposed through a symlink",
				"model: stale/model",
				"permission:",
				"  tools:",
				"    read: allow",
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);
		if (!createFileSymlinkOrSkip(t, targetPath, linkPath)) {
			return;
		}
		const snapshot = createProfile("symlink snapshot", [
			{
				fileName: "linked-agent.md",
				agentName: "linked-agent",
				fields: { model: "openai/gpt-5", reasoningEffort: "high" },
			},
		]);

		const applied = applySavedProfile(snapshot, agentsDir);

		assert.equal(applied.appliedAgents.length, 1);
		assert.deepEqual(applied.missingAgents, []);
		assert.deepEqual(applied.warnings, []);
		assert.deepEqual(readProfileFieldsFromMarkdown(readFileSync(linkPath, "utf-8")), {
			model: "openai/gpt-5",
			reasoningEffort: "high",
		});
		assert.match(readFileSync(linkPath, "utf-8"), /permission:\n  tools:\n    read: allow/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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
