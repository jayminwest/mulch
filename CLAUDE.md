# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
bun test              # bun test (all tests)
bun test --watch      # bun test --watch
bun test test/commands/record.test.ts  # single test file
bun run lint          # bunx biome check .
bun run typecheck     # tsc --noEmit
```

## Architecture

Mulch is a passive CLI tool (`@os-eco/mulch-cli`) that manages structured expertise files for coding agents. It has no LLM dependency — agents call `ml record` / `ml query`, and Mulch handles storage and retrieval. Bun is the runtime — source `.ts` files are executed directly with no build step.

### Storage Model

- **Expertise entries**: JSONL files in `.mulch/expertise/<domain>.jsonl` (one record per line, append-only)
- **Config**: YAML at `.mulch/mulch.config.yaml`
- **Storage ≠ delivery**: JSONL on disk is machine-optimized; `ml prime` outputs agent-optimized markdown

### Record Types & Classifications

Six built-in types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide` — each with type-specific required fields defined in `src/schemas/record.ts`. Projects can declare additional types under `custom_types:` in `mulch.config.yaml`; the registry layer (`src/registry/`) treats them identically (CLI flags, validation, dedup, formatters).

Three classifications with shelf lives for pruning: `foundational` (permanent), `tactical` (14 days), `observational` (30 days).

### Type Registry (Phase 3)

- `disabled_types: [name]` in config — emits a deprecation warning on write but keeps reads/CLI choices working. Cross-project safe.
- `aliases: { canonical: [legacy_names] }` per custom type — legacy field names on disk are rewritten to canonical at read time.
- Unknown-type policy: `readExpertiseFile` throws a targeted error (`Unknown record type "X" at <file>:<line> (id=<id>)`) when a record's type isn't registered. Pass `{ allowUnknownTypes: true }` to opt out. The `--allow-unknown-types` global CLI flag wires the same opt-out via `src/utils/runtime-flags.ts`.
- `ml sync` calls `initRegistryFromConfig(cwd)` before validating so worktree/CI lag (JSONL lands via `merge=union` before config does) reconciles automatically once config catches up — sync intentionally ignores `--allow-unknown-types`.
- `ml doctor` adds a `type-registry` informational check (built-in vs custom, per-type counts, disabled marker) and an `unknown-types` failing check.

### Command Pattern

Each command lives in `src/commands/<name>.ts` and exports a `register<Name>Command(program)` function. All 24 commands are registered in `src/cli.ts`. Entry point is `src/cli.ts` (executed directly by Bun, no `dist/` output).

### Concurrency Safety

- **Advisory file locking**: `withFileLock(filePath, fn)` in `src/utils/lock.ts` — uses `O_CREAT|O_EXCL` lock files with 50ms retry, 5s timeout, and 30s stale lock detection
- **Atomic writes**: `writeExpertiseFile()` in `src/utils/expertise.ts` writes to a temp file then renames, preventing partial/corrupt JSONL
- **Write commands** (record, edit, delete, delete-domain, compact, prune, doctor --fix) use both mechanisms
- **Read-only commands** (prime, query, search, status, validate) need no locking

### Worktree-Aware Storage

`getMulchDir()` in `src/utils/git.ts` resolves to the main repo's `.mulch/` when invoked from a git worktree, so expertise survives worktree cleanup. `isInsideWorktree()` guards against false positives in git submodules (`--git-common-dir` returns `/parent/.git/modules/<name>` for submodules, not a `.git`-suffixed path).

### Provider Integration (setup command)

`src/commands/setup.ts` contains provider-specific "recipes" (claude, cursor, codex, gemini, windsurf, aider). Each recipe implements idempotent `install()`, `check()`, and `remove()` operations.

## TypeScript Conventions

