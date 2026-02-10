# Mulch — Growing Expertise for Coding Agents

**Status:** Design document
**Origin:** Patterns extracted from KotaDB agent infrastructure (10 domains, 40 agents, expertise files that compound over time)
**Date:** 2026-02-09
**Purpose:** Personal tool and portfolio piece demonstrating the build → discover → extract → generalize arc

---

## The Problem

Agents start every session from zero. The pattern your agent discovered yesterday — that VACUUM inside a transaction silently corrupts your database — is forgotten today. The architectural decision to use SQLite over Postgres? Not available to the build agent that needs it. Failed approaches get retried because nothing records them. Every project reinvents how to teach agents about the codebase, and most don't bother at all.

The tools that exist today address fragments of this:
- **CLAUDE.md / Cursor Rules** give agents static instructions, but they don't grow
- **Cline Memory Bank** captures session context, but it's provider-locked and unstructured
- **Mem0** provides memory-as-a-service, but it's cloud-dependent and opaque
- **Beads** tracks task state beautifully, but tasks are transactional — they complete and compact

None of these own the space of **structured expertise that accumulates over time, lives in git, works with any agent, and runs locally with zero dependencies.**

---

## The Approach

Mulch is a **passive layer**. It does not contain an LLM. It does not analyze sessions. It does not "automatically" learn anything.

Instead: **agents use Mulch. Mulch does not use agents.**

This is the same architectural model as Beads. `bd create` and `bd update` are commands that agents call. The agent decides what to record. The tool provides structure, schema validation, and file organization. The intelligence stays in the agent.

Concretely:
- Mulch is a CLI that manages structured expertise files in `.mulch/`
- Agents call `mulch record` to write learnings after doing work
- Agents call `mulch query` to get formatted expertise before starting work, or receive it via `mulch prime` injection at session start
- Mulch itself has **zero LLM dependency** — it is file organization with schema validation

This means:
- No "who pays for LLM calls" problem — Mulch makes no LLM calls
- No "learning quality" problem — quality equals agent quality
- Provider-agnostic is trivially achieved — any agent with bash access can call the CLI
- No session transcript parsing needed
- Architecture is dramatically simpler than an active learning system

The gardening metaphor holds: mulch is not the plant. It does not grow on its own. Gardeners (agents) lay it down, and it enriches the soil for the next thing that grows there.

---

## How It Works

```
1. mulch init               → Creates .mulch/ with domain JSONL files
2. Agent reads expertise     → Grounded in everything the project has learned
3. Agent does work           → Normal task execution
4. Agent calls mulch record  → Writes structured learnings back to .mulch/
5. git push                  → Teammates' agents get smarter too
```

The critical insight: step 4 is agent-driven. The agent — not Mulch — decides what's worth recording. The agent has the context of what it just did, what surprised it, what failed, what patterns it observed. Mulch provides the schema and file structure so those learnings land in a consistent, queryable format.

---

## What's in `.mulch/`

**Storage format ≠ Delivery format.** Three layers:

| Layer | Format | Role |
|-------|--------|------|
| **Storage** (`.mulch/expertise/*.jsonl`) | JSONL | Append-only typed records — what's on disk |
| **Config** (`mulch.config.yaml`) | YAML | Metadata, domain list, governance settings |
| **Delivery** (`mulch prime` output) | Provider-optimized (markdown/XML) | What agents actually consume |

```
.mulch/
├── expertise/
│   ├── database.jsonl        # All database knowledge: conventions, patterns, failures, decisions
│   ├── api.jsonl             # One JSONL file per domain
│   └── testing.jsonl         # Each line is a typed, structured record
└── mulch.config.yaml         # Config: domains, governance settings
```

Everything is git-tracked. Clone a repo and your agents immediately have the project's accumulated expertise. Every `git push` shares what agents recorded. No servers, no syncing, no accounts.

This is exactly the Beads model: raw storage is JSONL, human/agent-readable views come from CLI commands. The principle from prompt engineering research: "Keep YAML for metadata/routing, JSON for schemas — do not mix these roles."

---

## The Expertise Loop

```
Work → Record → Persist → Share → Work (smarter)
         ↑                           |
         └───────────────────────────┘
```

The loop is agent-driven at every step. The agent reads expertise before work, decides what to record after work, and calls `mulch record` with structured entries. Mulch validates the schema and appends to domain JSONL files.

Other tools give agents memory of **what happened**. Mulch gives agents expertise on **how to do things well**. The difference:

