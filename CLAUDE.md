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

Six record types: `convention`, `pattern`, `failure`, `decision`, `reference`, `guide` — each with type-specific required fields defined in `src/schemas/record.ts`.

Three classifications with shelf lives for pruning: `foundational` (permanent), `tactical` (14 days), `observational` (30 days).

### Command Pattern

Each command lives in `src/commands/<name>.ts` and exports a `register<Name>Command(program)` function. All commands are registered in `src/cli.ts`. Entry point is `src/cli.ts` (executed directly by Bun, no `dist/` output).

### Concurrency Safety

- **Advisory file locking**: `withFileLock(filePath, fn)` in `src/utils/lock.ts` — uses `O_CREAT|O_EXCL` lock files with 50ms retry, 5s timeout, and 30s stale lock detection
- **Atomic writes**: `writeExpertiseFile()` in `src/utils/expertise.ts` writes to a temp file then renames, preventing partial/corrupt JSONL
- **Write commands** (record, edit, delete, compact, prune, doctor --fix) use both mechanisms
- **Read-only commands** (prime, query, search, status, validate) need no locking

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

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**At the start of every session**, run:
```bash
ml prime
```

This injects project-specific conventions, patterns, decisions, and other learnings into your context.
Use `ml prime --files src/foo.ts` to load only records relevant to specific files.

**Before completing your task**, review your work for insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made — and record them:
```bash
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
```

Link evidence when available: `--evidence-commit <sha>`, `--evidence-bead <id>`

Run `ml status` to check domain health and entry counts.
Run `ml --help` for full usage.
Mulch write commands use file locking and atomic writes — multiple agents can safely record to the same domain concurrently.

### Before You Finish

1. Discover what to record:
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