- **ESM-only**: All relative imports use `.ts` extensions (`import { foo } from "./bar.ts"`)
- **Ajv import**: Simple `import Ajv from "ajv"` (Bun handles ESM/CJS interop)
- **Schemas in `.ts` files**: Export JSON schemas from TypeScript files (see `src/schemas/record-schema.ts`)
- **Strict mode**: No `any`, no `@ts-ignore`, no `@ts-expect-error`
- **Ajv strict mode**: Always include `type: "object"` alongside `required` and `properties` in JSON schema definitions

## Testing Conventions

- **No mocks**: Tests use real filesystems — create temp dirs with `mkdtemp`, write real config/JSONL, assert against real file contents, clean up in `afterEach`
- **Test location**: `test/commands/` mirrors `src/commands/`, `test/utils/` mirrors `src/utils/`
- Use `process.exitCode = 1` instead of `process.exit(1)` for testability

<!-- mulch:start -->
## Project Expertise (Mulch)
<!-- mulch-onboard-v:3 -->

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**At the start of every session**, run:
```bash
ml prime
```

Injects project-specific conventions, patterns, decisions, failures, references, and guides into
your context. Run `ml prime --files src/foo.ts` before editing a file to load only records
relevant to that path (per-file framing, classification age, and confirmation scores included).

For monolith projects where dumping every record wastes context, set
`prime.default_mode: manifest` in `.mulch/mulch.config.yaml` (or pass `--manifest`) to emit a
quick reference + domain index. Agents then scope-load with `ml prime <domain>` or
`ml prime --files <path>`.

**Before completing your task**, record insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made:
```bash
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
```

Evidence auto-populates from git (current commit + changed files). Link explicitly with
`--evidence-seeds <id>` / `--evidence-gh <id>` / `--evidence-linear <id>` / `--evidence-bead <id>`,
`--evidence-commit <sha>`, or `--relates-to <mx-id>`. Upserts of named records merge outcomes
instead of replacing them; validation failures print a copy-paste retry hint with missing fields
pre-filled.

Run `ml status` for domain health, `ml doctor` to check record integrity (add `--fix` to strip
broken file anchors), `ml --help` for the full command list. Write commands use file locking and
atomic writes, so multiple agents can record concurrently. Expertise survives `git worktree`
cleanup — `.mulch/` resolves to the main repo.

### Before You Finish

1. Discover what to record (shows changed files and suggests domains):
   ```bash
   ml learn
   ```
2. Store insights from this work session:
   ```bash
   ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
   ```
3. Validate and commit:
   ```bash
   ml sync
   ```
<!-- mulch:end -->

<!-- seeds:start -->
## Issue Tracking (Seeds)
<!-- seeds-onboard-v:1 -->

This project uses [Seeds](https://github.com/jayminwest/seeds) for git-native issue tracking.

**At the start of every session**, run:
```
sd prime
```

This injects session context: rules, command reference, and workflows.

**Quick reference:**
- `sd ready` — Find unblocked work
- `sd create --title "..." --type task --priority 2` — Create issue
- `sd update <id> --status in_progress` — Claim work
- `sd close <id>` — Complete work
- `sd sync` — Sync with git (run before pushing)

### Before You Finish
1. Close completed issues: `sd close <id>`
2. File issues for remaining work: `sd create --title "..."`
3. Sync and push: `sd sync && git push`
<!-- seeds:end -->

<!-- canopy:start -->
## Prompt Management (Canopy)
<!-- canopy-onboard-v:1 -->

This project uses [Canopy](https://github.com/jayminwest/canopy) for git-native prompt management.

**At the start of every session**, run:
```
cn prime
```

This injects prompt workflow context: commands, conventions, and common workflows.

**Quick reference:**
- `cn list` — List all prompts
- `cn render <name>` — View rendered prompt (resolves inheritance)
- `cn emit --all` — Render prompts to files
- `cn update <name>` — Update a prompt (creates new version)
- `cn sync` — Stage and commit .canopy/ changes

**Do not manually edit emitted files.** Use `cn update` to modify prompts, then `cn emit` to regenerate.
<!-- canopy:end -->
