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
Status: [shipped]
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
strips broken dir anchors. Type inheritance shipped (mulch-4d6d): custom types may declare
`extends: <builtin>` to inherit required/optional/dedup_key/id_key/summary/compact/section_title/
extracts_files/files_field; child overrides only what differs and arrays merge as a union;
custom-from-custom and `extends`-ing a disabled type are hard errors.
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
  types' AJV schemas reject unknown properties. Tracked in mulch-cc51. With `extends:` shipped
  (mulch-4d6d), the workaround is to declare `extends: <builtin>` plus the additional required
  fields — the merged AJV schema then accepts both the parent's and the child's properties.
- Removal syntax for `extends:` (e.g. `removed_fields: [date]`) deferred until a real use case
  surfaces; v1 only supports additive merges.

**Known follow-up bugs.**
- mulch-cc51 — built-in types reject unknown CLI fields (per above).
- mulch-7ac8 — `ml doctor` domain-rule check counts violations as records (cosmetic miscount).
- mulch-2da1 — custom-type `summary` template: init-config example uses Mustache `{{}}` but
  engine only supports `{}`, and unknown-field tokens render as literal `{}` silently.

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
Status: [shipped]
Shipped: provider recipe discovery (mulch-6deb, 2026-05-06). `ml setup <name>` resolves recipes
via discovery instead of a closed `Record<Provider, ProviderRecipe>`. Resolution order:
filesystem (`.mulch/recipes/<name>.{ts,sh}`) → npm (`mulch-recipe-<name>`) → built-in;
filesystem wins so orgs can override built-ins. TypeScript recipes are loaded directly by Bun
(default export validated against `ProviderRecipe`); shell recipes are invoked as
`<script> install|check|remove` with `MULCH_RECIPE_NAME` / `MULCH_RECIPE_ACTION` in env;
npm recipes resolve via `require.resolve('mulch-recipe-<name>')` from the project root.
`ml setup --list` (and `--list --json`) surfaces every discovered provider with its source and
flags built-ins shadowed by a same-named filesystem recipe. Unknown-provider error now points
at `--list`, `.mulch/recipes/<name>.{ts,sh}`, and `mulch-recipe-<name>`. Examples in
`examples/recipes/{internal-ide.ts,legacy-bot.sh}`.
Depends on: R-02 (recipe = structured post-init hook)
Unlocks: org-internal IDE / bot integrations without forking

**Problem.** `src/commands/setup.ts` was a closed `Record<Provider, ProviderRecipe>`. Adding a
7th provider (internal IDE, custom Slack bot, internal CI) required forking mulch.

**Sketch.** Two discovery mechanisms (shipped):
1. **Filesystem convention** (primary for org use): `.mulch/recipes/<name>.{ts,sh}` auto-discovered.
   Shell recipes get `install|check|remove` as argv.
2. **npm convention** (for shareable): `mulch-recipe-<name>` exports a `ProviderRecipe`.

Follow-up (separate seed, not yet filed): move the official 6 recipes out of `setup.ts` into
shipped recipe files, leaving `setup.ts` as just the loader + lifecycle.

**Open questions.**
- Sandboxing for arbitrary shell recipes — same trust model as R-02 (no sandbox; users own
  what they install). Locked: matches R-02's hook trust model.
- Recipe versioning — npm recipes carry their own semver via package.json; filesystem recipes
  pin to whatever's at the path. No central registry.

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
- **R-05e — Supersession decay.** ✅ Shipped (mulch-4426). When live record B carries
  `supersedes: [A]`, `ml prune` walks A one tier down the ladder
  (`foundational → tactical → observational → archived`) and stamps
  `supersession_demoted_at`. Cross-domain supersession honored. `--aggressive` collapses
  straight to archived in one pass; `--hard` hard-deletes the bottomed-out record.
  Staleness still wins over supersession when both apply.
- **R-05f — Anchor-validity decay.** ✅ Shipped (mulch-2551). `ml prune --check-anchors`
  walks records whose `files[]` / `dir_anchors[]` / `evidence.file` anchors no longer resolve
  one tier down the ladder (`foundational → tactical → observational → archived`) when
  `valid_fraction` falls below the configured threshold and the record is older than
  `grace_days`. Stamps `anchor_decay_demoted_at` on each demotion. Zero-anchor records are
  exempt. Staleness still wins over anchor decay. `--explain` prints per-record breakdowns
  (broken anchors + tier transition). Knobs live under `decay.anchor_validity` in
  `mulch.config.yaml` (defaults: `threshold: 0.5`, `grace_days: 7`).
