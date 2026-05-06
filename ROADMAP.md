# Mulch Roadmap

Direction for mulch as it scales from solo / small-team use to engineering orgs of 50+ ICs.
Each item is a self-contained idea with a stable ID for reference. Items can be sequenced
independently; the dependency graph is captured per-item.

This file is the punch list, not the spec. Items here become seeds issues when committed to.

## Status legend

- `[proposed]` — under discussion, not committed
- `[in-progress]` — actively being built
- `[partially shipped]` — some sub-items released, others still open
- `[shipped]` — released
- `[deferred]` — useful but not now

## Item template

New items follow this shape so the format doesn't drift:

    ## R-NN — Title
    Status: [proposed]
    Depends on: —
    Unlocks: —

    **Problem.** One paragraph: what breaks today, especially at 50+ IC scale.

    **Sketch.** Short description or config/code example of the proposed shape. Not a spec.

    **Open questions.** Bullets — things to decide before or during implementation.

---

## R-01 — Custom record types & per-domain schemas
Status: [partially shipped]
Shipped: custom types via `custom_types:` in config (epic mulch-632e, phases mulch-2e68 →
mulch-c7f3 → mulch-365e). Type registry behind `TypeDefinition`, generic AJV factory, disable
list with deprecation warning, unknown-type policy with `--allow-unknown-types` escape hatch,
field aliases for schema evolution, `ml doctor` `type-registry` + `unknown-types` checks.
Per-domain rules also shipped (mulch-68ba → mulch-0b87 → mulch-4630 → mulch-3114): `domains`
config reshaped to `Record<string, DomainConfig>`, `allowed_types` and `required_fields` gates
on record writes, and `ml doctor` / `ml sync` re-validate on-disk records against domain rules.
`dir_anchors[]` shipped as a built-in field on every record (mulch-476b): `--dir-anchor <path>`
on `ml record`, auto-population from common parent of 3+ changed files, `ml prime --files`
matches by directory membership in addition to file anchors, and `ml doctor` flags + `--fix`
strips broken dir anchors.
Open: `extends: <builtin>` inheritance (mulch-4d6d).
Depends on: —
Unlocks: R-05f (anchor decay weighting now that dir anchors exist), R-09 (schema portability across imports)

**Problem.** The 6 hard-coded record types in `src/schemas/record.ts` were a fork-the-tool
ceiling. Big orgs need types like `runbook`, `adr`, `slo-incident`, and per-domain required
fields (e.g., backend domain requires `oncall_owner`).

**Sketch.** Config-declared custom types (shipped) extend the registry; per-domain
`allowed_types` and `required_fields` (shipped) gate which types apply where. Stock agents
fall back to the base type's semantics for unknown custom types so the corpus stays portable.

    custom_types:                       # shipped
      adr:
        required: [decision_status, deciders]
        dedup_key: content_hash
        summary: "{decision_status}: {description}"
        compact: keep_latest
    domains:                            # shipped
      backend:
        allowed_types: [convention, pattern, adr]
        required_fields: [oncall_owner]

**Open questions.**
- Extra-field serialization landed inline (no `extra: {}` envelope). Per-domain
  `required_fields` works only when the field is declared on a `custom_types` entry — built-in
  types' AJV schemas reject unknown properties. Tracked in mulch-cc51 (and overlaps mulch-4d6d
  if `extends:` lets built-ins inherit + extend).

---

## R-02 — Mulch lifecycle hooks
Status: [shipped]
Shipped: lifecycle hooks for `pre-record` / `post-record` / `pre-prime` / `post-prime` /
`pre-prune` / `post-prune` (mulch-55b1). Declared in `mulch.config.yaml` under `hooks:`,
executed as shell commands receiving JSON payload on stdin. Hooks compose (array order),
non-zero exit from a `pre-*` hook blocks the action with a stderr surfaced error, and `pre-*`
hooks may mutate the payload by printing modified JSON on stdout. `hook_settings.timeout_ms`
controls per-hook execution timeout (default 5000).
Depends on: —
Unlocks: R-04, R-10, R-11; underlies most customization at enterprise scale

**Problem.** Every customization request today requires patching mulch core. There's no escape
hatch for org-specific behavior (secret scanning, Slack notifications, owner enforcement,
team-scoped filters, etc.).

