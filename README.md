# Mulch

Structured expertise management for AI agent workflows.

[![npm](https://img.shields.io/npm/v/@os-eco/mulch-cli)](https://www.npmjs.com/package/@os-eco/mulch-cli)
[![CI](https://github.com/jayminwest/mulch/actions/workflows/ci.yml/badge.svg)](https://github.com/jayminwest/mulch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Agents start every session from zero. The pattern your agent discovered yesterday is forgotten today. Mulch fixes this: agents call `ml record` to write learnings, and `ml query` to read them. Expertise compounds across sessions, domains, and teammates.

**Mulch is a passive layer.** It does not contain an LLM. Agents use Mulch — Mulch does not use agents.

## Install

```bash
bun install -g @os-eco/mulch-cli
```

Or try without installing:

```bash
npx @os-eco/mulch-cli --help
```

### Development

```bash
git clone https://github.com/jayminwest/mulch
cd mulch
bun install
bun link              # Makes 'ml' available globally

bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Quick Start

```bash
ml init                                            # Create .mulch/ in your project
ml add database                                    # Add a domain
ml record database --type convention "Use WAL mode for SQLite"
ml record database --type failure \
  --description "VACUUM inside a transaction causes silent corruption" \
  --resolution "Always run VACUUM outside transaction boundaries"
ml query database                                  # See accumulated expertise
ml prime                                           # Get full context for agent injection
ml prime database                                  # Get context for one domain only
```

## Commands

Every command supports `--json` for structured output. Global flags: `-v`/`--version`, `-q`/`--quiet`, `--verbose`, `--timing`. ANSI colors respect `NO_COLOR`.

| Command | Description |
|---------|-------------|
| `ml init` | Initialize `.mulch/` in the current project |
| `ml add <domain>` | Add a new expertise domain |
| `ml record <domain> --type <type>` | Record an expertise record (`--tags`, `--force`, `--relates-to`, `--supersedes`, `--batch`, `--stdin`, `--dry-run`, `--evidence-bead`) |
| `ml edit <domain> <id>` | Edit an existing record by ID or 1-based index |
| `ml delete <domain> [id]` | Delete records by ID, `--records <ids>`, or `--all-except <ids>` (`--dry-run`) |
| `ml query [domain]` | Query expertise (`--all`, `--classification`, `--file`, `--outcome-status`, `--sort-by-score`, `--format` filters) |
| `ml prime [domains...]` | Output AI-optimized expertise context (`--budget`, `--no-limit`, `--context`, `--files`, `--exclude-domain`, `--format`, `--export`) |
| `ml search [query]` | Search records across domains with BM25 ranking (`--domain`, `--type`, `--tag`, `--classification`, `--file`, `--sort-by-score`, `--format`) |
| `ml compact [domain]` | Analyze compaction candidates or apply a compaction (`--analyze`, `--auto`, `--apply`, `--dry-run`, `--min-group`, `--max-records`) |
| `ml diff [ref]` | Show expertise changes between git refs (`ml diff HEAD~3`, `ml diff main..feature`) |
| `ml status` | Show expertise freshness and counts (`--json` for health metrics) |
| `ml validate` | Schema validation across all files |
| `ml doctor` | Run health checks on expertise records (`--fix` to auto-fix) |
| `ml setup [provider]` | Install provider-specific hooks (claude, cursor, codex, gemini, windsurf, aider) |
| `ml onboard` | Generate AGENTS.md/CLAUDE.md snippet |
| `ml prune` | Remove stale tactical/observational entries |
| `ml ready` | Show recently added or updated records (`--since`, `--domain`, `--limit`) |
| `ml sync` | Validate, stage, and commit `.mulch/` changes |
| `ml outcome <domain> <id>` | Append an outcome to a record (`--status`, `--duration`, `--agent`, `--notes`), or view outcomes |
| `ml upgrade` | Upgrade mulch to the latest version (`--check` for dry run) |
| `ml learn` | Show changed files and suggest domains for recording learnings |
| `ml completions <shell>` | Output shell completion script (bash, zsh, fish) |

## Architecture

Mulch stores expertise as typed JSONL records in `.mulch/expertise/<domain>.jsonl` — one file per domain, one record per line. Six record types (convention, pattern, failure, decision, reference, guide) with three classification tiers (foundational, tactical, observational) govern shelf life and pruning. Advisory file locks and atomic writes ensure safe concurrent access from multiple agents. Schema validation (via Ajv) enforces type-specific required fields. See [CLAUDE.md](CLAUDE.md) for full technical details.

## How It Works

```
1. ml init               → Creates .mulch/ with domain JSONL files
2. Agent reads expertise     → Grounded in everything the project has learned
3. Agent does work           → Normal task execution
4. Agent records insights    → Before finishing, writes learnings back to .mulch/
5. git push                  → Teammates' agents get smarter too
```

The critical insight: step 4 is **agent-driven**. Before completing a task, the agent reviews its work for insights worth preserving and calls `ml record`. Mulch provides the schema and file structure so those learnings land in a consistent, queryable format.

## What's in `.mulch/`

```
.mulch/
├── expertise/
│   ├── database.jsonl        # All database knowledge
│   ├── api.jsonl             # One JSONL file per domain
│   └── testing.jsonl         # Each line is a typed, structured record
└── mulch.config.yaml         # Config: domains, governance settings
```

Everything is git-tracked. Clone a repo and your agents immediately have the project's accumulated expertise.

## Record Types

| Type | Required Fields | Use Case |
|------|----------------|----------|
| `convention` | content | "Use WAL mode for SQLite connections" |
| `pattern` | name, description | Named patterns with optional file references |
| `failure` | description, resolution | What went wrong and how to avoid it |
| `decision` | title, rationale | Architectural decisions and their reasoning |
| `reference` | name, description | Key files, endpoints, or resources worth remembering |
| `guide` | name, description | Step-by-step procedures for recurring tasks |

All records support optional `--classification` (foundational / tactical / observational), evidence flags (`--evidence-commit`, `--evidence-issue`, `--evidence-file`), `--tags`, `--relates-to`, `--supersedes` for linking, and `--outcome-status` (success/failure) for tracking application results. Cross-domain references use `domain:mx-hash` format (e.g., `--relates-to api:mx-abc123`).

## Example Output

```
$ ml query database

## database (6 entries, updated 2h ago)

### Conventions
- Use WAL mode for all SQLite connections
- Migrations are sequential, never concurrent

### Known Failures
- VACUUM inside a transaction causes silent corruption
  → Always run VACUUM outside transaction boundaries

### Decisions
- **SQLite over PostgreSQL**: Local-only product, no network dependency acceptable
```

## Design Principles

- **Zero LLM dependency** — Mulch makes no LLM calls. Quality equals agent quality.
- **Provider-agnostic** — Any agent with bash access can call the CLI.
- **Git-native** — Everything lives in `.mulch/`, tracked in version control.
- **Append-only JSONL** — Zero merge conflicts, trivial schema validation.
- **Storage != Delivery** — JSONL on disk, optimized markdown/XML for agents.

## Concurrency & Multi-Agent Safety

Mulch is designed for multi-agent workflows where several agents record expertise concurrently against the same repository.

### How it works

- **Advisory file locking** — Write commands acquire a `.lock` file (O_CREAT|O_EXCL) before modifying any JSONL file. Retries every 50ms for up to 5 seconds; stale locks (>30s) are auto-removed.
- **Atomic writes** — All JSONL mutations write to a temp file first, then atomically rename into place. A crash mid-write never corrupts the expertise file.
- **Git merge strategy** — `ml init` sets `merge=union` in `.gitattributes` so parallel branches append-merge JSONL lines without conflicts.

### Command safety

| Safety level | Commands | Notes |
|---|---|---|
| **Fully safe** (read-only) | `prime`, `query`, `search`, `status`, `validate`, `learn`, `ready` | No file writes. Any number of agents, any time. |
| **Safe** (locked writes) | `record`, `edit`, `delete`, `compact`, `prune`, `doctor` | Acquire per-file lock before writing. Multiple agents can target the same domain — the lock serializes access automatically. |
| **Serialize** (setup ops) | `init`, `add`, `onboard`, `setup` | Modify config or external files (CLAUDE.md, git hooks). Run once during project setup, not during parallel agent work. |

### Swarm patterns

**Same-worktree agents** (e.g., Claude Code team, parallel CI jobs):

```bash
# Every agent can safely do this in parallel:
ml prime                                    # Read context
ml record api --type pattern --name "..." --description "..."  # Locked write
ml search "error handling"                  # Read-only
```

Locks ensure correctness automatically. If two agents record to the same domain at the same instant, one waits (up to 5s) for the other to finish.

**Multi-worktree / branch-per-agent**:

Each agent works in its own git worktree. On merge, `merge=union` combines all JSONL lines. Run `ml doctor --fix` after merge to deduplicate if needed.

### Batch recording

For recording multiple records atomically (e.g., at session end), use `--batch` or `--stdin`:

```bash
# From a JSON file (single object or array of objects)
ml record api --batch records.json

# From stdin
echo '[{"type":"convention","content":"Use UTC timestamps"}]' | ml record api --stdin

# Preview first
ml record api --batch records.json --dry-run
```

Batch recording uses file locking — safe for concurrent use. Invalid records are skipped with errors; valid records in the same batch still succeed.

**Maintenance during swarm work**:

```bash
ml compact --analyze          # Safe: read-only scan
ml prune --dry-run            # Safe: read-only scan
ml doctor                     # Safe: read-only health check
```

The `--apply`, default (non-dry-run), and `--fix` variants acquire locks and are also safe to run alongside recording agents.

### Edge cases

- **Lock timeout**: If a lock cannot be acquired within 5 seconds, the command fails with an error. Retry or check for stuck processes.
- **Stale locks**: Locks older than 30 seconds are automatically cleaned up (e.g., after a crash).
- **`ml sync`**: Uses git's own locking for commits. Multiple agents syncing on the same branch will contend on git's ref lock — coordinate sync timing or use per-agent branches.
- **`prime --export`**: Multiple agents exporting to the same file path will race. Use unique filenames per agent.

## Programmatic API

Mulch exports both low-level utilities and a high-level programmatic API:

```typescript
// High-level API — recommended for most use cases
import {
  recordExpertise,   // Record a new expertise entry (with dedup and locking)
  searchExpertise,   // Search records across domains
  queryDomain,       // Query all records for a domain
  editRecord,        // Edit an existing record by ID
  appendOutcome,     // Append an outcome to a record (with locking)
} from "@os-eco/mulch-cli";

// Scoring utilities
import {
  computeConfirmationScore,
  sortByConfirmationScore,
  getSuccessRate,
} from "@os-eco/mulch-cli";

// Low-level utilities
import {
  readConfig,
  getExpertisePath,
  readExpertiseFile,
  searchRecords,
  appendRecord,
  writeExpertiseFile,
  findDuplicate,
  generateRecordId,
  recordSchema,
} from "@os-eco/mulch-cli";
```

Types (`ExpertiseRecord`, `MulchConfig`, `RecordType`, `Classification`, `ScoredRecord`, `Outcome`, `RecordOptions`, `RecordResult`, `SearchOptions`, `SearchResult`, `QueryOptions`, `EditOptions`, `RecordUpdates`, `OutcomeOptions`, `AppendOutcomeResult`, etc.) are also exported.

## Part of os-eco

Mulch is part of the [os-eco](https://github.com/jayminwest/os-eco) AI agent tooling ecosystem.

<p align="center">
  <img src="https://raw.githubusercontent.com/jayminwest/os-eco/main/branding/logo.png" alt="os-eco" width="444" />
</p>

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on setting up a development environment, coding conventions, and submitting pull requests.

For security issues, see [SECURITY.md](SECURITY.md).

## License

MIT