- Memory: "I worked on pagination last Tuesday"
- Expertise: "Pagination in this codebase uses cursor-based patterns, the `withPagination` helper handles offset math, and the naive LIMIT/OFFSET approach causes N+1 queries on joined tables — don't use it"

Expertise compounds. Every recorded learning enriches the soil. The tenth agent to touch a domain works with the accumulated wisdom of the nine before it.

---

## What Expertise Looks Like

**Storage** (`.mulch/expertise/database.jsonl`) — what's on disk:

```jsonl
{"type":"convention","content":"Use WAL mode for all SQLite connections","evidence":{"commit":"a1b2c3d","date":"2026-01-15"},"classification":"foundational"}
{"type":"convention","content":"Migrations are sequential, never concurrent","classification":"foundational"}
{"type":"convention","content":"FTS5 indexes use porter tokenizer","classification":"foundational"}
{"type":"pattern","name":"migration-runner","description":"All schema changes go through the migration runner","files":["src/db/migrations/*.ts"],"evidence":{"commit":"a1b2c3d","date":"2026-01-15"},"classification":"foundational"}
{"type":"failure","description":"VACUUM inside a transaction causes silent corruption","resolution":"Always run VACUUM outside transaction boundaries","evidence":{"commit":"f4e5d6c","issue":"#187","date":"2026-02-01"},"classification":"foundational"}
{"type":"decision","title":"SQLite over PostgreSQL","rationale":"Local-only product; no network dependency acceptable","date":"2025-11-15","classification":"foundational"}
```

**Delivery** (`mulch prime` output) — what agents actually read:

```markdown
# Project Expertise (via Mulch)

## database (6 entries, updated 2h ago)

### Conventions
- Use WAL mode for all SQLite connections
- Migrations are sequential, never concurrent
- FTS5 indexes use porter tokenizer

### Known Failures
- VACUUM inside a transaction causes silent corruption
  → Always run VACUUM outside transaction boundaries

### Decisions
- SQLite over PostgreSQL: Local-only product, no network dependency acceptable
```

Agents never read the JSONL directly. They get `mulch prime` output (injected via hooks at session start) or `mulch query` output (on demand). The storage format is machine-optimized — append-only, schema-validated, merge-conflict-free. The delivery format is agent-optimized — readable, structured, adapted per provider.

An agent reading the `mulch prime` output before starting work already knows more about your database layer than most human contributors on their first week. And the file got this rich not through any magic — agents recorded learnings after each session, and the entries accumulated like mulch enriching soil.

---

## CLI Design

Mulch's CLI reflects the passive model. Every command is either file management or structured write/read. No command triggers LLM processing.

```bash
# Setup
mulch init                          # Creates .mulch/ with config and starter files
mulch add <domain>                  # Scaffolds a new expertise file

# Recording (called by agents after work)
mulch record <domain> --type convention "Use WAL mode for SQLite"
mulch record <domain> --type pattern --name migration-runner --files "src/db/migrations/*.ts"
mulch record <domain> --type failure --description "..." --resolution "..."
mulch record <domain> --type decision --title "..." --rationale "..."

# Querying (called by agents before work)
mulch query <domain>                # Returns full expertise for a domain
mulch query <domain> --type failures  # Returns only failures
mulch query --all                   # Returns all domains (for broad context)

# Agent Integration
mulch setup <provider>              # Install provider-specific hooks (claude, cursor, codex, etc.)
mulch prime                         # Output AI-optimized expertise context for session injection
mulch onboard                       # Generate minimal AGENTS.md/CLAUDE.md snippet

# Maintenance
mulch status                        # Expertise freshness, knowledge counts, domain health
mulch validate                      # Schema validation across all files
mulch prune                         # Remove stale tactical entries past shelf life
```

Any agent with bash access can call these commands. The CLI is the primary interface — `mulch query` and `mulch prime` produce formatted output from the raw JSONL storage, so agents never need to parse JSONL themselves.

---

## Agent Integration

The most important design problem for Mulch is not storage or schema — it is how agents discover and use accumulated expertise. Without an integration layer, Mulch is just a directory of JSONL files that agents never read.

The integration model is copied directly from Beads' proven 3-layer pattern (`bd setup` / `bd prime` / `bd onboard`), adapted for expertise delivery instead of task state.

### `mulch setup <provider>`

One command installs provider-specific integration. Mulch writes the config files itself — the user never manually edits provider settings.