**Sketch.** A small event system inside mulch — `pre-record`, `post-record`, `pre-prime`,
`post-prime`, `pre-prune`, `post-prune` — declared in `mulch.config.yaml`, executed as shell
commands. Mulch invokes each script with the relevant payload as JSON on stdin. Exit non-zero
to block. Print modified JSON on stdout to mutate.

    hooks:
      pre-record:    [./scripts/scan-secrets.sh, ./scripts/require-owner.sh]
      post-record:   [./scripts/post-to-slack.sh]
      pre-prime:     [./scripts/filter-by-team.sh]
      pre-prune:     [./scripts/digest-then-confirm.sh]

**Open questions.**
- `pre-validate` event was scoped out of v1 — re-evaluate if a clear use case appears.
- Do hooks fire on imported records (R-09)? Locked decision: no — only consumer hooks run.

---

## R-03 — `mulch hook` command namespace + Claude profiles
Status: [proposed]
Depends on: R-02 (mechanically independent, but conceptually paired)
Unlocks: R-05c (usage decay becomes free), R-11 (auto-confirmations)

**Problem.** Today only `ml prime` is wired into Claude (`SessionStart` and `PreCompact`).
Claude Code has many more hook events that mulch could exploit for just-in-time context and
post-hoc capture.

**Sketch.** A namespace of subcommands designed to be wired into Claude hooks:
`ml hook on-prompt`, `ml hook pre-edit <file>`, `ml hook post-edit <file>`, `ml hook pre-stop`,
`ml hook on-tool-result`. `mulch setup claude --profile <light|standard|aggressive>` installs
the right matrix into `.claude/settings.json`. Profile definitions live in `mulch.config.yaml`
so orgs can declare their own.

Override layer for Claude's memory: ship CLAUDE.md guidance establishing a two-tier model —
project knowledge → mulch; user preferences → Claude memory. **Prescription, not interception**:
no hijacking of Claude's memory writes in v1.

**Open questions.**
- Which hooks are in `light` vs `standard` vs `aggressive` defaults?
- How does `pre-stop` block-or-nudge interact with users who want fast iteration?
- Does the override guidance live in mulch's CLAUDE.md snippet or in a separate doc?

---

## R-04 — Provider plugin registry
Status: [proposed]
Depends on: R-02 (recipe = structured post-init hook)
Unlocks: org-internal IDE / bot integrations without forking

**Problem.** `src/commands/setup.ts:621` is a closed `Record<Provider, ProviderRecipe>`. Adding
a 7th provider (internal IDE, custom Slack bot, internal CI) requires forking mulch.

**Sketch.** Two discovery mechanisms:
1. **Filesystem convention** (primary for org use): `.mulch/recipes/<name>.{ts,sh}` auto-discovered.
   Shell recipes get `install|check|remove` as argv.
2. **npm convention** (for shareable): `mulch-recipe-<name>` exports a `ProviderRecipe`.

Eventually the official 6 recipes move out of core into shipped recipe files.

**Open questions.**
- Sandboxing for arbitrary shell recipes — same trust model as R-02?
- Do recipes get versioned, or always pulled from `main`?

---

## R-05 — Decay / curation overhaul
Status: [proposed] (overall); sub-items track independently
Depends on: R-02 (for some sub-items), R-11 (for 5d)
Unlocks: R-08 (observability), R-09 (federated decay coherence)

**Problem.** Current `prune.ts` is binary keep-or-delete by classification + age. Foundational
records that became obsolete stick forever; tactical records that are still hot get nuked at
day 15. Ignores `outcomes`, `relates_to`, `supersedes`, file anchors — every other signal we
already collect.

**Sketch.** Move from binary delete to a continuous fitness formula with config-tunable weights.
Soft archive by default; hard delete via `--hard`.

    fitness = w_age * exp(-age_days / shelf_life)
            + w_conf * confirmation_signal
            + w_use * exp(-days_since_used / 30)
            + w_anchor * fraction_anchors_valid
            + w_supersede * (0 if superseded else 1)
            + w_owner * (1 if owner set else 0)

Archive below 0.3, delete below 0.05. `ml fitness <id>` shows per-axis breakdown.

### Sub-items

- **R-05a — Soft archive instead of hard delete.** Default behavior. Archives live in
  `.mulch/archive/<domain>.jsonl`, excluded from prime/search by default. Mitigations against
  agents grepping stale records: separate path, banner records at file top, `status: archived`
  field, CLAUDE.md guidance not to read archive directly. **Ship first.**
- **R-05b — Tiered demotion.** `foundational → tactical → observational → archived → deleted`,
  each step independent. Single bad classification at write-time becomes recoverable.
