import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureProfilesImported } from "../src/import-service.js";
import { createEmptyProfilesFile } from "../src/profile-store.js";

test("ensureProfilesImported creates one whole-agents snapshot profile and only imports once", () => {
	const agentsDir = mkdtempSync(join(tmpdir(), "pi-model-profiles-agents-"));

	try {
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "code.md"),
			[
				"---",
				"name: code",
				"description: Code agent",
				"model: openai/gpt-5",
				"reasoningEffort: high",
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
				"temperature: 0.3",
				"color: '#ffffff'",
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);

		const first = ensureProfilesImported(createEmptyProfilesFile(), agentsDir);
		assert.equal(first.imported, true);
		assert.equal(first.importedCount, 1);
		assert.ok(typeof first.data.importedAt === "string");
		assert.equal(first.data.profiles.length, 1);
		assert.equal(first.data.profiles[0]?.name, "Current agents snapshot");
		assert.deepEqual(first.data.profiles[0]?.agents, [
			{
				fileName: "code.md",
				agentName: "code",
				fields: {
					model: "openai/gpt-5",
					reasoningEffort: "high",
				},
			},
			{
				fileName: "docs.md",
				agentName: "docs",
				fields: {
					temperature: 0.3,
				},
			},
		]);

		const second = ensureProfilesImported(first.data, agentsDir);
		assert.equal(second.imported, false);
		assert.equal(second.importedCount, 0);
		assert.equal(second.data.profiles.length, 1);
	} finally {
		rmSync(agentsDir, { recursive: true, force: true });
	}
});