Built-in recipes: `claude`, `cursor`, `codex`, `gemini`, `windsurf`, `aider`. Each recipe knows where its provider stores configuration:
- **Claude**: installs hooks in `~/.claude/settings.json` for `SessionStart` and `PreCompact` events
- **Cursor**: writes `.cursor/rules/mulch.mdc` with expertise injection rules
- **Codex / others**: writes an AGENTS.md section pointing to `mulch prime`

Custom recipe support: `mulch setup --add <name> <path>` registers a user-defined recipe.
Management: `mulch setup <recipe> --check` (verify installation), `mulch setup <recipe> --remove` (clean uninstall).

### `mulch prime`

Outputs AI-optimized expertise context for the current project. This is the payload that gets injected at session start. It serves two purposes simultaneously: deliver accumulated expertise AND teach the agent how to record new learnings back.

Example output:

```markdown
# Project Expertise (via Mulch)

## database (14 entries, updated 2h ago)

### Conventions
- Use WAL mode for all SQLite connections
- Migrations are sequential, never concurrent
- FTS5 indexes use porter tokenizer

### Known Failures
- VACUUM inside a transaction causes silent corruption
  → Always run VACUUM outside transaction boundaries

### Recent Decisions
- SQLite over PostgreSQL: Local-only product, no network dependency acceptable

## api (11 entries, updated 1d ago)
...

## Recording New Learnings

When you discover a pattern, convention, failure, or make an architectural decision:

mulch record <domain> --type convention "description"
mulch record <domain> --type failure --description "..." --resolution "..."
mulch record <domain> --type decision --title "..." --rationale "..."
mulch record <domain> --type pattern --name "..." --files "..."
```

Flags: `--full` (force full output), `--mcp` (minimal output for MCP mode), `--export` (dump default template).
Overridable: drop `.mulch/PRIME.md` to customize the output template.
Adapts: detects MCP mode and adjusts token footprint automatically.

### `mulch onboard`

Generates a minimal AGENTS.md or CLAUDE.md snippet (~10 lines) pointing to `mulch prime`. This is the fallback for providers without hook support. Keeps docs lean — `mulch prime` provides the dynamic context, the snippet just tells the agent to call it.

### Why this works

Agents do not need to "see the value" in Mulch as a tool — they see the value in the expertise itself. The expertise is injected automatically at session start with zero friction. Recording instructions are included alongside the expertise, so the agent naturally contributes back. PreCompact re-injection means the agent does not forget Mulch after context compression. The whole pattern is a direct copy of Beads' proven model, applied to expertise instead of task state.

---

## Beads + Mulch

These tools are complementary with opposite design philosophies about history.

**Beads** is transactional task memory. It tracks what happened, what's pending, what's done. Its "memory decay" mechanism compacts old tasks — history fades because task details become less relevant over time. The design philosophy: recent context matters most.

**Mulch** is accumulative expertise. It tracks what works, what fails, what patterns to follow. Entries are preserved and enriched — a failure discovered six months ago is just as valuable as one discovered yesterday. The design philosophy: expertise compounds and should never decay.

| | Beads | Mulch |
|---|---|---|
| **Memory type** | Task memory — "What should I work on?" | Expertise — "How should I do this well?" |
| **Records** | What happened, what's pending, what's done | What works, what doesn't, what patterns to follow |
| **History model** | Decay — old tasks compact and fade | Accumulate — old expertise is preserved and enriched |
| **Architecture** | Passive layer, agents call CLI | Passive layer, agents call CLI |
| **Analogy** | A to-do list that travels with the repo | A mentor that gets wiser with every session |

Together: agents know what to do AND how to do it well.

```bash
bd ready           # Beads: "Here's what needs doing"
mulch query api    # Mulch: "Here's how to do it well in this codebase"
```

Both tools use the same 3-layer integration pattern (`setup` / `prime` / `onboard`) — Beads for task state, Mulch for expertise. A single `mulch setup claude` and `bd setup claude` installs both, and both inject at SessionStart. The agent gets task context and domain expertise in one session-start payload, from two complementary tools that share no code but share the same proven integration design.

---

## Architecture Decisions

These decisions were validated empirically through KotaDB's expertise system.

### JSONL for all expertise storage

Everything in `.mulch/expertise/` is append-only JSONL — conventions, patterns, failures, and decisions all live in domain-specific files. This is a deliberate departure from KotaDB's YAML-based expertise files, and the Beads project provides the precedent (15k+ stars, same storage model).

