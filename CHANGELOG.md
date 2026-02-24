# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-02-24

### Changed
- **BREAKING**: Switched runtime from Node.js to Bun — `bun` is now required
- Replaced vitest with `bun:test` for all 675 tests across 32 files
- Replaced ESLint/Prettier with Biome for linting and formatting
- Source `.ts` files shipped directly (no build step needed)
- All import extensions changed from `.js` to `.ts` (145 in src/, 98 in test/)
- Simplified Ajv imports — Bun handles ESM/CJS interop natively (removed `_Ajv.default ?? _Ajv` shim)
- Simplified `src/utils/version.ts` — uses `import.meta.dir` instead of `fileURLToPath`/`dirname`
- CI workflows (`ci.yml`, `publish.yml`) now use `oven-sh/setup-bun@v2`
- Onboard snippet now includes version marker (`mulch-onboard-v:1`) for staleness detection
- Bumped `ajv` from 8.17.1 to 8.18.0

### Removed
- `dist/` build output (Bun runs `.ts` directly)
- `vitest.config.ts` (using `bun:test`)
- `package-lock.json` (using `bun.lock`)
- `.beads/` directory (replaced by `.seeds/` for issue tracking)

### Testing
- 675 tests across 32 files, 1541 expect() calls

## [0.5.0] - 2026-02-20

### Added

#### Programmatic API
- High-level programmatic API (`src/api.ts`) — `recordExpertise()`, `searchExpertise()`, `queryDomain()`, `editRecord()` for use as a library, with full type exports via `src/index.ts`

#### Query Command Enhancements
- `--outcome-status <status>` filter for `mulch query` — filter records by outcome status (success/failure)
- `--sort-by-score` flag for `mulch query` — sort results by confirmation-frequency score (highest first)

### Changed

- **Breaking**: Migrated `BaseRecord.outcome` (singular `Outcome`) to `outcomes` (array `Outcome[]`) — existing records with `outcome` field should be migrated to `outcomes: [...]`
- Schema, scoring, format, search, query, edit, and record commands all updated for `outcomes[]` array

### Testing

- New `test/api.test.ts` with 26 tests for the programmatic API
- Expanded `test/commands/query.test.ts` from 6 to 31 tests (outcome-status filter, sort-by-score, JSON output mode)
- 671 tests across 32 test files

## [0.4.3] - 2026-02-20

### Added

- Confirmation-frequency scoring module (`src/utils/scoring.ts`) — tracks record application outcomes (success/failure/partial) and computes confirmation scores for prioritization
- Optional `outcome` field on all record types — agents can record whether applying a record's guidance succeeded or failed (`--outcome-status`, `--outcome-duration`, `--outcome-test-results`, `--outcome-agent`)
- `--sort-by-score` flag for `mulch search` — orders results by confirmation-frequency score (most-confirmed records first)
- `--classification` filter for `mulch search` and `mulch query` — filter by foundational/tactical/observational
- `--file` filter for `mulch search` and `mulch query` — substring match on records with `files[]` field
- `filterByClassification()` and `filterByFile()` utilities in `src/utils/expertise.ts`

### Changed

- `mulch prime` budget sorting now uses confirmation score as a third-level sort factor (after type and classification, before recency)
- `DomainRecords.records` widened from `ExpertiseRecord[]` to `ScoredRecord[]` to support outcomes

### Testing

- New `test/utils/scoring.test.ts` with 40 tests for the scoring module
- 625 tests across 31 test files

## [0.4.2] - 2026-02-17

### Fixed

- `compact --auto` now respects domain argument to filter compaction to specific domain
- `compact --analyze` now respects domain argument to filter analysis to specific domain
- `compact --auto --dry-run` shows detailed preview instead of terse summary
- `compact --analyze` output has better formatting with domain grouping and visual hierarchy
- `doctor` command now prints `check.details` for non-pass checks (e.g., governance threshold violations were silently hidden)