- **R-05c — Usage-based decay.** `last_used_at` updated on prime/search emission. Defer until
  R-03 lands — at that point usage tracking is a free side-effect of hook-driven retrieval.
  Without R-03, write-on-read causes lock contention at 50 ICs.
- **R-05d — Confirmation-based decay.** Records with positive outcomes survive; silence
  demotes. Already half-built in `scoring.ts`. Defer until R-11 makes confirmations
  load-bearing — without auto-emission, this punishes good-but-unmarked records.
- **R-05e — Supersession decay.** When B has `supersedes: [A]`, A auto-demotes one tier.
  **Cheapest "smart" decay; ship early.**
- **R-05f — Anchor-validity decay.** Records whose file anchors have been deleted past a
  threshold auto-demote (rather than `ml doctor --fix` silently stripping). `dir_anchors[]`
  shipped under R-01 (mulch-476b) so records can attach to a directory and stay valid as files
  within it shuffle — this remaining piece is just the decay weighting.
- **R-05g — Continuous fitness formula.** The unifying mechanism above. Weights in
  `mulch.config.yaml`, `ml fitness <id>` for transparency, `ml prune --explain` for debugging.

**Open questions.**
- Default fitness weights per record type? Foundational records probably weight `confirmation`
  and `supersede` higher than `age`.
- Is archive timestamped per-archival or does the live record carry an `archived_at` and live
  in the archive file?
- How are auto-emitted outcomes (R-11) discounted in `confirmation_signal`?

---

## R-06 — Ownership & review workflow
Status: [proposed]
Depends on: R-01 (owner as required field per-domain)
Unlocks: scalable curation; CODEOWNERS-driven defaults

**Problem.** Records are anonymous beyond the git commit author. At 50 ICs, contradiction
without ownership is unfixable — there's no one to ping when records conflict or go stale.

**Sketch.** Owner resolution chain:
1. Explicit `--owner @foo` flag → wins
2. CODEOWNERS lookup on the record's `file_anchors` → next
3. Per-domain `default_owner` in `mulch.config.yaml` → next
4. Git author of the recording commit → fallback

Plus: `status: draft | active | deprecated`, `ml review` listing records owned by `$USER`
needing attention, optional `require_owner: true` to block unowned records.

**Open questions.**
- How are team handles (`@security-team`) resolved? Just strings, or validated against
  CODEOWNERS / org membership?
- Does ownership transfer when a file moves? Probably yes via CODEOWNERS recompute.

---

## R-07 — Custom prime templates / output adapters
Status: [partially shipped]
Shipped: global `--format` flag on record output (v0.7.0); `prime --manifest` mode + config
default `prime.default_mode: manifest` for monolith projects (v0.7.0).
Open: provider-neutral output adapters (json/text/slack), plus the R-02 hook surface for
config-declared custom adapters.
Depends on: R-02 (custom adapters as hooks)
Unlocks: provider-neutral consumption; tool-use API integration

**Problem.** `prime` emits one fixed markdown shape. Different consumers want different framing
(JSON for tool-use APIs, plain text for IDE inline, Slack for digest channels).

**Sketch.** First-class `--format markdown|json|text|slack` (markdown shipped; manifest mode
covers the monolith case; json/text/slack still open), plus a hook in R-02 so custom adapters
can be declared in config without touching core.

**Open questions.**
- Stable JSON schema for the tool-use format — versioned?
- Default format stays markdown; should `--format` be configurable as a default in yaml?
  (`prime.default_mode` precedent exists for manifest.)

---

