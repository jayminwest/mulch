# Mulch — V1 Scope

## One-Liner
Structured expertise management for AI agents — store, query, and inject project learnings across sessions via git-tracked JSONL files.

## V1 Definition of Done

### Core Commands (14)
- [x] `init` — creates `.mulch/`, config, `.gitattributes` (merge=union), `.mulch/README.md`
- [x] `add` — adds a domain to config
- [x] `record` — stores expertise with type/classification/evidence; semantic dedup detection; auto-creates domain; per-type required fields enforced
- [x] `query` — retrieves records for a domain; `--format` flag (markdown, compact, ids)
- [x] `prime` — injects context with token budget; 4 formats (markdown, compact, XML, plain); `--files` and `--context` filters; `--export` flag
- [x] `search` — BM25 full-text search with `--sort-by-score`, `--format` flag (markdown, compact, ids); cross-domain ranked results
- [x] `edit` — updates a record by ID prefix
- [x] `delete` — removes records by ID; bulk delete (`--records <ids>`, `--all-except <ids>`); `--dry-run` flag
- [x] `delete-domain` — removes domain from config, deletes JSONL file; `--yes` flag; file-locked
- [x] `upgrade` — checks npm registry and installs latest version; `--check` flag for version check only
- [x] `update` — deprecated alias for `upgrade` (redirects with notice)
- [x] `outcome` — appends outcome metadata (status, duration, test_results, agent) to a record
- [x] `status` — shows domain health metrics (governance_utilization, record counts); `--json` output
- [x] `validate` — validates JSONL schema; warns on legacy `outcome` (singular) field

### Maintenance Commands (7)
- [x] `compact` — deduplicates and consolidates records; `--analyze` finds candidates (3+ same type, 2+ stale)
- [x] `prune` — removes stale records by classification shelf life (foundational=permanent, tactical=14d, observational=30d)
- [x] `doctor` — health checks; `--fix` auto-repairs; detects invalid JSON, legacy outcome field, stale locks; details printed for non-pass checks
- [x] `sync` — validates, stages, and commits `.mulch/` changes (git-integrated)
- [x] `diff` — shows uncommitted `.mulch/` changes
- [x] `learn` — shows recently modified files to help decide what to record
- [x] `ready` — shows unblocked work from `.seeds/`

### Agent Onboarding Commands (2)
- [x] `onboard` — idempotent insertion of Mulch usage block into target file via `<!-- mulch:start/end -->` markers
- [x] `setup` — installs provider-specific integration recipes; 6 providers: claude, cursor, codex, gemini, windsurf, aider; idempotent install/check/remove

### Schema & Record Model
- [x] 6 record types enforced via Ajv strict mode:
  - `convention` — required: `content`
  - `pattern` — required: `name`, `description`; optional: `files`
  - `failure` — required: `description`, `resolution`
  - `decision` — required: `title`, `rationale`
  - `reference` — required: `name`, `description`; optional: `files`
  - `guide` — required: `name`, `description`
- [x] 3 classifications with shelf lives: `foundational` (permanent), `tactical` (14d), `observational` (30d)
- [x] Evidence tracking: `--evidence-commit`, `--evidence-bead` flags
- [x] Record linking: `relates_to` and `supersedes` optional string arrays
- [x] Outcomes array: multiple outcome entries per record (status, duration, test_results, agent)

### Multi-Agent Safety
- [x] Advisory file locking: `O_CREAT|O_EXCL` lock files, 50ms retry, 5s timeout, 30s stale detection
- [x] Atomic JSONL writes: temp file + rename prevents partial/corrupt writes
- [x] Git `merge=union` strategy in `.gitattributes` — keeps all unique lines from both sides on conflict
- [x] Write commands use locking: record, edit, delete, compact, prune, doctor --fix
- [x] Read-only commands (prime, query, search, status, validate) need no locking

### Programmatic API
- [x] `recordExpertise`, `searchExpertise`, `queryDomain`, `editRecord` exported from `src/api.ts`
- [x] `appendOutcome` available via API
- [x] Scoring functions: `computeConfirmationScore`, `sortByConfirmationScore`, `getSuccessRate` from `src/utils/scoring.ts`

### Testing
- [x] **775 tests passing** — 39 test files, 1793 `expect()` calls, ~15-17s runtime
- [x] All 24 commands have dedicated test files
- [x] No mocks — all tests use real filesystems with temp directories
- [x] No `.skip` / `.todo` patterns in test suite
- [x] Edge cases covered: empty domains/files, corrupt JSONL, invalid JSON lines, duplicate detection, file locking/concurrency, atomic writes, missing domains, invalid IDs, flag conflicts
- [x] 12 new tests added since v0.6.3 release (763 → 775): sync git integration, upgrade version checking, bulk delete

