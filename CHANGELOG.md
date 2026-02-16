# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jayminwest/mulch/compare/v0.4.0...HEAD
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