## R-08 — Observability (likely separate tool)
Status: [deferred]
Depends on: R-05 (decay decisions shape what's worth measuring), R-06 (owners for stat slicing)

**Problem.** Leadership at 50+ IC orgs will ask: is this being used? By whom? What records get
pulled? Are there contradictions? Today the data exists in JSONL but nothing surfaces it.

**Sketch.** A sibling tool (not part of mulch core) that reads `.mulch/` and emits JSON
suitable for any dashboard system. Mulch core stays passive.

**Open questions.**
- Sibling tool inside this repo, separate package, or different repo entirely?
- How is "usage" tracked given R-05c's lock concerns? Probably from the same hook-driven
  emission path R-03 introduces.

---

## R-09 — Multi-repo federation
Status: [deferred] — but contract should be sketched early so R-01, R-02, R-08 stay compatible
Depends on: R-01 (schema portability), R-05 (decay coherence across sources)
Unlocks: monorepo-vs-microservices unification for knowledge

**Problem.** 50-IC orgs have 10+ repos. Shared expertise (auth, deployment, observability)
should be authored once and consumed everywhere. Today only achievable via git submodule
(painful) or copy-paste (worse).

**Sketch.**

    imports:
      - source: github:acme/platform-mulch@v1.4.0     # pinned
        domains: [observability, deployment, auth]
      - source: file:../shared-mulch                  # local in monorepo
        domains: [security]

Resolution rules:
- **Read-only.** Imported records can't be edited; supersede locally to override.
- **Namespaced.** Imported IDs prefix with source name (`acme:mx-abc123`).
- **Local > imported** on conflict.
- **Cached** under `.mulch/.cache/imports/<source>/`. `ml sync --pull` refreshes.
- **Trust boundary.** Producer's hooks do not fire on consumer side — only the consumer's
  hooks fire on imported content.

**Open questions.**
- Pin model: commit SHA, tag, or `latest` with TTL?
- Schema compatibility: imported repo declares its custom types in its own config and consumer
  pulls schema along with records?
- Search ranking: imported records lower-ranked by default? Configurable.
- ID collision between two import sources?

---

## R-10 — Secret / PII scanning at record time
Status: [proposed]
Depends on: R-02 (lands as a `pre-record` hook)
Unlocks: low-priority — guardrail, not a core feature

**Problem.** A record like "the staging API key is `sk-...`" gets committed to git forever.
At 50 ICs this *will* happen.

**Sketch.** Falls out of R-02 — declare a `pre-record` hook running `gitleaks` or `trufflehog`
against the record body. Ship a default rule pack as a community recipe. Not in core.

**Open questions.**
- Ship the default rule pack as a `mulch-recipe-secrets` package?

---

## R-11 — Confirmation auto-emission
Status: [proposed]
Depends on: R-03 (hook surface), R-05d (consumer of the signal)
Unlocks: decay signal that actually reflects reality

**Problem.** The outcome flow exists in `outcome.ts` but is manual and undertapped, so the
confirmation boost in `scoring.ts` is mostly dormant. Decay can't be confirmation-driven if
nobody emits confirmations.

**Sketch.**

*Detecting "the agent used this record":*
- **Strong** — explicit citation. CLAUDE.md instructs the agent to mention `mx-abc123` IDs
  when applying records. PostToolUse hook greps recent text for IDs.
- **Weaker** — pattern match. If a record says "use lib X" and Write installs lib X, infer use.

*Detecting "success / failure":*
- `ml hook on-test-pass/fail` from PostToolUse Bash → emit success / failure for cited records
- `ml hook pre-stop` → if no errors fired and agent stopped naturally → tentative success
- Async signals (PR merge → success, revert → failure) via separate webhook listener
- `git revert` of a commit citing record X → automatic failure (gold signal)

*Quality controls:*
- Auto-outcomes carry `source: auto`; weighted lower than human ones in R-05g
- Citation only counts if the same tool turn touched a record's `file_anchors` /
  `dir_anchors` (anti-gaming)
- Cap citations per turn (≤3 per file change)

**Open questions.**
- Does "tentative success" on `pre-stop` get its own outcome status (e.g. `partial`) or just
  a discounted `success`?
- Webhook listener for async signals — separate sibling service, or piggyback on a CI step?
- `mulch outcome --auto-from-git <range>` as a manual fallback for orgs not running hooks?

---

## R-12 — Contradiction detection
Status: [proposed]
Depends on: R-06 (need owner to route the resolution)
Unlocks: corpus integrity at scale

**Problem.** A record says "use lib X for HTTP"; a newer one says "use lib Y." At 50 ICs this
happens weekly and is invisible until an agent surfaces both.

**Sketch.** Cheap version: warn at `ml record` time when a new record's `description` overlaps
highly (BM25) with an existing one of the same type+domain. Block / require explicit `supersedes:`
or `--allow-conflict`. Expensive version: embeddings. **Ship cheap first.**

**Open questions.**
- BM25 overlap threshold — empirical tuning needed.
- Does contradiction detection run on `pre-record` (block) or `post-record` (warn-and-flag)?

---

## Decisions already made

Choices locked in during the planning conversation. Captured here so they aren't relitigated
when items become seeds issues.

- **Stay org-focused; no `~/.mulch/` user-level dir.** Per-user state lives in Claude memory or
  shell config; mulch is git-committed org/project state.
- **Prescription, not interception, for Claude memory override (R-03).** Provide CLAUDE.md
  guidance about which layer to use for what. Do not hijack Claude's internal memory writes.
- **Soft archive is the default for prune (R-05a).** Hard delete only via `--hard`.
- **Auto-emitted outcomes are weighted lower than human ones (R-11).** They include
  `source: auto` so the fitness formula in R-05g can downweight them.
- **Imports are read-only and namespaced (R-09).** No editing imported records; supersede
  locally to override.
- **Output adapters stay provider-neutral (R-07).** No hard-coded adapters for specific
  downstream tools.
- **JSONL-in-git is non-negotiable.** Every item assumes the storage substrate stays.

## Cross-cutting themes

Threads that run through multiple items.

- **Customizability via R-02.** Lifecycle hooks are the unifying primitive. Every other item
  should ask first whether its customization can land as a hook config rather than core code.
- **Curation at scale (R-05, R-06, R-11, R-12).** No single item solves curation; it's the
  intersection of decay, ownership, confirmation, and contradiction detection. Sequence them
  so each one's signal is real before the next consumes it.
- **Federation shapes early decisions (R-09).** Even though deferred, the import contract
  should be sketched soon so R-01, R-02, and R-08 make federation-compatible choices.

## Recently shipped

Cross-references to closed work that maps onto roadmap items. Tracked here so subsequent
revisions know what's already off the punch list.

- **R-02 — Lifecycle hooks (mulch-55b1, 2026-05-05).** `pre-record` / `post-record` /
  `pre-prime` / `post-prime` / `pre-prune` / `post-prune` events; chained scripts, JSON payload
  on stdin, mutate via stdout, block via non-zero exit, configurable timeout via
  `hook_settings.timeout_ms`.
- **R-01 — Per-domain rules (mulch-68ba → mulch-0b87 → mulch-4630 → mulch-3114, 2026-05-06).**
  `domains` config reshaped from `string[]` to `Record<string, DomainConfig>`; per-domain
  `allowed_types` and `required_fields` enforced at record-write time; `ml doctor` and
  `ml sync` re-validate on-disk records against domain rules.
- **R-01 — Custom record types (epic mulch-632e).** Phases 1-3 closed across v0.8.0
  (mulch-2e68, mulch-c7f3, mulch-365e). Type registry, custom types via config, disable list,
  unknown-type policy + `--allow-unknown-types`, field aliases, `ml doctor` registry checks.
- **R-01 — `dir_anchors[]` built-in field (mulch-476b, 2026-05-06).** Repeatable
  `--dir-anchor <path>` on `ml record`, auto-population from common parent of 3+ changed files,
  `ml prime --files` matches by directory membership, `ml doctor` flags broken dir anchors and
  `--fix` strips them.
  Remaining R-01 open items: `extends:` inheritance (mulch-4d6d).
- **R-07 partial — Output knobs.** Global `--format` flag (v0.7.0); `prime --manifest` mode +
  `prime.default_mode: manifest` config default (v0.7.0). Provider-neutral adapters
  (json/text/slack) still open.

Open seeds tracking remaining roadmap work: mulch-7876 (R-05a), mulch-4426 (R-05e),
mulch-4d6d (R-01 `extends:` inheritance), mulch-1d5b (R-09).

## Suggested sequencing

A first cut at order of attack — not committed:

1. ~~**R-01** (custom record types)~~ — shipped via epic mulch-632e (v0.8.0). Per-domain
   `allowed_types`/`required_fields` shipped (mulch-3114). `dir_anchors[]` shipped
   (mulch-476b). Remaining: `extends:` inheritance (mulch-4d6d).
2. ~~**R-02** (lifecycle hooks)~~ — shipped (mulch-55b1, 2026-05-05). The customization
   primitive everything else leans on.
3. **R-05a + R-05e** (soft archive + supersession decay) — small, safe, ship together.
   Tracked in mulch-7876, mulch-4426. **Next.**
4. **R-06** (ownership) — needed before R-12 can route resolution.
5. **R-03** (Claude hook namespace + profiles) — leverages R-02; unlocks R-05c, R-11.
6. **R-05f** (anchor-validity decay) — small follow-up now that `dir_anchors[]` has shipped.
7. **R-04** (provider plugins) — pure refactor of `setup.ts`; can happen any time.
8. **R-11 + R-05d** (auto-confirmations + confirmation decay) — paired; ship together.
9. **R-05g** (fitness formula) — once R-05c/d/e/f are emitting signal, unify them.
10. **R-12** (contradiction detection, cheap version) — needs R-06 for routing.
11. **R-10** (secret scanning) — a default recipe; any time after R-02.
12. **R-09** (federation) — defer, but draft contract early. Tracked in mulch-1d5b.
13. **R-08** (observability) — separate sibling tool.
