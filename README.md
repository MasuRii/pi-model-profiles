# pi-model-profiles

[![npm version](https://img.shields.io/npm/v/pi-model-profiles?style=flat-square)](https://www.npmjs.com/package/pi-model-profiles) [![License](https://img.shields.io/github/license/MasuRii/pi-model-profiles?style=flat-square)](LICENSE)

<img width="1389" height="768" alt="image" src="https://github.com/user-attachments/assets/7170fed2-018f-4719-a147-3bd7967456bc" />

`pi-model-profiles` is a Pi extension for saving, updating, deleting, sorting, and applying whole-agent model frontmatter snapshots.

- **Command:** `/model-profiles`
- **npm:** https://www.npmjs.com/package/pi-model-profiles
- **GitHub:** https://github.com/MasuRii/pi-model-profiles

## Features

- Save the current user/project agent model frontmatter as a reusable snapshot.
- Apply a saved snapshot across matching agent markdown files with atomic writes.
- Rename, update, remove, and sort saved snapshots from the interactive modal.
- Preserve profile data in `profiles.json` with schema-versioned migration support.
- Write optional debug logs only to the extension-local `debug/` directory when enabled.

## Installation

### npm package

```bash
pi install npm:pi-model-profiles
```

### Git repository

```bash
pi install git:github.com/MasuRii/pi-model-profiles
```

### Local extension folder

Place this folder in one of Pi's extension discovery paths:

| Scope | Path |
|-------|------|
| Global default | `~/.pi/agent/extensions/pi-model-profiles` (respects `PI_CODING_AGENT_DIR`) |
| Project | `.pi/extensions/pi-model-profiles` |

Pi discovers the extension through the root `index.ts` entry listed in `package.json`.

## Usage

Run the command in interactive TUI mode:

```text
/model-profiles
```

Modal shortcuts:

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Move through snapshots |
| `Enter` | Apply selected snapshot |
| `s` | Save current agent state as a new snapshot |
| `r` | Rename selected snapshot |
| `Ctrl+U` | Update selected snapshot from current agent state |
| `Delete` / `Ctrl+D` | Remove selected snapshot after confirmation |
| `Ctrl+S` | Open sort menu |
| `Esc` | Close modal, cancel input, or close sort menu |

## Configuration

Runtime configuration lives in `config.json` at the extension root. The extension creates the file automatically with defaults on first load if it does not already exist.

A starter template is included at `config/config.example.json`. Copy it to `config.json` for local customization, or let the extension create `config.json` with defaults on first load.

```json
{
  "debug": false,
  "profiles": {
    "autoSave": true,
    "maxProfiles": 100
  },
  "sorting": {
    "defaultSort": "date-desc"
  }
}
```

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `debug` | `boolean` | `false` | Enables debug logging under `debug/` directory |
| `profiles.autoSave` | `boolean` | `true` | Reserved profile persistence setting |
| `profiles.maxProfiles` | `number` | `100` | Reserved maximum profile retention setting |
| `sorting.defaultSort` | `name-asc \| name-desc \| date-asc \| date-desc` | `date-desc` | Default snapshot sort order |

## Profile Storage

Profile data is persisted in `profiles.json` at the extension root and should not be edited while Pi is running.

```json
{
  "version": 2,
  "importedAt": "2026-04-26T00:00:00.000Z",
  "profiles": [
    {
      "id": "profile-id",
      "name": "Current agents snapshot",
      "createdAt": "2026-04-26T00:00:00.000Z",
      "updatedAt": "2026-04-26T00:00:00.000Z",
      "agents": [
        {
          "fileName": "code.md",
          "agentName": "code",
          "fields": {
            "model": "provider/model",
            "temperature": 0.2,
            "reasoningEffort": "medium"
          }
        }
      ]
    }
  ]
}
```

## Debug Logging

Debug logging is controlled by the `debug` property in `config.json`.

- When `debug` is `false` or absent, no debug file handles are opened and no debug files are written.
- When `debug` is `true`, debug events are appended to `debug/pi-model-profiles-debug.jsonl`.
- Debug output is never written to console, stdout, or stderr.

## Development

```bash
npm install
npm run build
npm run lint
npm run test
npm run check
npm run package:dry-run
```

## Publishing

The package metadata follows the same publish-ready shape used by established Pi extensions:

- entrypoint: `index.ts`
- package exports: `.` → `./index.ts`
- Pi extension manifest: `pi.extensions`
- published files: source, README, changelog, license, and config template
- runtime `config.json`, `profiles.json`, and `debug/` logs excluded from npm publication

## Related Pi Extensions

- [pi-context-injector](https://github.com/MasuRii/pi-context-injector) — Inject compact project context into first-turn and compaction prompts
- [pi-agent-router](https://github.com/MasuRii/pi-agent-router) — Active-agent routing and controlled subagent delegation
- [pi-multi-auth](https://github.com/MasuRii/pi-multi-auth) — Multi-provider credential management, OAuth login, and account rotation
- [pi-tool-display](https://github.com/MasuRii/pi-tool-display) — Compact tool rendering and diff visualization

## License

[MIT](LICENSE)
