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
ml prime --files src/foo.ts                        # Prime only records relevant to specific files
ml prime --manifest                                # Domain index for monoliths (scope-load on demand)
```

For large monoliths where dumping every record wastes context, set `prime.default_mode: manifest` in `.mulch/mulch.config.yaml` — `ml prime` then emits a quick reference + domain index, and agents scope-load with `ml prime <domain>` or `ml prime --files <path>`.

## Commands

Every command supports `--json` for structured output. Global flags: `-v`/`--version`, `-q`/`--quiet`, `--verbose`, `--timing`. ANSI colors respect `NO_COLOR`.

| Command | Description |
|---------|-------------|
| `ml init` | Initialize `.mulch/` in the current project |
| `ml add <domain>` | Add a new expertise domain |
| `ml record <domain> --type <type>` | Record an expertise record (`--tags`, `--force`, `--relates-to`, `--supersedes`, `--batch`, `--stdin`, `--dry-run`, `--evidence-bead`) |
| `ml edit <domain> <id>` | Edit an existing record by ID or 1-based index |
| `ml delete <domain> [id]` | Delete records by ID, `--records <ids>`, or `--all-except <ids>` (`--dry-run`) |
| `ml delete-domain <domain>` | Remove a domain from config and delete its expertise JSONL file (`--yes`, `--dry-run`) |
| `ml query [domain]` | Query expertise (`--all`, `--classification`, `--file`, `--outcome-status`, `--sort-by-score`, `--format` filters) |
| `ml prime [domains...]` | Output AI-optimized expertise context (`--manifest`, `--full`, `--budget`, `--no-limit`, `--context`, `--files`, `--exclude-domain`, `--export`) |
| `ml search [query]` | Search records across domains with BM25 ranking (`--domain`, `--type`, `--tag`, `--classification`, `--file`, `--sort-by-score`, `--no-boost`, `--format`) |
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

### Global Output Format

All record-rendering commands (`ml prime`, `ml query`, `ml search`) accept a global `--format <markdown|compact|xml|plain>` flag that selects the output formatter. `xml` is Claude-optimized; `plain` is Codex-optimized; `compact` emits one-liner records (default for `ml prime`); `markdown` emits the full, sectioned layout. Per-command `--format` flags (e.g. `ml query --format ids`) take precedence over the global flag.

```bash
ml --format xml prime testing      # XML expertise tree (Claude-friendly)
ml --format plain prime testing    # plain text (Codex-friendly)
ml --format compact query testing  # compact one-liners
ml prime --full                    # alias for --format markdown
ml prime --compact                 # alias for --format compact
```

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

All records support optional `--classification` (foundational / tactical / observational), evidence flags (`--evidence-commit`, `--evidence-issue`, `--evidence-file`, plus tracker-specific `--evidence-bead`, `--evidence-seeds`, `--evidence-gh`, `--evidence-linear`), `--tags`, `--relates-to`, `--supersedes` for linking, and `--outcome-status` (success/failure) for tracking application results. Cross-domain references use `domain:mx-hash` format (e.g., `--relates-to api:mx-abc123`). When `evidence.commit` or `files[]` are omitted, `ml record` auto-populates them from the current git context.

### Custom Types

Project-specific record types declared under `custom_types:` in `.mulch/mulch.config.yaml` get full registry treatment — CLI flags, validation, dedup, formatters. Each definition declares required + optional fields, a dedup key, and a summary template:

```yaml
custom_types:
  hypothesis:
    required: [statement, prediction]
    optional: [evidence_files]
    dedup_key: statement
    summary: "{{statement}} → {{prediction}}"
```

`ml record research --type hypothesis --statement "..." --prediction "..."` then writes a first-class record indistinguishable from a built-in.

### Per-Domain Allowed Types

Gate which record types may be written into a domain by listing them under that domain's `allowed_types`:

```yaml
domains:
  backend:
    allowed_types: [convention, pattern, decision]
  frontend:
    allowed_types: [convention, pattern]
  notes: {}   # empty/missing allowed_types ⇒ all registered types allowed
```

`ml record` rejects any write whose `--type` isn't in the list and prints a copy-paste retry hint with the first allowed type filled in. Empty or missing `allowed_types` preserves back-compat behavior (any registered type is accepted).

`disabled_types` wins on overlap — if a domain allows `failure` but `disabled_types: [failure]` is also set, the write still succeeds with the disabled-type deprecation warning, so peer agents in shared domains don't hard-fail when a type is being retired.

### Per-Domain Required Fields

Require additional top-level fields on every record written into a domain by listing them under `required_fields`:

```yaml
domains:
  backend:
    allowed_types: [task]
    required_fields: [oncall_owner]
custom_types:
  task:
    required: [description]
    optional: [oncall_owner]
    dedup_key: description
    summary: "{description}"