**Why JSONL everywhere:**
- `mulch record` is trivial — append a JSON line. No YAML library, no indent management, no comment preservation gymnastics.
- Zero merge conflicts — two agents recording to the same domain both append lines. Git handles concurrent appends cleanly.
- Schema validation is trivial — JSON Schema on each record, not fuzzy YAML structure checking.
- More structured than YAML, not less — typed records with explicit fields, validated per-line.
- The Beads precedent — Beads stores JSONL, presents human views via CLI. Proven model.

**Why YAML for config only:**
- `mulch.config.yaml` is metadata/routing — domain list, governance thresholds. This is what YAML is actually designed for.
- Config changes rarely, is human-edited, and doesn't grow. YAML's strengths (readability, comments) apply. Its weaknesses (merge conflicts, programmatic editing) don't.

**Why the delivery format varies:**
- `mulch prime` output is optimized per provider. Claude gets XML tags (Claude's training handles XML preferentially). Cursor gets markdown. Codex gets plain text.
- Storage format doesn't constrain delivery. JSONL to any output format is trivial.
- This comes from prompt engineering research: Claude shows up to 40% accuracy variance based on delimiter choice. Optimizing delivery per provider matters.

**The tradeoff:**
- You lose "open the file and browse it directly." The raw JSONL is not pleasant to read.
- You gain: `mulch query database` for formatted views, `mulch prime` for agent injection, and all the append/merge/validation benefits.
- Same tradeoff Beads made. Same conclusion: machine-optimized storage with human-optimized views beats human-optimized storage that machines struggle to edit safely.

### Size governance

Expertise files have entry limits validated against KotaDB's real files (a 600-line YAML file has roughly 50-100 structured entries):
- **100 entries**: target maximum per domain (comfortable working size)
- **150 entries**: warning threshold (consider splitting domains)
- **200 entries**: hard limit (must decompose into sub-domains)

Beyond 150 entries, agents begin to lose signal in noise. `mulch status` reports entry counts per domain and flags thresholds.

### Evidence-linked entries

Every pattern, failure, and decision links to a commit hash, file path, or issue number. This turns expertise from opinion into verifiable record. When an agent reads "VACUUM inside a transaction causes silent corruption," the linked commit proves it.

### Knowledge classification

Not all knowledge ages the same way:
- **Foundational**: Preserve forever (architectural decisions, core conventions)
- **Tactical**: 14-day shelf life (workarounds for current bugs, temporary patterns)
- **Observational**: Prune if unused after 30 days (tentative patterns that may not hold)

`mulch prune` uses these classifications to keep expertise files focused.

### No mocks in tests — ever

Mulch's test suite uses real filesystems, real JSONL files, and real CLI invocations. Mocks are banned entirely — no `jest.mock()`, no `vi.mock()`, no stub implementations, no fake filesystems.

**Why:**
- Mocks test your assumptions about interfaces, not your actual code. A mocked filesystem that returns `{ success: true }` tells you nothing about whether your JSONL append actually works.
- Mulch is a file-management CLI. The entire value proposition is that it correctly reads, writes, validates, and organizes files. Mocking the filesystem is mocking the product.
- Integration-style tests catch real bugs — encoding issues, path resolution edge cases, permission errors, JSONL parse failures on malformed lines. Mocks hide all of these.
- Tests that use real temp directories and real CLI calls serve as executable documentation. A new contributor can read the test and understand exactly what the tool does.

**In practice:** Tests create real temp directories, run real `mulch` commands, and assert against real file contents. Setup and teardown handle directory creation and cleanup. This is slightly slower than mocked unit tests and dramatically more useful.

### Strict typechecking and linting — no exceptions

TypeScript strict mode is enabled with zero escape hatches. ESLint runs with zero warnings tolerated. There are no `// @ts-ignore`, no `// @ts-expect-error`, no `// eslint-disable`, no `any` types, no suppressed warnings. The CI pipeline treats warnings as errors.

**Why:**
- A tool that manages structured data for other tools must be structurally sound itself. If Mulch's own codebase can't maintain type safety, why would anyone trust it to validate expertise schemas?
- Warnings accumulate. One `@ts-ignore` becomes twenty. One `any` type propagates through three call sites. Zero tolerance prevents the rot from starting.
- Strict types catch real bugs in a CLI tool — `string | undefined` flowing into a file path, missing fields on parsed JSONL records, incorrect option types from Commander.js. These are exactly the bugs that ship silently without strict checking.
- This is a portfolio piece. The code quality is part of the product.

**In practice:** `tsconfig.json` uses `"strict": true` with all additional strict flags enabled. ESLint is configured to error on all rules (no `"warn"` severity). CI fails on any diagnostic. If a type is genuinely complex, the fix is a proper type definition — not a suppression comment.

### Convergence detection

Two novel metrics from KotaDB:
- **insight_rate_trend**: As a domain matures, the rate of new learnings per session decreases. When this trend flattens, the domain's expertise is approaching completeness.
- **contradiction_count**: When new entries contradict existing ones, something changed. A rising contradiction count signals architectural drift or stale expertise.

---

## Origin Story

These patterns were not designed in the abstract. They were discovered iteratively while building KotaDB — a local-only code intelligence tool with 10 expert domains and 40 agent definitions.

The key discovery: **expertise files that agents update after each session produce compounding returns.** The third agent to touch the database domain works dramatically better than the first, because it reads two sessions' worth of accumulated patterns, decisions, and failure modes.

Specific moments that validated the pattern:

- **Expertise files** that agents enriched after each work session — conventions, patterns, and failure modes accumulated naturally across 500+ lines per domain.
- **The inflection point**: after the third or fourth session in a domain, agents stopped making mistakes that earlier sessions had already discovered and recorded. The overhead of structured expertise paid for itself after the second task.
- **The generalization signal**: the `.claude/agents/experts/` directory in KotaDB is useful but tightly coupled to Claude Code's conventions. The patterns themselves — JSONL expertise stores, domain decomposition, size governance — are universal.

This is the portfolio arc: **build** a real tool (KotaDB) → **discover** that expertise files are the highest-leverage pattern → **extract** the principles into a design → **generalize** into a standalone tool (Mulch) that any agent can use with any provider.

---

## Open Questions

### Schema design is the hard problem

Making the format structured enough for consistent, machine-parseable entries but flexible enough for diverse learnings across different domains and project types. The KotaDB schemas work for KotaDB — will they generalize to web apps, data pipelines, mobile projects? This needs testing across varied codebases.

### Domain discovery

When a user runs `mulch init`, how does Mulch suggest initial domains? Options:
- Start empty, let users add domains explicitly
- Scan project structure for common patterns (presence of `tests/`, API routes, database migrations)
- Provide templates for common project archetypes

### Recording granularity

When an agent calls `mulch record`, how much structure should be required vs. inferred? A minimal call might be `mulch record database "Use WAL mode"` — but richer entries need type, evidence, classification. JSONL naturally supports both minimal and rich records (each line can have different fields), but the JSON schema design still matters: which fields are required, which are optional, what defaults apply.

### Multi-agent coordination

If two agents record conflicting expertise for the same domain (one says "use LIMIT/OFFSET," the other says "never use LIMIT/OFFSET"), how should Mulch handle it? Options: last-write-wins, flag contradictions for human review, or use the contradiction_count metric to surface drift.

---

## Next Steps

1. **Dogfood immediately**: Use Mulch on its own development — `mulch init` in this repo, record expertise about the CLI's own patterns, conventions, and decisions as they emerge. This is the highest-priority next step. If the tool isn't useful for building itself, the design is wrong. Every session developing Mulch should end with `mulch record` calls capturing what was learned. This also stress-tests the schema, the CLI ergonomics, and the recording workflow under real conditions before anyone else tries it.
2. **Agent integration (`mulch setup` + `mulch prime`)**: This is how agents actually discover and use expertise. Without it, Mulch is invisible to agents. Implement the setup recipes for Claude and Cursor first, then expand. Copied directly from Beads' proven pattern.
3. **JSONL record schema**: Define the JSON schema for each record type (convention, pattern, failure, decision). This is the foundational design decision — everything else builds on it. Start by extracting and generalizing from KotaDB's production schemas.
4. **CLI scaffold**: `mulch init`, `mulch add`, `mulch record`, `mulch query`, `mulch validate`, `mulch setup`, `mulch prime`, `mulch onboard` — the core commands.
5. **Schema validation**: `mulch validate` enforces structure, size governance, and required fields. This is what separates Mulch from "just a directory of JSONL files."
6. **Cross-project test**: Try Mulch on a second, structurally different project (KotaDB, replacing `.claude/agents/experts/`) to validate that the schema generalizes. If it can't replace the real thing, iterate.
7. **Ship**: Publish to npm. A `npx mulch init` that works in any project.
