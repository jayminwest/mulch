# @os-eco/pi-mulch

Pi-coding-agent extension that hard-wires mulch's `prime` / `record` rituals into pi lifecycle events. Ships inside `@os-eco/mulch-cli`; the `pi` field in `package.json` points pi at `extensions/pi/index.ts`.

## What it does

| pi event | what the extension does |
|----------|-------------------------|
| `session_start` | Runs `ml prime` and caches the result. Hydrates the scope-load primedPaths set from session entries so `/reload` doesn't re-prime files already loaded. Rebuilds `record_expertise` / `query_expertise` tools from the live type-registry. |
| `before_agent_start` | Injects the cached `ml prime` markdown into the system prompt inside a stable fence. |
| `tool_call` | On `Read` / `Edit` / `Write` / `Find` / `Grep`-style events, fires a debounced `ml prime --files <path>` and steers the result back into the conversation. |
| `agent_end` | Runs `ml learn` and surfaces a UI widget with `Record: <domain>/<type>?` lines for any insight worth preserving. |
| `session_shutdown` | Cancels pending scope-load timers and clears the learn widget. |

## Install

The canonical install path:

```bash
ml setup pi              # writes .pi/settings.json + flips CLAUDE.md marker to :pi
ml setup pi --check      # verify install state
ml setup pi --remove     # uninstall both legs
```

`ml setup pi` adds `"@os-eco/mulch-cli"` to `.pi/settings.json`'s `packages` array (preserving any existing entries) and refreshes the `<!-- mulch:start -->`-fenced section of `CLAUDE.md` / `AGENTS.md` to the short pi-aware variant. The marker carries a `:pi` suffix so onboarding detection knows the extension is active.

For in-tree development without going through the setup recipe, load it directly with:

```bash
pi -e ./extensions/pi/index.ts
```

## Configuration

All knobs live under the `pi` namespace in `.mulch/mulch.config.yaml` so they share file locking, atomic writes, and schema validation with the rest of mulch. Defaults shown:

```yaml
pi:
  auto_prime: true            # session_start prime + systemPrompt injection
  scope_load:
    enabled: true             # fire `ml prime --files` on tool_call file events
    budget: 2000              # tokens per scope-load call
    debounce_ms: 500          # coalesce rapid events per file
  tools: true                 # register record_expertise / query_expertise tools
  commands: true              # register /ml:prime
  agent_end_widget: true      # show `ml learn` nudge widget on agent_end
```

Config is re-read on every hook / tool invocation, so edits take effect without restarting the pi session.

## Commands

| Command | Description |
|---------|-------------|
| `/ml:prime [domain]` | Re-runs `ml prime` (optionally scoped to one domain) and steers the result back into the conversation. Argument autocompletes to declared domains in `mulch.config.yaml`. |

## Tools

Both tools shell out to `ml` and return JSON on the happy path so the model can parse outcomes deterministically. The TypeRegistry is hydrated from `mulch.config.yaml` on every call, so freshly-declared `custom_types` and `domains.*.allowed_types` are reflected without restart.

### `record_expertise`

Structured wrapper around `ml record <domain> --batch <tmp> --json`. The parameter schema is permissive (`fields` is a free-form bag) but the tool description is composed dynamically from the in-process registry, so the LLM sees accurate per-type required-field lists and per-domain `allowed_types` / `required_fields` for *this project's* config — including custom types like `release_decision` or `flake_symptom`.

Validation gates that fail without shelling out:

- Unknown record type → error citing the registered types.
- Type not in `domains.<name>.allowed_types` → error citing the allowed list.
- Missing type-required fields (e.g. `pattern` without `name`) → error naming the missing fields.
- Missing `domains.<name>.required_fields` (e.g. `evidence` on the `ecosystem` domain) → error pointing the LLM at `fields` / `evidence`.

Pass `dry_run: true` to preview validation without writing.

### `query_expertise`

Wraps `ml search` and `ml prime` (full + `--files` variants) behind one tool so the LLM stops escaping into bash for what should be a single call. Mode is inferred from the parameters:

| Parameters | Underlying call |
|------------|-----------------|
| `files: [...]` | `ml prime --files <paths> --json` (ignores `query`) |
| `query: "..."` | `ml search <query> --json` (with optional `domain` / `type` / `tag` / `archived` filters) |
| `domain: "..."` | `ml prime <domain> --json` |
| (none) | `ml prime --json` |

`limit` maps to `--budget` for the prime variants. Returns the raw JSON stdout in the message body and a small `{ mode, args, exitCode, bytes }` block in `details` for telemetry.

## Peer dependencies

`@earendil-works/pi-coding-agent` and `typebox` are declared as **optional** peer dependencies. Pi resolves them when it loads this extension; CLI-only users (`npm install -g @os-eco/mulch-cli`) see no peer-dep warnings and carry no runtime cost.