```

`ml record` rejects writes that omit any listed field and prints a single retry hint with all missing fields filled in. `required_fields` stacks on top of the per-type required fields enforced by the schema — it adds, never replaces. Top-level field names only; nested paths (`evidence.commit`, etc.) are out of scope. Empty or missing `required_fields` preserves back-compat behavior.

### Doctor and Sync Re-Validation

`ml doctor` surfaces existing records that violate domain rules so worktree/CI lag (records landing before config catches up via `merge=union`) doesn't sit silently:

- **`domain-conformance`** (informational) — per-domain summary of conforming vs. violating records. Runs whether or not the domain has rules; domains with no rules report all records as conforming.
- **`domain-violations`** (failing) — lists each offending record with `domain:line [id] (type)` and the rule it broke (type not in `allowed_types`, or missing `required_fields`). No `--fix` in v1: violations require human judgment (rewrite the record vs. relax the rule).

`ml sync` re-reads `mulch.config.yaml` and re-validates every on-disk record against the current rules before staging. This is the worktree/CI lag escape valve: once config catches up, sync reconciles without a restart. Sync intentionally ignores `--allow-domain-mismatch` — like `--allow-unknown-types`, escape hatches stop at the commit gate.

The `--allow-domain-mismatch` global flag is the same kind of escape hatch as `--allow-unknown-types`, and is honored by `ml record` and `ml validate` only:

```bash
ml record backend --type pattern --name x --description y --allow-domain-mismatch
ml validate --allow-domain-mismatch    # tolerate rule violations during the lag window
ml sync                                 # gatekeeps commits — ignores the flag
```

### Disabled Types

Mark a type as deprecated to retire it gracefully across shared domains:

```yaml
disabled_types: [failure]
```

Writes still succeed and the type stays in CLI choices (so peers in shared domains aren't broken), but each write emits a stderr warning. `--quiet` suppresses the warning. Reads ignore the disabled flag entirely.

### Aliases (Schema Evolution)

When you rename a field on a custom type, declare aliases to keep existing JSONL readable:

```yaml
custom_types:
  hypothesis:
    required: [statement, prediction]
    dedup_key: statement
    summary: "{{statement}}"
    aliases:
      statement: [claim, assertion]   # canonical → [legacy_names]
```

At read time, legacy field names are rewritten to canonical (canonical wins on conflict, legacy is dropped). Writes always use canonical. No migration script needed.

### Unknown-Type Policy

Readers refuse on-disk records whose type isn't registered, raising a targeted error with file, line, and ID. The `--allow-unknown-types` global flag is the escape hatch for the worktree/CI window where a JSONL record (which `merge=union` accepts) lands before `mulch.config.yaml` catches up:

```bash
ml validate --allow-unknown-types     # validate everything else; defer reconciliation
ml sync                                # gatekeeps commits — ignores the flag
```

`ml sync` re-loads the registry from disk before validating, so once config is reconciled, sync passes without a restart. `ml doctor` lists registered types (built-in vs custom, per-type counts) and surfaces unknown-type records as a failing check.

## Example Output

```
$ ml query database

## database (6 records, updated 2h ago)

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
| **Safe** (locked writes) | `record`, `edit`, `delete`, `delete-domain`, `compact`, `prune`, `doctor` | Acquire per-file lock before writing. Multiple agents can target the same domain — the lock serializes access automatically. |
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

## Lifecycle Hooks

Mulch invokes user-supplied shell scripts at key lifecycle events so org-specific behavior (secret scanning, owner enforcement, Slack notifications, team-scoped filtering) can land as config rather than a fork.

### Events

| Event | When it fires | Block on non-zero | Mutation via stdout |
|---|---|---|---|
| `pre-record` | Before each record is written | yes | yes |
| `post-record` | After a successful create/update | warn only | no |
| `pre-prime` | Before `ml prime` emits output | yes | yes |
| `pre-prune` | Before `ml prune` removes records | yes | no |

### Contract

- Each script is invoked with the payload as JSON on **stdin**.
- Exit `0` to continue; non-zero **blocks** for `pre-*` events and emits a **warning** for `post-*` events.
- For mutable events (`pre-record`, `pre-prime`), the script may print a modified payload as JSON on **stdout** to rewrite it in place. The next script in the array (and the eventual write) sees the mutated payload.
- Stderr is forwarded to the user; stdin is the only input channel.
- Scripts are run via `sh -c`, with cwd set to the mulch project root and `MULCH_HOOK=1` in the environment.
- Hooks **do not fire** in `--dry-run` mode (record, prune) — previews shouldn't trigger external side effects.

### Configuration

```yaml
# .mulch/mulch.config.yaml
hooks:
  pre-record:    [./.mulch/hooks/scan-secrets.sh, ./.mulch/hooks/require-owner.sh]
  post-record:   [./.mulch/hooks/post-to-slack.sh]
  pre-prime:     [./.mulch/hooks/filter-by-team.sh]
  pre-prune:     [./.mulch/hooks/digest-then-confirm.sh]

hook_settings:
  timeout_ms: 5000   # default; per-script SIGKILL after this
```

### Example: secret scanning at record time

```sh
#!/bin/sh
# .mulch/hooks/scan-secrets.sh
input=$(cat)
if echo "$input" | grep -qE 'sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}'; then
  echo "Refusing to record: payload contains an API key shape." >&2
  exit 1
fi
```

### Example: pre-record mutation (redacting tokens)

```sh
#!/bin/sh
# .mulch/hooks/redact-tokens.sh
input=$(cat)
echo "$input" | bun -e "
const { event, payload } = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (payload.record.content) {
  payload.record.content = payload.record.content.replace(/sk-[A-Za-z0-9]+/g, '<REDACTED>');
}
console.log(JSON.stringify({ event, payload }));
"
```

The hook returns either the full `{ event, payload }` envelope or just the inner payload object — both shapes are accepted. Multiple `pre-record` hooks compose in array order; output of script N becomes input of script N+1.

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