### Testing

- Added comprehensive domain filtering tests for compact command
- Added doctor governance threshold violation detection test
- 539 tests across 30 test files

## [0.4.1] - 2026-02-17

### Added

- Quick reference section in compact `mulch prime` output — shows essential commands (`search`, `prime --files`, `prime --context`, `record`, `doctor`) so agents have a cheat sheet without switching to `--full` mode

### Testing

- 532 tests across 30 test files

## [0.4.0] - 2026-02-15

### Added

- BM25 search ranking algorithm — `mulch search` now returns results ranked by relevance instead of raw order (`src/utils/bm25.ts`)
- `--dry-run` flag for `mulch record` — preview what would be created/updated/skipped without writing to JSONL (works with `--batch` and `--stdin`)
- `--batch <file>` flag for `mulch record` — read JSON records from a file (more discoverable alternative to `--stdin`)
- Cross-domain record references — `relates_to` and `supersedes` now accept `domain:mx-hash` format (e.g., `api:mx-abc123`) in addition to local `mx-hash`
- Required-fields-per-type table in `mulch record --help` output
- Comprehensive tests for `src/index.ts` exports

### Changed

- `mulch search` uses BM25 scoring for ranked results instead of simple substring matching
- README: added 'Batch recording' section documenting `--batch` and `--stdin` workflows
- `mulch prime` verbose output updated to show `--batch` alongside `--stdin`

## [0.3.1] - 2026-02-15

### Changed

- `mulch prime` full/verbose output now documents `mulch learn`, `mulch sync`, `mulch diff`, `mulch compact --auto`, `--files`/`--exclude-domain` flags, `--evidence-bead`/`--evidence-commit` evidence linking, and `--stdin` batch recording
- Session close protocol (all formats) streamlined from 4 steps to 3: `mulch learn` → `mulch record` → `mulch sync` (replaces manual `mulch validate` + `git add` + `git commit`)
- Onboard snippet (`CLAUDE.md`/`AGENTS.md`) updated with `mulch prime --files` tip, evidence linking, and `mulch learn`/`mulch sync` workflow
- Provider setup recipes (Cursor, Codex, Gemini, Windsurf, Aider) updated with same session-end workflow

## [0.3.0] - 2026-02-13

### Added

- `mulch diff` command — shows expertise changes between git refs (`mulch diff HEAD~3`, `mulch diff main..feature`)
- `--files` flag for `mulch prime` — filter records by file paths (`mulch prime --files src/utils/config.ts`)
- `--exclude-domain` flag for `mulch prime` — exclude specific domains from output
- `--stdin` flag for `mulch record` — batch-record from JSON on stdin (single object or array)
- `--evidence-bead` flag for `mulch record` — link records to bead issue IDs
- `compact --auto` flag — deterministic auto-compaction that merges groups of same-type records without LLM
- `compact --auto` guardrails — `--min-group <n>`, `--max-records <n>`, and `--dry-run` flags to control compaction aggressiveness
- Health metrics in `status --json` — `governance_utilization`, `stale_count`, `staleness_ratio`, classification breakdowns per domain
- Functional API export (`src/index.ts`) — programmatic access to config, expertise, and schema utilities
- Optional `bead` field on Evidence type for linking records to issue trackers
- CONTRIBUTING.md with fork/branch workflow, ESM conventions, and test guidelines
- SECURITY.md with private vulnerability reporting via GitHub Security Advisories
- PR template and issue templates (bug report, feature request)
- Dependabot config for npm and GitHub Actions dependency updates
- FUNDING.yml for GitHub Sponsors
- README badges (npm version, CI status, license, node version)

### Changed

- `record --stdin` infers record type from JSON input when `--type` is omitted
- `record --stdin` defaults classification to `tactical` when not specified
- Auto-tag git releases in publish workflow on version bump
- Enabled auto-delete of merged PR branches
- Required CI status checks on main branch protection

