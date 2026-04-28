import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendProfile, createEmptyProfilesFile, createProfile, loadProfilesFile, renameStoredProfile } from "../src/profile-store.js";

test("renameStoredProfile updates only the saved snapshot record", () => {
	const created = createProfile(
		"code snapshot",
		[
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "openai/gpt-5" },
			},
		],
		{ timestamp: "2026-03-10T00:00:00.000Z" },
	);
	const data = appendProfile(createEmptyProfilesFile(), created);

	const renamed = renameStoredProfile(data, created.id, "renamed snapshot");
	assert.equal(renamed.profiles[0]?.name, "renamed snapshot");
	assert.deepEqual(renamed.profiles[0]?.agents, [
		{
			fileName: "code.md",
			agentName: "code",
			fields: { model: "openai/gpt-5" },
		},
	]);
});

test("loadProfilesFile migrates legacy per-agent storage into whole-snapshot profiles", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-model-profiles-store-"));
	const agentsDir = join(tempDir, "agents");
	const storePath = join(tempDir, "profiles.json");
	const importedAt = "2026-03-10T15:42:21.868Z";

	try {
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "code.md"),
			[
				"---",
				"name: code",
				"description: Code agent",
				"model: openai/gpt-5.4",
				"reasoningEffort: high",
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
				"---",
				"Body",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			storePath,
			JSON.stringify(
				{
					version: 1,
					importedAt,
					profiles: [
						{
							id: "imported-code",
							name: "code profile",
							fields: { model: "legacy/old" },
							sourceAgent: "code.md",
							createdAt: importedAt,
							updatedAt: importedAt,
						},
						{
							id: "docs-custom",
							name: "Docs relaxed",
							fields: { temperature: 0.9 },
							sourceAgent: "docs.md",
							createdAt: "2026-03-11T00:00:00.000Z",
							updatedAt: "2026-03-11T00:00:00.000Z",
						},
					],
				},
				null,
				2,
			),
			"utf-8",
		);

		const loaded = loadProfilesFile(storePath, agentsDir);
		assert.equal(loaded.data.version, 2);
		assert.equal(loaded.needsSave, true);
		assert.match(loaded.warning ?? "", /Migrated legacy per-agent model profiles/);
		assert.equal(loaded.data.profiles.length, 2);

		const importedSnapshot = loaded.data.profiles.find((profile) => profile.name === "Current agents snapshot");
		assert.ok(importedSnapshot);
		assert.deepEqual(importedSnapshot?.agents, [
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "openai/gpt-5.4", reasoningEffort: "high" },
			},
			{
				fileName: "docs.md",
				agentName: "docs",
				fields: { temperature: 0.3 },
			},
		]);

		const migratedUserProfile = loaded.data.profiles.find((profile) => profile.name === "Docs relaxed");
		assert.ok(migratedUserProfile);
		assert.deepEqual(migratedUserProfile?.agents, [
			{
				fileName: "code.md",
				agentName: "code",
				fields: { model: "openai/gpt-5.4", reasoningEffort: "high" },
			},
			{
				fileName: "docs.md",
				agentName: "docs",
				fields: { temperature: 0.9 },
			},
		]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
