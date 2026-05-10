# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Built-in recipes for `aider`, `gemini`, and `windsurf`**: an audit against the providers' current docs found all three writing to paths the runtime doesn't actually read, so `ml setup <one of these>` was silently a no-op. `ml setup aider|gemini|windsurf` now fails with the standard unknown-provider hint pointing at `--list`, `.mulch/recipes/<name>.{ts,sh}`, and `mulch-recipe-<name>`. Users who relied on the old paths can re-create the same behavior as a filesystem recipe in their own repo.
  - **Aider** (`.aider.conf.md`): Aider only auto-loads files explicitly listed under `read:` in `.aider.conf.yml`, so the orphan markdown file was never opened.
  - **Gemini** (`.gemini/settings.md`): not a path Gemini CLI reads. Gemini reads `GEMINI.md` at the project root; users wanting Mulch wired into Gemini should adopt the AGENTS.md / `ml onboard` flow instead.
  - **Windsurf** (`.windsurf/rules.md`): Windsurf uses a directory of per-rule files at `.windsurf/rules/<name>.md` with required `trigger:` frontmatter, not a single combined file.

### Added

- **`ml config unset <path>` subcommand** (mulch-b2c4 / pl-6212): removes a knob from disk so subsequent reads fall back to the schema default. Same closed-shape gate as `ml config set` (rejects `governance.typo` with the list of known keys); same atomic write under `withFileLock`. Empty parent objects along the unset path are pruned when the schema allows the parent to be omitted (so `ml config unset search.boost_factor` leaves no orphan `search: {}` in the YAML and lets the schema's `required: [boost_factor]` under `search` stay satisfied via the parent being absent). Required-field removals (`ml config unset governance.max_entries`) are rejected with the schema-titled validation error — use `ml config set` to override required knobs. Idempotent: unsetting a never-set path is a silent no-op and does not rewrite the file. Errors with the standard `No .mulch/ directory found. Run \`mulch init\`` message when run outside a project.
- **`ml config set <path> <value>` subcommand** (mulch-1833 / pl-6212): atomic per-knob writes for warren and other config-UI consumers. `<value>` is YAML-parsed (so booleans, numbers, lists, and objects all work uniformly without per-knob serialization rules); the resulting full `MulchConfig` is validated against the JSON Schema (`ml config schema`) before write, and invalid values are rejected with a schema-titled error (e.g. `must be integer (Soft target)`). The write goes through `withFileLock` + temp-file-and-rename so concurrent agents serialize cleanly. Closed-shape misses error early with the list of known keys (`Known keys at 'governance': max_entries, warn_entries, hard_limit.`); open-map paths (`domains.<name>.required_fields`, `custom_types.<name>.required`) auto-create intermediate objects. Last-writer-wins under concurrent writes — warren UIs should re-fetch via `ml config show` after every write. Errors with the standard `No .mulch/ directory found. Run \`mulch init\`` message when run outside a project.
- **`ml config show [--path <p>]` subcommand** (mulch-d639 / pl-6212): emits the effective `MulchConfig` as JSON for warren and other config-UI consumers. With no `--path`, dumps the full on-disk config (with `applyConfigDefaults` filling required `governance` / `classification_defaults` sections). With `--path foo.bar`, walks the dot-notation path and emits just that subtree; if the knob is unset, falls back to the schema's declared `default` (so `ml config show --path search.boost_factor` returns `0.1` even when `search:` is absent from the YAML). Section-level paths over unset knobs synthesize an object from leaf defaults (`--path prime` → `{ default_mode: "full" }`). Closed-shape misses (`--path governance.typo`) and missing-with-no-default leaves error with `Path '<p>' not found in config and has no schema default.` The global `--json` flag is accepted as a no-op (output is unconditionally JSON, matching the `ml config schema` precedent).

- **`ml prime --dry-run` for spawn-time preview** (mulch-358b / pl-fd71, R-11 warren integration): emits a JSON summary of which records would be primed (`{ wouldPrime: [{id, type, domain, tokens}], totalTokens, budgetUsed, budgetTotal }`) without rendering record content, so orchestrators (warren and similar) can show "would prime: N records, K tokens" in editor preview panes before shelling out for the full prime. Reuses the same `applyBudget` + `estimateRecordText` pipeline as a real prime, so token counts and the kept-record set match what an immediate non-dry-run invocation would produce. Composes with `--domain`, `--files`, `--context`, `--budget`, `--no-limit`, `--exclude-domain`, and `--export`. `pre-prime` hooks are skipped (preview must not trigger Slack posts or `digest-then-confirm` confirmations, mirroring the `ml prune --dry-run` precedent). `--format plain --dry-run` returns the dry-run JSON (format ignored when dry-running). `--dry-run --manifest` is rejected with a targeted error since manifest mode lists domains, not records. `budgetUsed` / `budgetTotal` are `null` when `--no-limit` is in effect.

- **`owner` and `status` as built-in optional record fields** (mulch-ab20, R-06 step 1): `BaseRecord` now carries an optional `owner` (opaque string, e.g. `@user` or `@team`) and `status` (`draft` | `active` | `deprecated`). Both round-trip through `ml record` → JSONL → `ml prime` and existing records without these fields stay valid. `status: "archived"` continues to live only on soft-archived records under `.mulch/archive/`; the live-record AJV schemas reject it via `additionalProperties: false`. Custom types that `extends` a built-in inherit both fields automatically. Owner-resolution chain (`--owner` flag, CODEOWNERS lookup, per-domain `default_owner`, git-author fallback) and `ml review` ship in subsequent plan steps (mulch-846f / mulch-0880 / mulch-41e1 / mulch-8cce).
- **Codex SessionStart hook** (Codex 0.124.0+, April 2026): `ml setup codex` now writes a managed `[[hooks.SessionStart]]` block to `.codex/config.toml` (in addition to the existing AGENTS.md prose section), so `ml prime` actually executes at session start and its output is injected as developer context via Codex's `additionalContext` mechanism. The TOML block is fenced by `# mulch:start` / `# mulch:end` line comments for idempotent install and clean removal — user-managed entries in the same file are preserved on `install`, `check`, and `remove`. Schema reference: https://developers.openai.com/codex/hooks. Requires `[features] codex_hooks = true`, which the managed block provides.

### Fixed

- **`ml prime --no-limit` now actually disables the budget** (mulch-358b / pl-fd71): Commander parses `--no-limit` as `options.limit = false` (defaults `true`), but `prime` was checking `options.noLimit !== true`, which was always `true` since `noLimit` was undefined — so `--no-limit` had been a silent no-op since the flag was added. Surfaced while implementing `--dry-run`, which needed the budget toggle to compose correctly. `--no-limit` now correctly skips the budget pass for both rendered and dry-run output (`budgetUsed` / `budgetTotal` are `null` in the dry-run JSON when `--no-limit` is in effect).

- **Claude `PreCompact` hook is no longer registered** by `ml setup claude`. Per the Claude Code hooks docs, `PreCompact`'s only documented control is "block the compaction" — its stdout is discarded across compaction and never reaches the model. The empty-matcher `SessionStart` registration already covers the post-compact reload path via the `compact` matcher, so the second registration was dead weight. `install` now writes only `SessionStart`; `check` only verifies `SessionStart`; `remove` still iterates every event in `settings.hooks` so legacy `PreCompact` entries from older installs are cleaned up automatically. Existing settings.json files with both entries remain functional until the next `ml setup claude --remove`/`--install` cycle.

### Changed

- **`ml prime --format plain` now matches the spawn-injection contract** (mulch-358b / pl-fd71): the leading `Project Expertise (via Mulch)` decorative title and the `============================` underline are dropped from `formatPrimeOutputPlain`, and the trailing `=== SESSION CLOSE PROTOCOL ===` reminder is suppressed when `format=plain` (in both records and manifest paths). The output now starts directly with the per-domain section (`[domain] N records (updated …)`) and ends with the last record, so warren / other embedders can concatenate it into a coding agent's system prompt without smuggling in markdown headers, decorative ASCII, or session-framing instructions that would conflict with the orchestrator's own dispatch. The per-domain `formatDomainExpertisePlain` body (used by `ml search --format plain` and `ml query --format plain`) is unchanged, so non-prime consumers are unaffected. The two existing prime tests that asserted the old document title now assert its absence.

- **`ml onboard` snippet now surfaces the package version** (mulch-391b): the snippet injected into AGENTS.md / CLAUDE.md previously identified itself only with an opaque schema integer (`<!-- mulch-onboard-v:4 -->`), so consumers had no way to correlate the installed snippet with a Mulch release. The marker is now `<!-- mulch-onboard:v<package.version> -->` (resolved at runtime via `getCurrentVersion()`) and the body line reads `This project uses Mulch v<package.version> for structured expertise management.` Outdated detection compares the marker against the running CLI's package version, so any version change (including patch bumps) prompts re-running `ml onboard` — which is the desired UX, since the visible version in CLAUDE.md should track the installed Mulch. Legacy `mulch-onboard-v:N` markers are still detected as outdated and migrated on the next run.

### Fixed

- **v0.8.0 polish batch** (mulch-04ca): five small bugs surfaced by the v0.8.0 stress test, bundled into one pass.
  - **Migration wording**: the v0.8.0 entry that claimed "Migration is automatic for legacy configs" was misleading — `domains: string[]` configs are normalized to the object map at read time, not rewritten to disk. The CHANGELOG line now spells that out and notes that the first `mulch` write that touches `mulch.config.yaml` (e.g. `ml add`) is what round-trips the file in the new shape. Behavior unchanged.
  - **Archive parse errors**: `readExpertiseFile` now wraps the per-line `JSON.parse` and throws `Malformed JSONL at <file>:<line>: <reason>. Line: <preview>` instead of propagating a context-free `Unexpected token …` from the engine. Matters most for `.mulch/archive/<domain>.jsonl` files that operators rarely open directly.
  - **Anchor decay knobs validated**: `decay.anchor_validity.threshold` and `grace_days` are now range-checked. `ml prune --check-anchors` aborts with a formatted error before the prune walk when `threshold` is outside `[0, 1]`, when `grace_days < 0`, or when either knob is `NaN`/`Infinity`. A new `decay-config` doctor check surfaces the same misconfigurations proactively. Previously, a typo like `grace_days: -1` silently flipped the grace gate to "always passed," exposing freshly-recorded records to anchor decay before their anchors stabilized.
  - **`ml rank` flag parsing**: `--limit 10abc` and `--min-score 0.5xyz` no longer silently parse to `10` / `0.5` (the `parseInt`/`parseFloat` trailing-garbage gotcha) — both flags now use a strict regex+`Number()` pair and reject non-integer or trailing-junk values with the offending input quoted in the error.
  - **`--quiet` semantics**: `ml add` and `ml onboard` now respect the global `-q/--quiet` flag for their non-error success messages, matching the rest of the write commands. `--quiet` already gated record/edit/delete/restore/sync output; the two stragglers were bare `console.log` calls. Errors are still printed under `--quiet`.
- **Archive-lifecycle data integrity** (mulch-9096): `ml restore` now refuses to overwrite a live record with the same id instead of silently producing a duplicate-id JSONL. The pre-check runs before the archive is touched; a race-safe re-check inside the live-file lock rolls the archive back if a duplicate appears mid-flight. Supersession cycle detection (Tarjan SCC, iterative) excludes any record that participates in a cycle (A↔B, A→B→C→A, etc.) from `supersededIds`, so cycle members are no longer demoted/archived together. Cycle detection emits a yellow warning on `ml prune` so operators notice the misconfiguration.
- **Config error surfacing** (mulch-41e3): registry-init failures (custom type extending a `disabled_types` parent, `disabled_types` referencing an unregistered type, malformed YAML) now print a one-line `Config error:` message with a pointer to `.mulch/mulch.config.yaml` and `mulch doctor`, instead of a raw Bun stack trace from a top-level await failure. `--json` mode emits a structured `{ success: false, command: "init", error }` payload. `readConfig` now applies `governance` and `classification_defaults` defaults when those required-by-type sections are absent from a hand-written minimal config, so `ml doctor` / `ml status` / `ml prune` / `ml compact` / `ml prime` no longer crash with `TypeError: undefined is not an object` on a config that only declares `domains:`. Partial overrides (e.g. `governance: { max_entries: 50 }`) keep their explicit values; only missing keys are backfilled.
- **Custom-types polish: name regex docs + foreign-base-field alias collision** (mulch-aeb2): The naming rule is now spelled out plainly in errors instead of pasting the regex literal — `Custom type "my-type" (contains a hyphen). Allowed: lowercase letters, digits, and underscores; must start with a letter; no hyphens.` The same rule (`CUSTOM_NAME_RE`) is now applied to required/optional field names and to alias legacy names (previously only the type name itself was checked, so `required: ["my-field"]` slipped through and produced confusing AJV errors at write time). Aliases also reject any legacy name that matches a built-in type's required/optional field — declaring `aliases: { title: ["name"] }` on a custom type that extends `decision` now fails with a "collides with a built-in type's field" error, since `name` is `pattern`'s required field and the alias would silently misroute records of that field across types.
- **dir-anchors normalization + project-root containment** (mulch-c282): `normalizeDirAnchor` now strips a leading `./` so `--dir-anchor ./src/foo` and `--dir-anchor src/foo` produce the same stored value (the prior pass left `./src/foo` untouched, splitting a single anchor into two equivalence classes that missed each other in dedup and prime/--files containment). New `assertWritableDirAnchor` is wired into `ml record --dir-anchor` and rejects (1) absolute paths (POSIX `/etc/passwd`, Windows `C:\…`, UNC `\\server\share`) and (2) any `..` parent-traversal segment (`..`, `../parent`, `src/../sibling`). Both produce a formatted one-line error and abort before the record is written. `normalizeDirAnchor` itself stays non-throwing so legacy on-disk values keep working through `fileLivesUnderDir` and doctor checks.
- **Provider recipe loader hardening** (mulch-828d): `ml setup <name>` now wraps the `recipe.install/check/remove` call in try/catch and surfaces a thrown exception as `recipe "<name>" <action> threw (<source>): <message>` instead of a raw Bun stack trace. `loadFilesystemRecipe` and `loadNpmRecipe` now require `export default { install, check, remove }` strictly — the prior `mod.default ?? mod` fallback silently accepted modules with named-only exports, which violated the documented spec. Both loaders throw a targeted "has no default export" error pointing at `examples/recipes/internal-ide.ts` when default is absent, and a separate "default export is not a valid ProviderRecipe" error when the default is the wrong shape. `ml setup --list` now detects npm shadows: when a built-in name is also resolvable as `mulch-recipe-<name>` from the project root, the listing reports `shadowed_by: "npm"` so the marker matches what `ml setup <name>` would actually run (filesystem-ts/sh shadows still take precedence over npm).
- **Hook timeout reliably kills forked descendants** (mulch-9c81): `Bun.spawn`'s `timeout` option only signals the direct `sh` child, so a hook that backgrounds a forked exec (e.g. `slack-post.sh & wait`, `curl …`) orphaned the long-running command and left it holding the inherited stdout fd. `Promise.all([Response.text(), …, proc.exited])` then blocked indefinitely even though the timeout fired — the CLI hung. The hook runner now uses `node:child_process.spawn` with `detached: true` (POSIX `setsid` → new process group) and calls `process.kill(-pid, "SIGKILL")` on timeout, killing every descendant in one shot. The runner also reads stdout/stderr via `data` events instead of a stream-await, so a closed pipe can never re-introduce a hang. New regression test in `test/utils/hooks.test.ts` exercises the actual `sleep 30 & wait` case (the prior test only used a shell-builtin busy loop). Mutable-events doc/code drift in `runHooks` JSDoc, `src/schemas/config.ts`, and the `init` config template fixed: `pre-prune` is block-or-allow only — only `pre-record` and `pre-prime` may mutate the payload via stdout JSON. Behavior was already correct (`MUTABLE_EVENTS` excluded `pre-prune`); only the comments were wrong.

## [0.8.0] - 2026-05-06

Per-domain governance, lifecycle hooks, soft-archive prune, and pluggable provider recipes — Mulch grows up from "shared shelf" to "shared shelf with rules and lifecycle". Custom types now inherit from built-ins, records can anchor to directories, prune demotes superseded/decayed records before archiving, and a new `ml rank` surfaces top confirmation-frequency records without a query. 1120 tests across 58 files (up from 840 / 41 in 0.7.0).

### Added

#### `ml rank` — top records by confirmation score (mulch-cky)
- **New read-only command**: `ml rank [domain]` returns records sorted by confirmation-frequency score (highest first). Unlike `ml search --sort-by-score`, no text query is required and output is a flat cross-domain ranking instead of per-domain groups, so context-constrained consumers can grab the top-N battle-tested records directly.
- **Filters**: `--type <type>` to scope to a single record type, `--limit <n>` (default 10) to cap the result set, `--min-score <n>` (default 0) to exclude records below a confirmation threshold (e.g. `--min-score 1` keeps only records with at least one confirmed application).
- **`--json`** emits `{ success, command, count, records[] }` with `domain`, `id`, `type`, `score`, `summary`, and the full `record` per entry, sorted by score desc.
- Joins the `prime`, `query`, `search`, `status`, `validate`, `learn`, `ready` tier of fully-safe (read-only) commands.

#### Provider Recipe Discovery (R-04, mulch-6deb)
- **`ml setup <name>` now resolves recipes via discovery instead of a closed list.** Resolution order: filesystem (`.mulch/recipes/<name>.ts` or `.sh`) → npm (`mulch-recipe-<name>`) → built-in. Filesystem wins so orgs can override built-ins. Adding a 7th provider no longer requires patching core.
- **TypeScript recipes** are loaded directly by Bun (no build step). The default export must implement the existing `ProviderRecipe` shape (`install` / `check` / `remove` returning `{ success, message }`). Shape is validated at load time; bad exports throw with a pointer to the offending file.
- **Shell recipes** are invoked as `<script> install|check|remove` with cwd set to the project root and `MULCH_RECIPE_NAME` / `MULCH_RECIPE_ACTION` in the environment. Stdout becomes the success message; non-zero exit signals failure (stderr surfaced).
- **npm recipes** resolve via `require.resolve('mulch-recipe-<name>')` from the project root, so normal `package.json` `dependencies` resolution applies.
- **`ml setup --list`** (and `--list --json`) surfaces every discovered provider with its source, plus shadow flags on built-ins overridden by a filesystem recipe of the same name.
- **Unknown-provider hint** now points at `--list`, `.mulch/recipes/<name>.{ts,sh}`, and `mulch-recipe-<name>` instead of repeating the hard-coded built-in list.
- **Examples** under `examples/recipes/` cover both a TypeScript and a shell recipe.

#### Anchor-Validity Decay (R-05f, mulch-2551)
- **`ml prune --check-anchors`**: opt-in flag that demotes a record one classification tier when its file/dir anchors stop resolving. For each record we count valid vs. broken anchors across `files[]` (PatternRecord/ReferenceRecord), `dir_anchors[]`, and `evidence.file`; if the resulting `valid_fraction` is below the configured threshold AND the record was recorded more than `grace_days` ago, the record walks `foundational → tactical → observational → archived` (or is hard-deleted with `--hard`). Each demotion stamps `anchor_decay_demoted_at: <iso-date>` so the signal is auditable across passes.
- **Records with zero anchors are exempt** — the absence of anchors means "applies globally," not "100% broken."
- **Staleness still wins** when both apply — the record archives for staleness without an intermediate anchor-decay stamp.
- **Co-existence with supersession** — a record that is both superseded and anchor-decayed still demotes only one tier per pass, but both `supersession_demoted_at` and `anchor_decay_demoted_at` get stamped.
- **`--explain`** flag: prints per-record reasons for each demotion, listing the broken anchors (kind + path) and the tier transition. Works for both supersession and anchor decay.
- **Configurable knobs** under `decay.anchor_validity` in `mulch.config.yaml`:
  ```yaml
  decay:
    anchor_validity:
      threshold: 0.5    # demote if valid_fraction < this
      grace_days: 7     # don't punish records younger than this
      weight: 1.0       # reserved for the future R-05g fitness blend
  ```
- **JSON output adds `totalAnchorDemoted`, `totalSupersessionDemoted`, plus per-domain `anchor_demoted` / `supersession_demoted`** breakdowns alongside existing `pruned` / `demoted` counts. With `--explain`, the payload includes an `explanations[]` array.

#### Supersession-Based Auto-Demotion (R-05e, mulch-4426)
- **`ml prune` demotes superseded records by one tier per pass**: when record B has `supersedes: [A]`, A walks down the classification ladder (`foundational → tactical → observational → archived`). Each demotion stamps `supersession_demoted_at: <iso-date>` on A so the event is auditable. The signal was already in the schema — supersession is now a first-class decay axis.
- **Cross-domain by design**: a record in domain X can supersede a record in domain Y. Supersession is content-relational, not domain-bound.
- **Staleness wins on overlap**: a record that is both stale and superseded gets archived for staleness in one shot, no intermediate demotion stamp.
- **`--aggressive`** flag on `ml prune`: collapses every superseded record straight to archived (or hard-deleted with `--hard`) in a single pass instead of walking the ladder.
- **Self-supersession is a no-op**: a record listing its own id under `supersedes` is treated as a typo and ignored.
- **JSON output adds `totalDemoted` and per-domain `demoted` counts** alongside the existing `totalPruned` / `pruned`. The pre-prune hook payload now carries both `stale` and `demote` arrays per candidate domain.

#### Soft Archive on Prune (R-05a, mulch-7876)
- **`ml prune` defaults to soft-archive**: stale records move to `.mulch/archive/<domain>.jsonl` (with `status: "archived"` and `archived_at: <iso-date>` fields) instead of being deleted. A single bad classification at record-time stops being destructive — recoverable with one command.
- **`--hard`** opt-in for true deletion (legacy behavior).
- **Archive file format**: each `.jsonl` starts with a banner comment line (`# ARCHIVED — not for active use. Run \`ml restore <id>\` to revive.`). `readExpertiseFile` now skips `#`-prefixed lines so banners don't break reads.
- **`ml restore <id>`**: new command. Searches archives across all domains, removes the record from the archive, strips lifecycle fields, and appends back to the live expertise file. Errors on cross-domain ambiguity.
- **`ml search --archived`**: opt-in flag includes archived records in search output, rendered in a dedicated `## <domain> (archived, N records)` section with `[ARCHIVED <date>] mx-id [type] summary` lines per record. Excluded by default. JSON mode adds an `archived` array per domain.
- **`ml prime` and default `ml search` never read `.mulch/archive/`** — they only walk `.mulch/expertise/`. Agents told via the onboard snippet not to grep the archive directly.
- **Onboard snippet** bumped to v4 with archive guidance.

#### Custom-Type Inheritance (R-01, mulch-4d6d)
- **`extends: <builtin>`** on `custom_types` entries: inherit `required` / `optional` / `dedup_key` / `id_key` / `summary` / `compact` / `section_title` / `extracts_files` / `files_field` from one of the six built-in types. Override only what differs; arrays merge as a union. Listing a parent's `optional` field under the child's `required` promotes it (and removes it from `optional`). Closes the last open R-01 sub-item — corpora stay portable because agents reading an unknown child type fall back to the parent's semantics under `--allow-unknown-types`.
- **Validation**: `extends` must reference a built-in (custom-from-custom is not supported in v1) and must not be on the `disabled_types` list (hard error at registry init).
- **AJV schema layering**: the merged schema lists the union of parent + child required fields and unions their `properties`; `additionalProperties: false` is preserved, and the child's `type` const overrides the parent's.

#### Directory Anchors (R-01, mulch-476b)
- **`dir_anchors[]`** as a built-in field on every record type — repo-relative POSIX directory paths the record applies to. Survives file rename/move within the directory, where `files[]` (file anchors) get invalidated.
- **`--dir-anchor <path>`** flag on `ml record` (repeatable). Trailing slashes are normalized away on write (`src/utils/` → `src/utils`); duplicates collapsed and entries stored sorted.
- **Auto-population from git context**: when no `--dir-anchor` is supplied, `ml record` infers anchors from the immediate parent of changed files — any directory that is the parent of 3+ changed files becomes a dir anchor. Explicit `--dir-anchor` wins over the heuristic.
- **`ml prime --files <path>` matches by directory membership**: a record matches when *either* `files[]` lists the path *or* any `dir_anchors[]` entry is an ancestor directory. Boundary-respecting prefix check (`src/util` does not match `src/utils/foo.ts`).
- **`ml doctor` extension**: the existing `file-anchors` check now scans `dir_anchors[]` and flags entries pointing at deleted directories. `--fix` strips broken dir anchors the same way it strips broken file anchors; when every entry is broken, the field is removed entirely.

#### Per-Domain Allowed Types & Required Fields (R-01b/c/d)
- **`domain.allowed_types`**: gate which record types may be written into a domain — `ml record` rejects any `--type` not in the list and prints a copy-paste retry hint with the first allowed type filled in. Empty/missing list preserves back-compat (any registered type accepted). `disabled_types` wins on overlap so peer agents in shared domains don't hard-fail when a type is being retired.
- **`domain.required_fields`**: require additional top-level fields on every record written into a domain. `ml record` rejects writes that omit any listed field with a single retry hint listing all missing fields. Stacks on top of per-type required fields — adds, never replaces. Top-level fields only.
- **Doctor re-validation**: new `domain-conformance` (informational) and `domain-violations` (failing) checks surface existing records that violate domain rules — catches worktree/CI lag where records land via `merge=union` before config does. No `--fix` in v1: violations need human judgment (rewrite vs. relax the rule).
- **Sync re-validation**: `ml sync` re-reads `mulch.config.yaml` and re-validates every on-disk record against the current rules before staging. Once config catches up, sync reconciles without a process restart. Sync intentionally ignores `--allow-domain-mismatch` — escape hatches stop at the commit gate.
- **`--allow-domain-mismatch`** global flag: tolerates rule violations during the lag window. Honored by `ml record` and `ml validate` only.
- **Config reshape (mulch-68ba)**: `domains` reshaped from `string[]` to `Record<string, DomainConfig>` so per-domain settings have a home. Legacy `string[]` configs are normalized to the object map at read time — no on-disk rewrite — so older configs keep working without user action. The first `mulch` write that touches `mulch.config.yaml` (e.g. `ml add`) will round-trip the file in the new shape.

#### Domain-Rules Compatibility Surfacing (mulch-cc51)
- **New `domain-rules-compatibility` doctor check**: when `domain.required_fields` names a field no allowed type can hold (built-in/custom schemas use `additionalProperties: false`), `ml doctor` now reports the offending field, lists the domain's allowed types, and prints a fix-it hint pointing at `custom_types`. Catches the misconfiguration at config time instead of every write.
- **Targeted runtime hint on AJV failure**: when a record write fails schema validation AND the rejected `additionalProperty` is in `domain.required_fields`, `ml record` now appends a clear hint identifying the field and the type that doesn't declare it, instead of letting users wade through the raw `oneOf` / `additionalProperties` soup.

#### Lifecycle Hooks (R-02)
- **`hooks` config block** in `mulch.config.yaml`: declare ordered shell scripts for `pre-record`, `post-record`, `pre-prime`, and `pre-prune`. Each script is invoked with the relevant payload as JSON on stdin (`MULCH_HOOK=1` set in the environment, cwd at the project root). Exit `0` to continue; non-zero **blocks** for `pre-*` events and **warns** for `post-*` events.
- **Payload mutation** for `pre-record` and `pre-prime`: a script may print a modified JSON payload on stdout, which becomes input to the next script and the eventual write. Useful for redaction, owner injection, team-scoped filtering. Empty stdout leaves the payload untouched. Non-JSON stdout is ignored with a warning. Both `{ event, payload }` and bare-payload shapes are accepted on the way back.
- **Composition**: multiple scripts per event run in declaration order. Pre-* short-circuit on the first non-zero exit; post-* runs all scripts and surfaces every failure as a separate warning.
- **Per-hook timeout** via `hook_settings.timeout_ms` (default 5000). Bun SIGKILLs the subprocess on timeout; a timed-out `pre-*` hook is treated as blocking.
- **Dry-run skips hooks** (record, prune): previews never fire side-effecting hooks like Slack posts or `digest-then-confirm` confirmations.
- **Init scaffold** documents the `hooks` and `hook_settings` blocks under the optional-knobs section of the generated config.

#### Phase 3 Custom-Type Polish
- **`disabled_types`** in `mulch.config.yaml`: list type names (built-in or custom) to mark as deprecated. Writes still succeed but emit a stderr warning (suppressed under `--quiet`); reads work as normal; the type stays in CLI choices so peers in shared domains aren't broken. Cross-project safe — overstory/greenhouse can retire a type without hard-failing partners.
- **Unknown-type policy on read**: `readExpertiseFile` throws a targeted `Unknown record type "X" at <file>:<line> (id=<id>)` when a record's type isn't registered. Validate emits the same targeted error instead of Ajv's generic "no oneOf matched" blob.
- **`--allow-unknown-types`** global flag: tolerates unregistered types in readers and validate. Escape hatch for the worktree/CI window where JSONL (`merge=union`) lands before `mulch.config.yaml` does. Sync intentionally ignores the flag — its job is to gatekeep commits.
- **`ml sync` re-validates against on-disk config**: rebuilds the type registry from disk before validating, so once config catches up, sync reconciles without needing a process restart.
- **Custom-type aliases**: `aliases: { canonical_field: [legacy_name, ...] }` in `custom_types` declares former field names. At read time, legacy fields are rewritten to the canonical name (canonical wins on conflict, legacy is dropped). Writes always use canonical. Schema-evolution support — rename a field without rewriting historic JSONL.
- **`ml doctor` type registry listing**: new `type-registry` check enumerates registered types (built-in vs custom) with per-type counts and a `(disabled)` marker. New `unknown-types` check fails with file/line/id details for unregistered records.
- **Init scaffold updated**: commented `disabled_types`, `custom_types`, and `aliases` examples in the generated `mulch.config.yaml` so users can discover the knobs.

### Fixed

#### Custom-type summary templates: brace-style + register-time validation (mulch-2da1)
- **Mustache-style `{{field}}` now resolves identically to `{field}`** in `compileSummaryTemplate`, so the prior init-wizard examples (and any user templates copied from Mustache-style docs) render correctly instead of leaking literal braces around the value.
- **Unknown-token validation at registry load**: `validateCustomTypeConfig` now rejects summary templates whose tokens aren't declared on the type (or inherited via `extends`, or a base record field). The error names the bad token and lists every legal one, replacing the previous silent empty-string render at `ml prime` time.
- **Init-wizard examples** (`src/utils/config.ts`) and the README's `Custom Types` / `Aliases (Schema Evolution)` snippets are now single-brace `{field}` for consistency. The README also calls out that both styles are accepted and tokens are validated.

#### Doctor domain-violations record count (mulch-7ac8)
- `ml doctor`'s `domain-violations` check now counts records (not message lines) in its summary so the failing-check tally matches reality.

#### Prime token estimator handles custom record types
- `ml prime`'s budget enforcement no longer crashes when summing tokens for a custom record type — previously the type-specific token estimator only knew about the six built-ins.

### Testing

- 1120 tests across 58 files, 2681 expect() calls (up from 840 / 41 / 1935 in 0.7.0)
- New tests for: `rank` command, lifecycle hooks (pre/post-record, pre-prime, pre-prune), soft-archive prune (archive read/write, banner skipping, restore, search --archived), supersession demotion, anchor-validity decay, custom-type inheritance via `extends`, dir anchors (record write, prime --files matching, doctor scanning), per-domain `allowed_types` / `required_fields` gates, doctor re-validation, sync re-validation, registry (custom types, disabled_types, unknown-type policy, aliases), provider recipe discovery (filesystem, npm, built-in resolution + --list)

## [0.7.0] - 2026-04-28

### Added

#### Global `--format` Flag
- Global `--format <markdown|compact|xml|plain>` flag that routes record-rendering commands (`ml prime`, `ml query`, `ml search`) through the selected formatter. `xml` is Claude-optimized, `plain` is Codex-optimized, `compact` emits one-liners (the default for `ml prime`), `markdown` emits the full sectioned layout. Per-command `--format` (including `ml query --format ids` and `ml search --format ids`) still wins over the global flag. `ml prime --compact` and `ml prime --full` are kept as aliases for `--format compact` and `--format markdown` respectively.
- `ml query --format xml|plain` and `ml search --format xml|plain` — the four formatters are now reachable from any record-rendering command, not just `ml prime`.

#### Manifest Mode for Monoliths
- `ml prime --manifest` emits a quick reference + per-domain index (with per-record-type counts and governance status) instead of full records — designed for monolith projects where dumping every record across every domain wastes agent context
- Optional `prime.default_mode` config knob in `.mulch/mulch.config.yaml`: set to `manifest` so plain `ml prime` (with no scoping args) emits the index by default; `ml prime <domain>` and `ml prime --files <path>` keep loading full records for the requested scope
- `--full` flag forces full output even when config says `manifest`
- `--manifest` combined with any scoping argument (`<domain>`, `--domain`, `--exclude-domain`, `--context`, `--files`) is a hard error with a usage hint
- `ml prime --manifest --json` emits a structured `{ type: "manifest", quick_reference, domains[] }` payload with per-type counts and per-domain health status

#### Search Confirmation-Frequency Boost
- `ml search <query>` now applies a confirmation-frequency boost to BM25 scores by default: records with successful outcomes float above unconfirmed records at the same relevance. Boost factor is `1 + 0.1 * confirmation_score` per record (records with no outcomes are unaffected). Activates the previously-unused `applyConfirmationBoost` helper.
- Optional `search.boost_factor` knob in `.mulch/mulch.config.yaml` to tune or disable the boost (`0` = pure BM25)
- `ml search --no-boost` flag as a per-call escape hatch back to pure BM25 ordering. `--sort-by-score` is unchanged and continues to work as a confirmation-only post-sort.

#### Init Scaffolding
- `ml init` now writes `.mulch/mulch.config.yaml` from a templated string with a header comment and a commented-out optional-knobs section (currently `prime.default_mode`) so users can discover settings without reading the source. The body is generated via `yaml.dump(DEFAULT_CONFIG)` so required-field values can't drift; subsequent `writeConfig()` calls still round-trip through the YAML serializer and strip comments — by design, the scaffold lives only at init time.

#### Tooling
- `scripts/version-bump.ts` — atomically bumps `package.json` and `src/cli.ts` in lockstep; wired into `bun run version:bump <major|minor|patch>`. (The script existed in `package.json` since 2026-03-05 but was never committed; fresh clones used to fail to bump.)

### Changed

- `ml onboard` snippet rewritten to cover 0.6.4 agent workflow: multi-tracker evidence (`--evidence-seeds`/`--evidence-gh`/`--evidence-linear`), git auto-context for commit + files, `--relates-to`, outcome merge on upserts, retry hints on validation failures, `ml doctor --fix` for broken file anchors, and worktree-safe storage; now also mentions manifest mode for monolith discovery
- `ONBOARD_VERSION` bumped to 3 so existing `v:1` and `v:2` installs are detected as outdated and migrated on the next `ml onboard`
- `MULCH_README` (rendered to `.mulch/README.md` on `ml init`) now documents the optional `prime.default_mode` knob
- `formatMcpOutput` / `McpDomain` renamed to `formatJsonOutput` / `JsonDomain` to match reality (no MCP integration was ever wired up)
- TypeScript bumped from 5.9.3 to **6.0.3** (Dependabot #20); `bun.lock` regenerated to match

### Removed

- `ml prime --mcp` flag (use `--json` instead — the two produced identical output and there was no MCP integration consuming the flag)

### Testing

- 840 tests across 41 files, 1935 expect() calls (up from 811 / 41 / 1848 in 0.6.5)
- Expanded `test/commands/prime.test.ts` (+401 lines): manifest-mode output, scoping-conflict errors, `prime.default_mode` config resolution, `--full` override, JSON manifest payload shape
- Expanded `test/commands/query.test.ts` (+122 lines) and `test/commands/search.test.ts` (+140 lines): global `--format` resolution across xml/plain/markdown/compact, per-command `--format` precedence
- Expanded `test/commands/init.test.ts` (+26 lines): scaffolded YAML header comment and commented-out `prime.default_mode` block

## [0.6.5] - 2026-04-22

### Fixed

- `ml prime` domain-not-found hints now emit `ml add <domain>` instead of `mulch add <domain>` — finishes the `ml` alias unification across teaching surfaces (applies to both `--domain` and `--exclude-domain` missing-domain errors)

### Changed

#### Lint & Type Strictness
- Biome `noNonNullAssertion` promoted from warning to **error**, and `bun run lint` now runs with `--error-on-warnings` so any regression fails CI
- All `!` non-null assertions removed from `src/` (production code) and across 7 test files — replaced with explicit narrowing or optional chaining
- ~74 `as` type casts in tests replaced with real runtime narrowing (e.g., `if (!x) throw …`) so tests exercise the same type flow as production code

### Testing

- 811 tests across 41 files, 1848 expect() calls (unchanged from 0.6.4; coverage preserved through the strictness refactor)

## [0.6.4] - 2026-04-22

### Added

#### New CLI Commands
- `ml delete-domain <domain>` — remove a domain from config and delete its expertise JSONL file; `--yes` skips confirmation, `--dry-run` previews without changes; destructive operation is wrapped in a file lock for concurrency safety

#### Worktree-Aware Storage
- `getMulchDir()` now resolves to the main repo's `.mulch/` directory when run from inside a git worktree, preventing expertise loss when worktrees are cleaned up
- `ml sync` skips commits in worktree context with an informational message
- Mirrors the pattern from seeds' `resolveWorktreeRoot()` (see `src/utils/git.ts`)

#### Schema Evidence & Auto-Context
- Evidence schema now supports multiple tracker fields alongside `bead`: `seeds`, `gh`, `linear` — record origin tickets from any tracker
- `src/utils/git-context.ts`: `getCurrentCommit()` and `getContextFiles()` auto-populate `evidence.commit` and `files[]` without requiring explicit flags
- Upsert of named records (pattern/decision/reference/guide) now **merges outcomes** — existing outcomes are preserved and new ones appended instead of replaced
- Record validation failures now emit a copy-paste **retry hint** with placeholders for missing required fields

#### Prime Output Enrichment
- Compact quick reference: new type → required-fields table in `ml prime`
- `--files` reframed as "prime before editing a file", not just session start
- `--relates-to` included in evidence guidance (compact and verbose modes)
- Compact lines now show classification age (`tactical 7d ago`, `observational 14d ago`; foundational is permanent) and confirmation score `★N` when > 0

#### Doctor Health Checks
- `checkFileAnchors()` in `ml doctor` warns when records reference filesystem paths (`PatternRecord.files[]`, `ReferenceRecord.files[]`, `evidence.file`) that no longer exist
- `ml doctor --fix` strips broken anchors from records without deleting the records themselves

### Changed

- **Messaging unification**: all teaching surfaces now use the `ml` short alias instead of `mulch` — onboard snippet, setup recipes (cursor/codex/generic), prime output (`src/utils/format.ts`), session-end reminder, and `.mulch/README.md` template (`src/utils/config.ts`)
- `ml onboard` fallback: when no snippet is found and neither `CLAUDE.md` nor `AGENTS.md` exists, now creates `CLAUDE.md` by default (previously `AGENTS.md`); if `AGENTS.md` already exists without a snippet, still appends there
- `onboard` outdated/legacy check messages now reference `ml onboard`
- `formatStatusOutput` empty-domain message now references `ml add`
- `query` hint and error messages now reference `ml add` / `ml init`
- README Quick Start includes `ml prime --files src/foo.ts`; example output uses `records` instead of `entries`

### Fixed

- `isInsideWorktree` false positive in git submodules — `--git-common-dir` returns `/parent/.git/modules/<name>` for submodules, which does not end with `.git`; guard against this by returning `false` early
- `upgrade --check` test timeout increased from 5s to 15s (npm registry network call can exceed default Bun test timeout in CI)

### Tooling

- Upgraded Biome from 1.9 to **2.4.6** — applies tab indentation, import sorting, unused import/variable removal, and updated lint rules across all source and test files
- `ci: extract changelog notes for GitHub releases` — `publish.yml` now uses `awk` to pull the version section from `CHANGELOG.md`, falling back to `--generate-notes` if no entry is found

### Testing

- 811 tests across 41 files, 1848 expect() calls
- New `test/commands/delete-domain.test.ts` (CLI-level via Commander + unit tests: --yes, --dry-run, confirmation prompt, file lock, removeDomain config update)
- New `test/utils/worktree.test.ts` (worktree-aware storage resolution, submodule false-positive guard)
- New `test/utils/git-context.test.ts` (auto-populate commit and files[] from git context)
- Expanded `test/commands/prime.test.ts` (per-type required fields table, per-file framing, classification age, confirmation score markers)
- Expanded `test/commands/doctor.test.ts` (file-anchors check, --fix stripping broken anchors)
- Updated `test/commands/onboard.test.ts` (CLAUDE.md default fallback, ml alias)

## [0.6.3] - 2026-02-26

### Added

#### Bulk Delete
- `ml delete <domain> --records <ids>` — delete multiple records by comma-separated IDs in a single operation
- `ml delete <domain> --all-except <ids>` — delete all records except specified IDs (inverse selection)
- `--dry-run` flag for delete command — preview what would be deleted without making changes

#### Output Formatting
- `--format <markdown|compact|ids>` flag for `ml query` and `ml search` — choose output format (`ids` emits one record ID per line, useful for piping)
- `--verbose` promoted to global flag — available on all commands (previously `prime`-only `-v`/`--verbose`)

#### CLI Improvements
- Levenshtein-based typo suggestions for unknown commands (e.g., `ml recrod` → "Did you mean 'record'?")
- Per-type required fields table added to `ml prime` "Recording New Learnings" section
- Package metadata: `keywords`, `engines`, `homepage`, `bugs`, `repository`, and ecosystem footer added to package.json and README

### Changed

- `ml upgrade` uses `getCurrentVersion()` from `version.ts` instead of importing `VERSION` constant — improves testability
- Ecosystem footer added to README (os-eco branding)
- `showSuggestionAfterError(false)` disables Commander's built-in suggestions in favor of custom Levenshtein suggestions

### Fixed

- Biome formatting in timing test (`test/commands/timing.test.ts`)

### Testing

- 763 tests across 38 files, 1763 expect() calls
- New `test/suggestions.test.ts` (Levenshtein typo suggestions: matching, no-match, distance threshold, JSON mode)
- New `test/commands/sync.test.ts` (comprehensive sync command coverage: git init, validate, stage, commit)
- New `test/commands/upgrade.test.ts` (upgrade command: up-to-date, update available, --check, install flow)
- Expanded `test/commands/delete.test.ts` (bulk delete: --records, --all-except, --dry-run, flag combination errors, JSON mode)
- Expanded `test/commands/query.test.ts` (--format compact, --format ids, piping workflows)
- Expanded `test/commands/search.test.ts` (--format compact, --format ids, no-match ids output)
- Expanded `test/commands/prime.test.ts` (required fields table in prime output)

## [0.6.2] - 2026-02-25

### Added

- `mulch completions <shell>` command — generates shell completion scripts for bash, zsh, and fish (supports both `mulch` and `ml` aliases)
- `--timing` global flag — prints execution time to stderr (`Done in Xms`) for performance profiling
- Prioritize slash command (`.claude/commands/prioritize.md`) for Claude Code

### Changed

- `mulch update` deprecated and hidden — prints a warning directing users to `mulch upgrade`
- Command parsing switched from `program.parse()` to `program.parseAsync()` for proper async support
- Documentation updated to use `ml` short alias consistently throughout README and CLAUDE.md

### Testing

- 717 tests across 35 files, 1638 expect() calls
- New `test/commands/completions.test.ts` (completions command coverage for bash, zsh, fish, ml alias, hidden commands, error handling)
- New `test/commands/timing.test.ts` (--timing flag output on stderr, stdout isolation, opt-in behavior)
- Updated `test/commands/update.test.ts` for deprecated update command behavior

## [0.6.1] - 2026-02-25

### Added

#### New CLI Commands
- `mulch outcome <domain> <id>` command — append outcomes to existing records (`--status success|failure|partial`, `--duration`, `--agent`, `--notes`, `--test-results`), or view existing outcomes when called without `--status`
- `mulch upgrade` command — checks npm registry for newer versions and installs via `bun install -g` (`--check` for dry run); replaces the older `update` command approach

#### Developer Experience
- Auto-create domains: `mulch record` now auto-creates missing domains instead of erroring, with a branded confirmation message
- Record validation hints: schema validation errors now include type-specific hints (e.g., "Hint: pattern records require: name, description")
- Domain-not-found hints in `query`, `search`, and `prime` commands — suggests `mulch add <domain>` when a domain isn't found

#### Health Checks
- `mulch doctor` legacy-outcome check — detects records with deprecated singular `outcome` field on disk
- `mulch doctor --fix` migrates legacy `outcome` fields to `outcomes[]` array format
- `mulch validate` warns (non-error) on records with legacy singular `outcome` field, suggests `mulch doctor --fix`

#### Programmatic API
- `appendOutcome()` function exported from `@os-eco/mulch-cli` — programmatic outcome recording with locking
- `OutcomeOptions` and `AppendOutcomeResult` types exported
- Full scoring module exported: `getSuccessCount`, `getFailureCount`, `getTotalApplications`, `getSuccessRate`, `computeConfirmationScore`, `applyConfirmationBoost`, `sortByConfirmationScore`

### Fixed
- ENOENT crash when `mulch learn` runs in non-mulch projects (now exits gracefully)
- Package name in version check — was using old `mulch-cli` instead of `@os-eco/mulch-cli`

### Testing
- 708 tests across 33 files, 1617 expect() calls
- New `test/commands/outcome.test.ts` (outcome command coverage)
- Expanded test suites: record (auto-create, validation hints), doctor (legacy-outcome), validate (legacy warnings), prime/query/search (domain-not-found hints), api (appendOutcome, scoring exports)

## [0.6.0] - 2026-02-24

### Added
- Branding system (`src/utils/palette.ts`) — brand color (brown/soil), accent (amber for IDs), muted (stone gray), status icons, and message formatters (`printSuccess`, `printError`, `printWarning`)
- `--quiet` / `-q` global option to suppress non-error output
- `-v` shorthand for `--version`
- `--version --json` outputs structured JSON (`name`, `version`, `runtime`, `platform`)
- `VERSION` constant exported from `src/cli.ts` for programmatic access
- Custom help screen formatting with branded colors and column layout
- `ml` binary alias for `mulch`
- Release slash command (`.claude/commands/release.md`)

### Changed
- **BREAKING**: Package renamed from `mulch-cli` to `@os-eco/mulch-cli` (scoped under `@os-eco` npm org)
- **BREAKING**: Switched runtime from Node.js to Bun — `bun` is now required
- All commands updated to use shared palette utilities instead of inline chalk calls
- Replaced vitest with `bun:test` for all 675 tests across 32 files
- Replaced ESLint/Prettier with Biome for linting and formatting
- Source `.ts` files shipped directly (no build step needed)
- All import extensions changed from `.js` to `.ts` (145 in src/, 98 in test/)
- Simplified Ajv imports — Bun handles ESM/CJS interop natively (removed `_Ajv.default ?? _Ajv` shim)
- Simplified `src/utils/version.ts` — uses `import.meta.dir` instead of `fileURLToPath`/`dirname`
- CI workflows (`ci.yml`, `publish.yml`) now use `oven-sh/setup-bun@v2`
- Publish workflow updated for scoped package with provenance signing
- Onboard snippet now includes version marker (`mulch-onboard-v:1`) for staleness detection
- Bumped `ajv` from 8.17.1 to 8.18.0

### Fixed
- Test pollution from shallow copy of `DEFAULT_CONFIG.governance` — now deep-cloned

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

[Unreleased]: https://github.com/jayminwest/mulch/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/jayminwest/mulch/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/jayminwest/mulch/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/jayminwest/mulch/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/jayminwest/mulch/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/jayminwest/mulch/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/jayminwest/mulch/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/jayminwest/mulch/compare/v0.6.0...v0.6.1
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