### CI / Publishing
- [x] TypeScript strict mode clean (`bun run typecheck`)
- [x] Linting: 0 errors; 435 `noNonNullAssertion` warnings (Biome style rule — all safe in context)
- [x] CI: GitHub Actions runs lint + typecheck + test on push/PR (Ubuntu only — no macOS/Windows matrix)
- [x] Published to npm as `@os-eco/mulch-cli` v0.6.3 (2026-02-26)
- [x] Version consistent across `package.json`, `src/cli.ts`, and npm registry
- [x] Shell completion scripts generated for bash, zsh, fish (`ml completions <shell>`)

### Code Health
- [x] 6,486 lines in `src/commands/`, ~2,000 lines in `src/utils/`, 40 source files total
- [x] Zero `TODO` / `FIXME` / `HACK` comments in source code
- [x] ESM-only: all relative imports use `.ts` extensions
- [x] Ajv strict mode throughout

## Explicitly Out of Scope for V1

- `mulch rank` command — confirmation score top-N without text query; deferred as mulch-cky (P3)
- Semantic clustering in `compact --analyze` (TF-IDF / cosine similarity grouping); deferred as seeds-e2bd (P3)
- Web UI or dashboard for browsing expertise
- Remote/cloud sync — git is the transport layer
- Multi-repo expertise federation (querying across repos)
- LLM-powered compaction or summarization
- Outcome analytics or trend reporting beyond what `doctor` shows
- Plugin system for custom record types
- Shell completion end-to-end integration testing (script generation is tested; live shell tab-completion is not)
- CI matrix for macOS/Windows (Ubuntu-only for now)

## Current State

Mulch is V1-complete. All 24 CLI commands are implemented and tested. 775 tests pass across 39 files with 1793 `expect()` calls, no mocks, and no skipped tests. TypeScript strict mode and CI are clean. Published to npm at v0.6.3 (2026-02-26). The programmatic API is stable and actively used by overstory. Multi-agent concurrency is battle-tested (advisory locks + atomic writes + git merge=union). Source code has zero TODO/FIXME/HACK comments.

Test count grew from 763 (v0.6.3 release) to 775 (+12) since last release — new coverage for sync git integration, upgrade version checking, and bulk delete. The upgrade `--check` test timeout was recently increased to 20s to handle npm registry latency.

The only open deferred items are the `rank` command (mulch-cky, P3) and semantic clustering in compact (seeds-e2bd, P3). Neither is required for V1.

**Estimated completion: ~95%.** Remaining 5% is lint warning resolution and shell completion end-to-end verification.

## Open Questions

1. **Biome `noNonNullAssertion` warnings (435 total):** All are the same rule — safe non-null assertions used throughout. Options:
   - **Option A**: Clean up all 435 before V1 (guarantees zero warnings in CI output)
   - **Option B**: Accept as-is (current approach — all are contextually safe)
   - **Option C**: Auto-fix the FIXABLE ones in `doctor.ts`, document the rest as intentional

2. **Shell tab-completion end-to-end:** `ml completions <shell>` generates correct scripts (verified in tests). Actual shell integration — sourcing the script, triggering completions on tab — has not been tested programmatically. Options:
   - Manual verification in bash/zsh/fish before release
   - Add GitHub Actions step that sources the script and invokes completion in a subshell
   - Document as manual verification step in release checklist

3. **CI Ubuntu-only matrix:** No macOS or Windows runners. Acceptable for V1 given Bun cross-platform support, or should we add at least macOS before release?

4. **`upgrade --check` test flakiness:** Timeout was increased to 20s; this hits the real npm registry. If CI failures occur, consider caching the version check response or adding retry logic.

## Known Edge Cases / Risks

- **Lock timeout:** 5s timeout for advisory locks; stale detection at 30s. Sufficient for typical interactive use. Long-running operations (e.g., large compaction) may time out under high concurrency.
- **`ml sync` git ref lock contention:** Multiple agents running `ml sync` concurrently may hit git ref lock errors. Agents should coordinate sync timing or accept retries.
- **`prime --export` race condition:** If multiple agents write to the same `--export` file simultaneously, the last write wins (no lock on export target). Not a concern for read-only prime, but exports are not safe under concurrent writes to the same path.
- **CI Ubuntu-only:** No cross-platform test coverage. Potential for macOS-specific filesystem or path issues to go undetected.
