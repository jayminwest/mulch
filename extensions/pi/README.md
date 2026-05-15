# @os-eco/pi-mulch

Pi-coding-agent extension that hard-wires mulch's `prime` / `record` rituals into pi lifecycle events. Ships inside `@os-eco/mulch-cli`; the pi manifest entry in `package.json` points pi at `extensions/pi/index.ts`.

## Status

**Foundation only** — this is the v0.1 skeleton (seeds `mulch-be45`). The lifecycle hooks are wired but inert until subsequent plan steps land:

| Step | Seed | Capability |
|------|------|------------|
| 2 | `mulch-7359` | Auto-prime on `session_start`, inject via `before_agent_start` |
| 3 | `mulch-71cf` | Per-file scope-load on `tool_call`, debounced + persisted |
| 4 | `mulch-4d87` | `record_expertise` / `query_expertise` custom tools |
| 5 | `mulch-903f` | `/ml:*` slash commands + `ml learn` widget on `agent_end` |
| 6 | `mulch-d060` | ✅ `ml setup pi` recipe + pi-aware onboarding marker |
| 7 | `mulch-7229` | Tests + this README rewrite |

## Install

The canonical install path:

```bash
ml setup pi              # writes .pi/settings.json + updates CLAUDE.md marker
ml setup pi --check      # verify install state
ml setup pi --remove     # uninstall both legs
```

`ml setup pi` adds `"@os-eco/mulch-cli"` to `.pi/settings.json`'s `packages` array (preserving any existing entries) and refreshes the `<!-- mulch:start -->`-fenced section of `CLAUDE.md` / `AGENTS.md` to the short pi-aware variant. The marker carries a `:pi` suffix so onboarding detection knows the extension is active.

For in-tree development without going through the setup recipe, load it directly with:

```bash
pi -e ./extensions/pi/index.ts
```

## Configuration

All knobs live under the `pi` namespace in `.mulch/mulch.config.yaml` so they share file locking, atomic writes, and schema validation with the rest of mulch:

```yaml
pi:
  auto_prime: true            # session_start prime + systemPrompt injection
  scope_load:
    enabled: true             # fire `ml prime --files` on tool_call file events
    budget: 2000              # tokens per scope-load call
    debounce_ms: 500          # coalesce rapid events per file
  tools: true                 # register record_expertise / query_expertise tools
  commands: true              # register /ml:prime, /ml:status, /ml:doctor
  agent_end_widget: true      # show `ml learn` nudge widget on agent_end
```

Run `ml config schema` to emit the full JSON Schema (the `pi` block is part of it). Run `ml config set pi.<key> <value>` to edit safely under file lock.

## Peer dependencies

`@earendil-works/pi-coding-agent` and `typebox` are declared as **optional** peer dependencies. Pi resolves them when it loads this extension; CLI-only users (`npm install -g @os-eco/mulch-cli`) see no peer-dep warnings and carry no runtime cost.
