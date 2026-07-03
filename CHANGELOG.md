# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-07-03

### Added
- Added an `enabled` master config toggle. ([630d6d2](https://github.com/MasuRii/pi-model-profiles/commit/630d6d25e89720eb7bd10dea65f6d1ca9a82087e))

### Changed
- Extracted shared record-utils to eliminate duplication. ([93f4d5c](https://github.com/MasuRii/pi-model-profiles/commit/93f4d5c93e5faf95690534766ee01187395af208))
- Consolidated error handling and profile lookup logic. ([52ab1aa](https://github.com/MasuRii/pi-model-profiles/commit/52ab1aa49d6a25d0517776e12e3c62f627bc5ac8))
- Generalized the modal scroll indicator and clipboard helpers. ([8da9200](https://github.com/MasuRii/pi-model-profiles/commit/8da9200b70c2a42522a1c33ab818698bb9286c0d))
- Updated README with badges and a Ko-fi link. ([30e9752](https://github.com/MasuRii/pi-model-profiles/commit/30e9752dc4c0979410ec536047c860be9cbb125d))
- Widened Pi peer dependency compatibility to include `^0.80.0` and added vulnerability overrides (`protobufjs`, `ws`). ([8fc17c5](https://github.com/MasuRii/pi-model-profiles/commit/8fc17c5d6f4c00a90c9dd750b5284a04caec393f))

## [0.3.4] - 2026-06-16

### Fixed
- Resolved symlinks before writing agent markdown to avoid overwriting the symlink target's parent instead of the linked file.
- Used `parseCompleteNumericScalar` for frontmatter number parsing to handle trailing non-numeric characters correctly.

## [0.3.3] - 2026-06-01

### Changed
- Lazy-loaded the model profiles command handler by extracting it into `src/command-handler.ts`, reducing startup work.
- Widened Pi peer dependency compatibility to include Pi 0.77.x and 0.78.x.

## [0.3.2] - 2026-05-26

### Changed
- Widened peer dependency ranges to `^0.74.0 || ^0.75.0`.

## [0.3.1] - 2026-05-22

### Changed
- Reworked debug logging to redact sensitive values and use asynchronous buffered file writes with safe shutdown.
- Updated Pi peer dependencies and runtime imports to the `@earendil-works` scope.

### Fixed
- Improved debug log writer lifecycle handling so buffered events flush reliably without opening logs when debug is disabled.

## [0.3.0] - 2026-04-30

### Changed
- Refined the model profiles modal layout with wider sizing, a single bordered grid, and clearer model table columns.
- Updated the public README screenshot and usage details.
- Bumped Pi peer dependency ranges to `^0.70.6`.

## [0.2.0] - 2026-04-26

### Added
- Phase 6: Git & publishing preparation.
- NPM package metadata, README, CHANGELOG, LICENSE, and package ignore rules.
- Profile update, removal, persisted sorting, configuration, and file-gated debug logging.

### Fixed
- Confirmation prompts now accept typed input before update or removal actions run.
- Sort menu keyboard handling now works consistently and closes without exiting the modal.
- Profile update and removal command handlers now avoid duplicate scans and duplicate removal events.

## [0.1.0] - 2026-04-25

### Added
- Initial extension structure
- Core profile management functionality
- Frontmatter parser implementation
- Profile store with atomic writes
- Import service for external profiles
- Agent writer for profile application
- Type definitions and error handling
- Test suite for core functionality