- **R-05g — Continuous fitness formula.** The unifying mechanism above. Weights in
  `mulch.config.yaml`, `ml fitness <id>` for transparency, `ml prune --explain` for debugging.
  Tracked as mulch-9047. Targeted for **v1.0**: the formula needs the v0.11 schema additions
  (`recorded_by`, `freshness_score`, the auto-emitted outcomes from R-11) to feed real signal
  into `w_conf` and `w_use`. Shipping it earlier means publishing weights against thin data.

### Curation surface evolution (v0.10 → v0.11 → v1.0)

The R-05 sub-items above describe the *signals* prune consumes. The *user-facing surface* of
prune (and its sibling commands archive/compact/curate) evolves on a parallel three-release
arc, captured here so the seeds tracking each slice stay anchored in the roadmap:

- **v0.10 (in flight, mulch-105d / pl-0752 rev 2).** The curation primitives land:
  - `archive_reason` field on archived records (mulch-b41a) — auditable archival metadata
    (`stale | superseded | anchor_decay | manual | compacted`). Lives only on
    `.mulch/archive/<domain>.jsonl` rows; live `BaseRecord` envelope unchanged so the v1.0
    freeze constraint holds.
  - `ml archive <domain> <id|--records> --reason "..."` (mulch-d563) — direct archive without
    waiting for prune to mark a record stale. Symmetric to `ml restore`.
  - `ml prune --dry-run` granular default summary (mulch-5ce3) — per-record IDs + reasons +
    tier transitions print by default; `--explain` keeps its current responsibility (anchor
    breakdown). Inverts today's safety contract (default output should *show* what changes,
    not hide it behind a flag).
  - `ml compact` overhaul (mulch-184b) — archive originals to `.mulch/archive/` with
    `archive_reason: "compacted"` instead of silently dropping them, plus a new `pre-compact`
    lifecycle hook that may return a summarized replacement body (provider-neutral; no LLM
    bundled in mulch core). Mechanical merge stays as the back-compat fallback.
