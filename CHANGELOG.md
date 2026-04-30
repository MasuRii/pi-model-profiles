# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased changes.

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