### Fixed

- `--full` flag being ignored in `prime` command
- `--files` flag referencing undefined variable in `prime` command

### Security

- Hardened against command injection, path traversal, symlink attacks, and temp file races (thanks @burakseyman)

## [0.2.5] - 2026-02-12

### Added

- Session-end reminder section in `mulch prime` output — reminds agents to record learnings before completing tasks (all non-MCP formats)
- Token budget for `mulch prime` — `--budget <tokens>` (default 4000) caps output size with smart record prioritization (conventions first, then decisions, patterns, guides, failures, references)
- `--no-limit` flag to disable token budget

## [0.2.4] - 2026-02-12

### Added

- Advisory file locking (`withFileLock`) for safe concurrent writes across multiple agents
- Atomic JSONL writes via temp file + rename to prevent partial/corrupt files

### Fixed

- CI workflow now runs `build` before `test` so integration tests find `dist/cli.js`

## [0.2.3] - 2026-02-11

### Added

- `mulch update` command — checks npm registry for newer versions and installs them (`--check` for dry run)
- Version check integrated into `mulch doctor`
- `mulch onboard` now uses `<!-- mulch:start -->` / `<!-- mulch:end -->` markers for idempotent updates

### Changed

- Record addressing switched from 1-based JSONL line indices to stable `mx-` prefix IDs

## [0.2.2] - 2026-02-11

### Changed

- Standardized on ID-based record addressing (replacing line-index addressing in `edit` and `delete`)

## [0.2.1] - 2026-02-10

### Changed

- Synced all user-facing messaging across onboard snippets, setup recipes, CLAUDE.md, and README
- Agent prompts now ask agents to "review your work for insights" before completing tasks

## [0.2.0] - 2026-02-10

### Added

- `reference` and `guide` record types
- Multi-domain scoping for `mulch prime` (variadic args and `--domain` flag)
- `mulch search` command with case-insensitive substring matching, `--domain` and `--type` filters
- `mulch compact` command with `--analyze` mode for finding compaction candidates
- Record deduplication in `mulch record` (upsert named types, skip exact-match unnamed types, `--force` override)
- Optional `tags` field on all record types
- Compact output as default for `mulch prime` (`--full` for verbose)
- GitHub Actions CI workflow (lint, build, test)
- GitHub Actions publish workflow (auto-publish to npm on version bump)

### Fixed

- Flaky prune boundary test — `Math.floor` age-in-days so boundary records land on exact whole days

## [0.1.0] - 2026-02-10

### Added

- Initial release
- Core commands: `init`, `add`, `record`, `edit`, `query`, `prime`, `status`, `validate`
- Infrastructure commands: `setup`, `onboard`, `prune`, `doctor`
- JSONL storage in `.mulch/expertise/<domain>.jsonl`
- YAML config at `.mulch/mulch.config.yaml`
- Six record types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide`
- Three classifications with shelf lives: `foundational` (permanent), `tactical` (14 days), `observational` (30 days)
- Provider setup recipes for Claude, Cursor, Codex, Gemini, Windsurf, and Aider
- Git merge strategy (`merge=union`) for JSONL via `.gitattributes`
- Schema validation with Ajv
- Prime output formats: `xml`, `plain`, `markdown`, `--mcp` (JSON)
- Context-aware prime via `--context` (filters by git changed files)

[Unreleased]: https://github.com/jayminwest/mulch/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/jayminwest/mulch/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jayminwest/mulch/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/jayminwest/mulch/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/jayminwest/mulch/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/jayminwest/mulch/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jayminwest/mulch/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/jayminwest/mulch/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/jayminwest/mulch/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/jayminwest/mulch/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/jayminwest/mulch/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/jayminwest/mulch/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/jayminwest/mulch/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/jayminwest/mulch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jayminwest/mulch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jayminwest/mulch/releases/tag/v0.1.0