- **v0.11.** Curation surfaces compose into:
  - `ml curate` (mulch-7303) — interactive cluster view: dedup-key collisions, anchor-overlap
    clusters, type+domain bloat above `governance.warn_entries`, optional semantic clusters
    (subsumes mulch-e2bd's TF-IDF / trigram-overlap stub). `--apply <cluster-id>` executes
    the recommendation against the v0.10 archive/compact primitives.
  - `ml prune --auto-archive` cadence (V1_PLAN §4.4) — wired into `ml prime --maybe-prune`
    via a `.mulch/.last-prune` stamp file so cleanup happens reliably without depending on
    agent discipline.
- **v1.0.** R-05g (mulch-9047) lands. Prune's binary keep-or-delete becomes a fitness-driven
  surface backed by the v0.11 schema additions. `ml fitness <id>` exposes the per-axis
  breakdown. Prune at this point is no longer "this is 30 days old, archive it" — it surfaces
  the high-leverage cleanup decisions a curator would make, then archives or hard-deletes
  accordingly. The other curation commands (archive / compact / curate) still exist; prune
  becomes the autonomous loop, the others become the manual-override toolkit.

The throughline: every release adds *one* thing prune knows, and every release adds *one*
manual-override surface so curators stay in the loop while the autonomous behavior matures.

**Open questions.**
- Default fitness weights per record type? Foundational records probably weight `confirmation`
  and `supersede` higher than `age`.
- Is archive timestamped per-archival or does the live record carry an `archived_at` and live
  in the archive file? (Resolved as of R-05a: per-archival `archived_at`, supplemented by
  `archive_reason` in v0.10.)
- How are auto-emitted outcomes (R-11) discounted in `confirmation_signal`?

---

## R-06 — Ownership & review workflow
Status: [proposed] — seeded as mulch-7233 (plan pl-e01a, 5 child steps)
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
Status: [proposed] — seeded as mulch-8e40
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
- **R-01 — `extends: <builtin>` inheritance (mulch-4d6d, 2026-05-06).** Closes R-01. Custom
  types may declare `extends: <builtin>` to inherit required/optional/dedup_key/id_key/summary/
  compact/section_title/extracts_files/files_field; child overrides only what differs and
  arrays merge as a union. Custom-from-custom and `extends`-ing a disabled type are hard
  errors.
- **R-07 partial — Output knobs.** Global `--format` flag (v0.7.0); `prime --manifest` mode +
  `prime.default_mode: manifest` config default (v0.7.0). Provider-neutral adapters
  (json/text/slack) still open.
- **R-05a — Soft archive on prune (mulch-7876, 2026-05-06).** `ml prune` defaults to moving
  stale records into `.mulch/archive/<domain>.jsonl` with `status: "archived"` +
  `archived_at`; `--hard` opts back into deletion. `ml restore <id>` round-trips. Search
  excludes archives unless `--archived` is passed.
- **R-05e — Supersession-based auto-demotion (mulch-4426, 2026-05-06).** `ml prune` walks
  any record whose id appears in another live record's `supersedes` array down the
  classification ladder, one tier per pass, stamping `supersession_demoted_at`. Bottomed-out
  records archive (or hard-delete with `--hard`). `--aggressive` collapses fully in one
  pass. Cross-domain by design.
- **R-05f — Anchor-validity decay (mulch-2551, 2026-05-06).** `ml prune --check-anchors`
  demotes records whose `files[]` / `dir_anchors[]` / `evidence.file` no longer resolve.
  Each demotion stamps `anchor_decay_demoted_at`. Zero-anchor records exempt; staleness
  wins on overlap; supersession + anchor decay co-stamp but only demote one tier per pass.
  `--explain` prints broken-anchor breakdowns. Knobs in `decay.anchor_validity`.
- **R-04 — Provider plugin registry (mulch-6deb, 2026-05-06).** `ml setup <name>` resolves
  via discovery (filesystem → npm → built-in). `.mulch/recipes/<name>.{ts,sh}` auto-discovered;
  `mulch-recipe-<name>` resolved via `require.resolve` from project root. `ml setup --list`
  surfaces sources and shadowed built-ins. Examples shipped in `examples/recipes/`.
- **R-01 follow-ups closed (2026-05-06).** mulch-cc51 (per-domain `required_fields`
  incompatibility now surfaces clearly via new `domain-rules-compatibility` doctor check + a
  targeted runtime hint on AJV failure; workaround is `extends: <builtin>` plus the additional
  required fields). mulch-7ac8 (`ml doctor` domain-rule check now counts records, not
  violation messages, in the summary). mulch-2da1 (custom-type summary templates now accept
  Mustache-style `{{field}}` identically to `{field}`; unknown tokens are rejected at registry
  load with a precise error naming the bad token and listing legal ones).

**Off-roadmap: read-only score-surface tooling.**
- **`ml rank` (mulch-cky, 2026-05-06).** `ml rank [domain]` returns records sorted by
  confirmation score (highest first), distinct from `search --sort-by-score` in that no text
  query is required and the output is a flat cross-domain stream rather than per-domain
  groups. Filters `--type`, `--limit` (default 10), `--min-score` (default 0); `--json`
  emits structured rows. Useful precursor to R-11 (auto-confirmations) — once auto-emission
  lands, this command becomes the obvious "top-N battle-tested records" surface for
  context-constrained consumers.

Open seeds tracking remaining roadmap work:
- mulch-7233 (R-06 — ownership & review workflow; plan pl-e01a, 5 child steps)
- mulch-8e40 (R-10 — secret-scanning recipe)
- mulch-1d5b (R-09 — multi-repo federation)

## Suggested sequencing

A first cut at order of attack — not committed:

1. ~~**R-01** (custom record types)~~ — shipped via epic mulch-632e (v0.8.0). Per-domain
   `allowed_types`/`required_fields` shipped (mulch-3114). `dir_anchors[]` shipped
   (mulch-476b). `extends: <builtin>` inheritance shipped (mulch-4d6d). R-01 fully closed.
2. ~~**R-02** (lifecycle hooks)~~ — shipped (mulch-55b1, 2026-05-05). The customization
   primitive everything else leans on.
3. ~~**R-05a + R-05e** (soft archive + supersession decay)~~ — both shipped (mulch-7876,
   mulch-4426; 2026-05-06).
4. ~~**R-05f** (anchor-validity decay)~~ — shipped (mulch-2551, 2026-05-06). Small follow-up
   to `dir_anchors[]`; emits the `w_anchor` signal that R-05g will blend.
5. ~~**R-04** (provider plugins)~~ — shipped (mulch-6deb, 2026-05-06).
6. **R-06** (ownership) — needed before R-12 can route resolution. **Next.**
7. **R-03** (Claude hook namespace + profiles) — leverages R-02; unlocks R-05c, R-11.
8. **R-11 + R-05d** (auto-confirmations + confirmation decay) — paired; ship together.
9. **R-05g** (fitness formula) — once R-05c/d/e/f are emitting signal, unify them.
10. **R-12** (contradiction detection, cheap version) — needs R-06 for routing.
11. **R-10** (secret scanning) — a default recipe; any time after R-02.
12. **R-09** (federation) — defer, but draft contract early. Tracked in mulch-1d5b.
13. **R-08** (observability) — separate sibling tool.
