# AGENTS.md

This file is the canonical entry point for AI coding agents working in
the mulch repo, following the [agents.md](https://agents.md) convention.
It mirrors the essentials from `CLAUDE.md`; when the two disagree,
`CLAUDE.md` is authoritative and this file should be updated to match.

## What this project is

**Mulch** is a passive CLI (`@os-eco/mulch-cli`) that manages structured
expertise files for coding agents. It has **no LLM dependency** — agents
call `ml record` to store an insight and `ml prime` to load relevant
expertise back into context, and mulch handles storage, validation, and
retrieval. The JSONL files on disk are the database; `ml prime` renders
them as agent-optimized markdown. Bun is the runtime: the source `.ts`
files execute directly with no build step.

Mulch is part of the **os-eco** ecosystem alongside warren (control
plane), burrow (sandbox), plot (coordination), seeds (issue tracking),
and canopy (prompt management). See `CLAUDE.md` for the long-form design
notes and `ROADMAP.md` for direction.

## Tech stack at a glance

- **Runtime:** Bun (runs TypeScript directly; no build step on the CLI).
- **Language:** TypeScript with strict mode — no `any`, no `@ts-ignore`,
  no `@ts-expect-error`.
- **Lint / format:** Biome (`biome.json`). Errors fail CI; warnings are
  promoted to errors via `--error-on-warnings`.
- **Tests:** `bun test` discovers `*.test.ts` under `test/` and next to
  scripts; configuration lives in `bunfig.toml`.
- **Storage:** JSONL files under `.mulch/expertise/` (one file per
  domain, append-only, `merge=union` gitattribute for conflict-free
  concurrent writes).
- **CLI:** `ml` / `mulch` (entry point `src/cli.ts`, dispatched via
  [commander](https://github.com/tj/commander.js)).

## Project layout

```
mulch/
├── src/
│   ├── cli.ts              # ml / mulch CLI entry point + Commander wiring + VERSION
│   ├── index.ts            # library entry point
│   ├── api.ts              # programmatic API surface
│   ├── commands/           # one file per subcommand (record, prime, sync, ...)
│   ├── schemas/            # record schemas + JSON schema definitions
│   ├── registry/           # type registry (built-in + custom types)
│   └── utils/              # lock, expertise IO, git/worktree, runtime flags
├── scripts/                # quality-gate + report scripts and their budgets
│   ├── check-all.ts            # canonical quiet gate runner (byte-identical fleet-wide)
│   ├── check-ci-parity.ts      # CI <-> check:all parity detector (byte-identical fleet-wide)
│   ├── ci-parity-config.json   # per-repo parity escape hatches (aliases / ciOnly)
│   ├── validate-agents-md.ts   # validates this file's references
│   ├── check-file-sizes.ts
│   ├── check-debt-markers.ts
│   ├── check-coverage.ts
│   ├── report-test-timing.ts
│   ├── report-quality-metrics.ts
│   └── version-bump.ts
├── test/                   # bun tests mirroring src/ layout
├── .mulch/                 # mulch's own expertise (dogfood)
├── .factory/skills/        # repo-local agent skills
├── .github/workflows/      # ci.yml + publish.yml + auto-merge.yml
├── README.md               # user-facing pitch
├── CHANGELOG.md            # release history
├── RUNBOOK.md              # release / triage / rollback procedures
├── CONFIG.md               # mulch.config.yaml reference
├── ROADMAP.md              # direction
├── biome.json
├── bunfig.toml
├── tsconfig.json
└── package.json
```

## Commands

All commands run from the repo root unless noted. Bun must be on `PATH`.

```bash
bun install                       # install dependencies
bun test                          # run all tests
bun test test/commands/record.test.ts   # run a single test file
bun run lint                      # biome check --error-on-warnings src/ test/
bun run lint:fix                  # biome check --write src/ test/
bun run typecheck                 # tsc --noEmit
```

Quality gates and reports (each lives in `scripts/`):

```bash
bun run check:all                 # scripts/check-all.ts — quiet runner, all nine gates
bun run verify                    # alias for check:all (agent-facing entry point)
bun run check:size                # scripts/check-file-sizes.ts
bun run check:debt                # scripts/check-debt-markers.ts
bun run check:dups                # jscpd duplication budget (.jscpd.json)
bun run check:deps                # knip unused/undeclared dependency check
bun run check:coverage            # scripts/check-coverage.ts
bun run check:agents              # scripts/validate-agents-md.ts (this file)
bun run check:ci-parity           # scripts/check-ci-parity.ts — CI parity meta-gate
bun run report:timing             # slowest suites/tests from the JUnit report
bun run report:quality            # consolidated quality summary
```

`check:all` follows the os-eco fleet `check:all` standard
(docs/check-all-standard.md at the os-eco meta-repo root): the quiet runner
resolves its ordered manifest — `lint`, `typecheck`, `check:agents`,
`check:dups`, `check:deps`, `check:size`, `check:debt`,
`check:coverage`, `check:ci-parity` — from `package.json` and prints one
aligned line per gate plus a tally. `scripts/check-all.ts` and
`scripts/check-ci-parity.ts` are byte-identical fleet-wide; never edit
them in place. Per-repo variation lives in `package.json` script bodies
and `scripts/ci-parity-config.json` (CI-side aliases and intentionally
CI-only steps).

The ratchet gates read JSON budgets from `scripts/`:
`scripts/file-size-budgets.json`, `scripts/debt-markers-budget.json`,
and `scripts/coverage-budgets.json`. Budgets are baselined from the
repo's current state and only tighten over time (size + debt move down,
coverage moves up).

`bun run check:agents` parses this file and asserts every `bun run <X>`
token inside a fenced bash block is defined in `package.json`'s
`scripts` map, and every backticked path-shaped token resolves on disk
relative to the repo root. When it fails, fix the broken reference in
the same commit — do not silently work around it.

User-facing `ml` reference:

```bash
bunx ml --help                    # top-level help
bunx ml <subcommand> --help       # per-command help
```

## Storage Model

Mulch stores expertise as append-only JSONL, **one file per domain**,
under `.mulch/expertise/` (e.g. `.mulch/expertise/cli.jsonl`). The path
`.mulch/expertise/<domain>.jsonl` is the unit of storage; there is no
single monolithic records file. Project configuration lives in
`.mulch/mulch.config.yaml`, and lifecycle hooks live under `.mulch/hooks/`.

Each record carries:

- a **type** (`convention`, `pattern`, `failure`, `decision`,
  `reference`, `guide`, or a project-declared custom type) with
  type-specific required fields defined in `src/schemas/record.ts`;
- a **classification** with a shelf life — `foundational` (permanent),
  `tactical` (14 days), `observational` (30 days) — used by `ml prune`;
- a **confirmation score** and timestamps that age with use, so
  repeatedly-confirmed records rank higher and stale ones decay.

**Upsert semantics:** `ml record` upserts by name. A **named** record
(one with a stable identity) **merges outcomes** into the existing
record instead of replacing it, so re-recording the same insight
accretes evidence rather than clobbering history. An **anonymous**
record simply appends a new line. Writes go through an advisory file
lock (`src/utils/lock.ts`) and atomic temp-file rename
(`src/utils/expertise.ts`), so multiple agents can record concurrently
without corrupting the JSONL.

The core CLI verbs are `ml record` (store), `ml prime` (load), `ml
status` (domain health), `ml doctor` (integrity check), `ml learn`
(discover what to record from changed files), and `ml sync` (validate,
stage, commit `.mulch/` changes). Worktree-aware storage in
`src/utils/git.ts` resolves `.mulch/` to the main repo so expertise
survives `git worktree` cleanup.

## Agent Workflow

When an agent works in mulch, it should:

1. **Prime context at session start.** Run `ml prime` to load
   project-specific conventions, patterns, decisions, and failures. Run
   `ml prime --files src/cli.ts` (file-anchor framing) to load only the
   records anchored to the paths you are about to edit — the output
   includes per-file relevance, classification age, and confirmation
   scores so you can weigh each record.
2. **Find unblocked work.** Use the repo's issue tracker (Seeds:
   `sd ready`; GitHub: `gh issue list`).
3. **Make focused changes.** One concern per commit. Preserve existing
   conventions — adapt, do not overwrite. Read `CLAUDE.md` for the
   architecture and TypeScript conventions.
4. **Run gates locally.** `bun run verify` (the full `check:all`
   manifest) must exit 0 before commit. Run `bun run check:agents`
   after editing this file.
5. **Pin debt markers.** Any new `TODO` / `FIXME` / `HACK` must
   reference a tracker id on the same line, or `bun run check:debt`
   fails.
6. **Record insights before finishing.** When you discover a
   convention, apply a pattern, make a decision, or hit a failure worth
   preserving, store it:
   ```bash
   ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
   ```
   Evidence auto-populates from git (current commit + changed files).
   Named records merge outcomes on re-record; validation failures print
   a copy-paste retry hint with the missing fields pre-filled.
7. **Commit & sync.** Commit message follows `mulch: <summary>`. Run
   `ml sync` to validate, stage, and commit `.mulch/` changes. Do not
   `git push` unless the user asks; leave commits local.

### Session completion protocol

Before ending a session:

1. Run `ml learn` to see what changed and which domains to record into.
2. Record any session insights with `ml record`.
3. Run the gate suite (`bun run verify`).
4. File issues for remaining work (`sd create --title "..."`); close
   finished issues (`sd close <id>`).
5. `ml sync` to commit `.mulch/`; push only when the user requests it.
6. Verify `git status` is clean.

## Further reading

- `CLAUDE.md` — authoritative long-form conventions and architecture.
- `README.md` — user-facing pitch + install instructions.
- `RUNBOOK.md` — release, triage, and rollback procedures.
- `CONFIG.md` — reference for `.mulch/mulch.config.yaml`.
- `CHANGELOG.md` — release history.
- `ROADMAP.md` — direction.
- `.factory/skills/mulch-record-from-evidence/SKILL.md` — repo-local
  agent skill for turning git evidence into `ml record` invocations.
