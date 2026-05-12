# Mulch v1.0.0 Plan

Opinionated recommendation document. Synthesizes the external 7-repo audit, the v1.0.0 framing the maintainer drafted, and a code-surface scout of the current Mulch CLI (`/Users/jayminwest/Projects/os-eco/mulch`).

## Section 1: What v1.0.0 has to mean

A 1.0 is not "we added more features" — it is "the schema is frozen, the protocol is sound, the failure modes are bounded, and downstream consumers can build on us without flinching." The audit told us where the failure modes are: write-side discipline collapses, stale records accumulate, cross-tool linkage drifts, and corpus quality decays on a 60–90 day half-life. A team of 50 ICs accelerates every one of those failure modes by ~50×.

**The v1.0.0 contract:** *your mulch corpus will not need a curator. It will tell you when it is unhealthy, refuse low-quality writes by default, archive its own dead records, and survive 50 people pushing to it for a year without rotting.*

The single structural insight underneath every recommendation below: **the cost of writing a record should be proportional to its claim on future agent attention.** Tactical observations stay one-line cheap. Foundational claims and conventions — the ones `ml prime` broadcasts into every future session — require evidence, attribution, and a justification. Every audit metric improves once that gradient is in place.

## Section 2: The v1.0.0 freeze

What 1.0 freezes (and therefore must be right before tagging):

- **Record envelope:** `id`, `type`, `recorded_at`, `recorded_by`, `evidence`, `relates_to`, `supersedes`, `classification`, `freshness_score`. Adding a field after 1.0 requires `ml migrate` for every consumer (warren, canopy, overstory, sapling).
- **The seven built-in types:** the existing six (`convention`, `pattern`, `failure`, `decision`, `reference`, `guide`) plus `note` (new in this plan, see §4.1). Custom types via config remain extensible; downstream tools that filter on built-ins must keep working forever.
- **LWW merge semantics:** already used by warren's `reap.ts:mulch_merge`. Stays.
- **JSONL on-disk shape with versioned migrations:** `ml migrate` for schema bumps, never silent rewrites.
- **Soft-archive contract:** `.mulch/archive/<domain>.jsonl` with `# ARCHIVED` banner, `status: "archived"`, `archived_at` stamp. `ml restore <id>` reverses.

What 1.0 deliberately does **not** freeze (and therefore can evolve post-1.0):

- Audit thresholds (config-driven from day one)
- Per-domain rules and required fields (already extensible)
- Provider recipes
- Hooks
- CLI flag surface beyond the documented stable subset

## Section 3: Rollout (v0.10 → v0.11 → v1.0.0)

Shipping everything in a single v1.0 release is wrong because two of the new concepts (`freshness_score` formula, `note` type semantics) need empirical calibration on real corpora before being baked into the freeze contract. A staged rollout buys two release cycles of feedback before the schema locks.

**v0.10 — Visibility + the prime overhaul (~3 weeks):** Ship `ml audit`, the age-aware `ml status` lines, the close-session prose reframe, **and the `ml prime` overhaul (§5.2)**. Schema unchanged. The prime overhaul is bundled here because it is the highest-leverage behavioral change in the whole plan and has no schema implications. Every team can see their floater %, evidence coverage, rotting domains, and convention bloat — and crucially, every agent's session opens with a corpus that *speaks to them* differently. This is the "we measured it and we fixed how the corpus presents itself" release.

**v0.11 — Schema additions, gates off (~6 weeks):** Add `recorded_by`, `freshness_score`, `note` type, the active-work resolver chain, `ml confirm` / `ml challenge` / `ml supersede` commands, `ml prune --auto-archive` mode, and write-side gates (`--because`, identifier-content rejector). All gates ship config-default off. Teams opt in. The schema additions are technically present but their contract is "may change in v1.0."

**v1.0.0 — Freeze + opinionated defaults (~10 weeks):** Lock the schema. Flip selected gates to default-on (rule-density check, evidence requirement for foundational, `--because` for conventions). Cut `ml migrate` for any v0.x corpus to upgrade. Tag.

## Section 4: The five v1.0.0 categories — verdicts

### 4.1 Structural write-side friction — SHIP, with one critical addition

The user's framing is correct: the write surface accepts shapeless conventions because nothing pushes back. Three components ship together:

- **`--because <rationale>` required for conventions** when `record.require_because: true` (off in v0.11, on in v1.0 default config). Wires into the existing pre-record hook surface (`src/commands/record.ts:1003-1037`).
- **Identifier-content rejector:** if `content` is >50% identifier-shaped tokens (`[A-Za-z_][\w./-]*`) and contains no rule-signal verb (audit's regex list: `because`, `must not`, `avoid`, `always`, `never`, etc.), refuse with "this looks like code restatement, did you mean `--type note`?" The retry hint must be copy-paste-able (existing pattern in record.ts).
- **Generic active-work auto-link** (see §4.5).

**The critical addition the original framing under-specified:** `note` is the relief valve, but it has a bypass risk. Agents will route around `--because` by switching `--type convention` to `--type note`. Mitigations:

1. `note` is excluded from `ml prime` default output. Agents only see notes via `ml prime --include-notes` or explicit `ml query`. This is the load-bearing rule — if notes pollute prime, the whole structural-friction story collapses.
2. `note` is excluded from `ml audit` rule-density and high-value calculations (it is correctly classified as scratch).
3. The retry hint that suggests `--type note` includes the line "notes are tactical and not surfaced in `ml prime` by default."
4. `note` cannot be classified as `foundational`. Schema rejects it.

With those four guards, `note` is a legitimate pressure valve. Without them, it is a write-quality bypass.

**Solo vs team:** Solo devs leave `record.require_because: false` and never see the gate. Teams flip it on per-domain via the existing `domains.<name>.required_fields: [because]` machinery in `src/utils/config.ts` — no new global flag.

**Effort: M.** Schema field, two pre-record validators, `note` type registration, prime/audit exclusion logic.

### 4.2 `ml audit` as a first-class CI surface — SHIP

Port `/tmp/mulch-audit.py` (199 lines) to TypeScript as `src/commands/audit.ts`. Reuse the existing `readExpertiseFile()` helper (type-aware, alias-resolving). Defaults match the audit script's PASS/WARN/FAIL bands.

Ship with:

- `ml audit` — human-readable, exit 0 always
- `ml audit --ci` — exits 1 on FAIL bands, JSON output
- `ml audit --suggest` — outputs the specific record IDs that should be archived, revised, or attributed. **This is the ROI multiplier:** "your corpus is bad" is uncomforting; "here are 47 specific records to fix, run `ml prune --ids mx-abc,mx-def`" is actionable.
- `ml audit --by-author` (lands when `recorded_by` does in v0.11) — slices metrics per recorder, surfaces the agent runs producing the floater volume
- `ml audit --domain <name>` — scope to one domain
- Config block `audit.thresholds: { evidence_coverage, floater_max, rule_density_min, max_records_per_domain, max_stale }` — every threshold overridable

**Threshold defaults to ship in v1.0:** evidence_coverage ≥ 0.5 (audit's PASS bar relaxed because the audit script's 0.7 is empirically unreachable today), floater_max ≤ 0.2, rule_density_min ≥ 0.25 (audit found NO repo passing 0.4; ship 0.25 as v1.0 floor with config override). Recalibrate after one quarter of corpus data.

**False-positive risk:** the rule-density regex over-counts conventions about Bun-isms ("avoid `process.exit`") and under-counts "we ..." phrasings. Document the regex, accept that the metric is approximate.

**Effort: M.** Mostly a mechanical port plus output formatting.

### 4.3 Attribution + confirmation — SHIP, but route through existing primitives

The team-of-50 unlock. Four commands, all of which **must reuse the existing `outcomes[]` mechanism** at `src/utils/scoring.ts:58-94` and the existing `★N` markers in prime output (`src/utils/format-helpers.ts:85`). Do not build a parallel confirmation system — at v1.0.0 we cannot afford two mechanisms that downstream tools must read.

- **`recorded_by` field** on `BaseRecord` (`src/schemas/record.ts:36-63`). Resolution chain: `--by` flag → `MULCH_AUTHOR` env → `git config user.email` → `whoami` → `unknown`. Distinct from `outcome.agent` (which is "who applied it later"). The stub `owner` field at `src/schemas/record.ts:46-49` was reserved for ownership semantics — keep them distinct, do not conflate.
- **`ml confirm <mx-id>`** — appends an outcome with `status: "success"`, `agent: <recorded_by chain>`, `notes: "confirmed"`. The existing `★N` scoring counts these naturally. Prime output already shows confirmation counts; no new render path needed.
- **`ml challenge <mx-id> --reason "..."`** — appends an outcome with `status: "failure"`, includes reason. Surfaced by `ml doctor` and `ml audit --suggest` as candidates for review. Does not delete or hide the record.
- **`ml supersede <old> <new>`** — explicit replacement using the existing `supersedes:` field on records. Prime returns the new record; `ml search` finds both. Triggers the existing supersession decay tier-walk (`src/commands/prune.ts:81-85, 394`).

**Why this matters:** the existing primitives already do 80% of the work. Building parallel `confirmations: []` and `challenges: []` arrays would split the truth across two fields, double the merge logic in warren's `mulch_merge`, and force every consumer to read both. Keep one source of truth.

**Solo degradation:** With `record.author_required: false` (default), `recorded_by` resolves silently from git email and is invisible in normal output. Solo devs see no friction.

**Effort: M.** Three thin command wrappers, schema field, resolution chain, scoring updates.

### 4.4 Decay model with auto-archive — SHIP

`freshness_score = (confirmations_in_window × type_weight) + recency_bonus − (challenges × challenge_weight) − staleness_penalty`

Decay weights opinionated by record type (config-overridable):

- `failure`, `decision`, `reference` decay slowly (high `type_weight`, low `staleness_penalty`)
- `convention`, `pattern` decay normally
- `note` decays fastest (low `type_weight`, high `staleness_penalty`); intended for short-lived scratch
- `guide` barely decays (long-form documentation)

Below threshold → `ml doctor` and `ml audit --suggest` flag for archive. **Auto-archive at session start, not session end.** The original framing assumed `ml sync --auto-archive`; that works for the manual sync flow, but most agents never run sync. The complementary surface is `ml prime --maybe-prune` (cadence-based via `.mulch/.last-prune` stamp file) so the cleanup happens reliably without depending on agent discipline. Both ship; either alone is sufficient.

**Soft-archive only.** Hard delete remains opt-in via `--hard`. `ml restore` recovers any auto-archived record.

**Solo vs team:** Solo devs love auto-prune (they never run it manually). Teams may want it disabled on developer machines and run from CI; the `prime.auto_prune: weekly|off` config knob handles both.

**Effort: M.** New `--auto-archive` mode in `src/commands/prune.ts:206`, freshness-score computation in scoring.ts, prime cadence logic, stamp file with existing file-locking semantics.

### 4.5 Stable integration schema — SHIP, but defer the event stream

This is what 1.0 means for downstream tools. Agreement on freezing the record envelope, type list, LWW merge semantics, and versioned JSONL with `ml migrate`.

**Push back on:** the event stream / webhook for `ml record`. Today Mulch is purely passive — write to JSONL, done. Adding webhooks introduces:

- An event log to maintain
- Subscriber state (who has consumed which event)
- Delivery semantics (at-least-once? exactly-once?)
- Retry and failure handling
- Authentication for cross-process subscribers

Warren's `mulch_merge` in `reap.ts` already works against polling JSONL. Canopy and overstory have not asked for real-time. **There is no shipped consumer that needs sub-poll-interval latency.** Building the webhook system adds significant maintenance surface for hypothetical demand. Defer to v1.1 when a real consumer asks.

What ships in v1.0 to satisfy the integration story:

- The frozen schema (record envelope, types, classifications)
- `ml migrate <from-version>` for upgrades
- A documented LWW merge contract that `mulch_merge` consumers can rely on
- `ml export --since <timestamp> --json` so consumers that need change-feeds can poll efficiently — covers 95% of the webhook use case at 1% of the implementation cost

**Generic active-work resolver chain (§4.1's third bullet) replaces the original framing's `.seeds/`-and-`gh pr view` hardcoding.** The schema already supports `seeds`, `gh`, `linear`, `bead` evidence symmetrically (`src/schemas/record.ts:16-25`). Hardcoding two trackers as first-class while the others stay second-class would be a v1.0 contract bug. Ship a resolver chain (`src/utils/active-work.ts`) modeled on the planned-but-unshipped owner resolver pattern at `src/schemas/record.ts:46-49`. Each resolver is ~20 lines; first non-empty result wins; `--no-auto-link` disables; explicit `--evidence-*` flags always override.

**Effort: L.** The schema freeze is mostly documentation and `ml migrate` skeleton. The resolver chain is three small resolvers plus a runner. The export command is a thin read-side wrapper.

## Section 5: What I would add that is not in the original framing

### 5.1 Reframe the close-session prose (audit #5)

The original v1.0.0 framing omitted this. I would add it, in v0.10. The current setup recipes (`src/commands/setup.ts:324-330, 404-410`, plus the Claude block) tell agents "Before you finish, run `ml record`" as a closing ritual. Predictable result: agents record the most ritual-shaped thing they can think of, which is module layouts.

Replace with conditional framing: *"If you discovered a non-obvious convention, hit a real failure, or made a decision someone would otherwise re-derive, run `ml record`. Otherwise close the session."* Even with v1.0's structural gates rejecting filler, a softer prompt produces less *attempted* filler upstream, which is cheaper than rejecting it.

Centralize the prose in a single helper so the three recipes (Cursor, Codex, Claude) stay in sync. The same reframe applies to the prime output's session-close block — see §5.2. **Effort: S.**

### 5.2 Overhaul `ml prime` — the biggest behavioral lever

`ml prime` is the only mulch surface every agent reads, every session. Its content shape determines whether mulch helps or wastes context. Today it dumps records first and instructions last; format is identical regardless of task; filler dominates. The audit found 70–80% of conventions are restated module layouts — and prime broadcasts every one of them at session start, then asks the agent to record more before closing. **Fix prime and the per-record audit metrics improve at the consumption layer even before write-side gates change anything.** This is the single highest-leverage behavioral change in the v1.0 plan.

**Current failure modes** (verified by running `ml prime` against the mulch repo's own corpus and reading `src/commands/prime.ts`, 489 lines):

- Records dumped at the top; the actionable Quick Reference is buried after a 200-line wall; the session-close protocol is the *last* thing in the output. Agents skim past the high-trust records to find what to do.
- The `pre-prime` hook prints `consider 'ml prime --manifest' or scoping with --domain/--files to save context` — the tool is *aware* the default is wrong but ships it anyway.
- Per-record output is identical whether the agent will touch the relevant files or not. `ml prime --files <path>` exists but is not the default.
- Within the dump, records are grouped by domain alphabetical order. A 90-day-old `tactical` convention sits next to a ★3-confirmed foundational pattern with no visual distinction.
- The close-session block at the bottom demands recording *every* session ("Unrecorded learnings are lost for the next session"). This is the exact framing the audit identified as the filler-generating mechanism. The 🚨 visual marker itself is doing useful work — it serves as a memory anchor for agents whose context has filled with file edits since session start, raising the odds the close protocol gets executed at all. The problem is the *demand shape*, not the emoji.

**The overhaul** (six changes, all in `src/commands/prime.ts`):

1. **Lead with the contract, not the records.** Top of output: "This project's mulch contract:" — pulled from config, lists the active write-side gates (`require_because: on`, audit thresholds, allowed types per domain, `note` exclusion rules from §4.1). Tells the agent what is expected of them *before* showing them what to know. Borrows the rules-first ordering from `sd prime` without copying its workflow orientation — `sd prime` teaches a workflow, `ml prime` teaches a contract.

2. **Default to manifest mode for non-trivial corpora.** (Absorbs the prior §5.2.) Threshold suggestion: 100 records or 5 domains. Full corpus dump becomes `ml prime --full`. Manifest emits the contract + per-domain index (count, recency, top-3 ★-confirmed records, rotting flag) so agents know what to scope-load with `ml prime <domain>` or `ml prime --files <path>`. The `pre-prime` warning becomes obsolete because the default *is* the right thing.

3. **Context-scope as default for full mode.** When the agent opts into `--full`, detect what they're about to work on: `git status` for changed/untracked files, current branch name, in-progress seeds (via the active-work resolver chain from §4.5). Scope records to those signals. `ml prime --full --all` for the unfiltered dump.

4. **Rank within the surfaced set by trust tier, not domain order.** ★-confirmed records first, then foundational, then tactical, then observational. Within a tier, order by relevance to the current scope. Today's per-domain alphabetical dump treats a 90-day-old `tactical` convention identically to a 5×-confirmed foundational pattern — wasting the agent's attention on the lower-trust record.

5. **Per-record "why surfaced now" suffix.** One short tag per surfaced record: `(matches src/foo.ts)`, `(★3 in this domain)`, `(in_progress: seed-abc)`, `(recently authored: 2d ago)`. Gives the agent signal about whether to weight the record vs skim past it. Cheap to compute on top of the existing scoring pipeline at `src/utils/scoring.ts`.

6. **Reshape the 🚨 close-session block into a conditional prompt — keep the visual marker.** Same reframe as §5.1, applied to the prime output footer, but preserve the 🚨 prefix because it functions as a memory anchor for agents whose context has filled with file edits since session start. New body: *"🚨 Before closing this session: if you discovered a non-obvious convention, hit a real failure, or made a decision someone would otherwise re-derive, run `ml record`. If the session was routine, close without recording — `ml audit` surfaces anything stale."* The visual salience is preserved (high odds the agent re-reads the protocol after a long context); the recording-as-ritual gravity field that produces the audit's filler-convention pattern is removed.

Provider-tuned format stays — the existing decision at `mx-957d46` (XML for Claude, plain text for Codex, markdown for Cursor) is correct and orthogonal to the content overhaul.

**Solo vs team:** Solo devs benefit immediately from the relevance scoping (smaller context bills) and the conditional close prompt (less filler). Teams of 50+ benefit at scale: every IC's session opens with the team's mulch contract front-and-center, which makes write-side conventions actually behavioral rather than aspirational. The contract-first framing is what makes 50 ICs converge on the same recording discipline without a curator enforcing it.

**Risks:**

- Detection-based scoping can mis-scope. Mitigate with `--all` escape hatch and a stderr line: `scoped to 12 of 205 records based on git status; --all for full corpus`.
- Trust-tier ranking may demote unconfirmed-but-genuinely-load-bearing foundational records. Make tier weights config-overridable via `prime.tier_weights`.
- The conditional close prompt may reduce true-positive records too. Watch the post-v0.10 `ml audit --by-author` metrics; if record volume drops without quality rising, the prompt over-corrected.
- Manifest-as-default surprises existing tooling that parses prime output. Mitigate with one v0.x cycle of `pre-prime` warning telling consumers about the impending default flip; ship the flip in v0.10 with explicit changelog.

**Effort: M–L.** Default-mode flip and content reordering are S each. Context detection (git + seeds + branch via the resolver chain) is M. Per-record "why surfaced" computation requires extending the scoring/relevance pipeline. Ship the full overhaul in v0.10 as a single coherent change — fragmenting it creates a v0.10 that is worse than v0.9 (e.g., conditional close without lead-with-contract leaves agents unsure what is expected of them).

## Section 6: Deferred past v1.0.0

Adopting the original framing's deferral list and adding two:

- Semantic search / embeddings (FTS5 + domain scoping is sufficient post-prune)
- Per-record visibility levels (internal/team/org/public)
- Web UI
- Cross-repo federation
- **Event stream / webhooks** (added; see §4.5 reasoning)
- **Org-wide policy distribution** (already out of scope per maintainer)
- **Per-record audit log / change history** (already out of scope per maintainer)

## Section 7: Open risks

**`--because` may produce parroted strings** ("because this is convention"). The identifier-density check is the real teeth; `--because` is a forcing function for thoughtfulness. If post-v0.11 metrics show `--because` catches <20% incremental floaters over the identifier check, drop it to a soft-warning in v1.0 rather than a hard requirement.

**`note` bypass risk is real if §4.1 mitigations are incomplete.** Auditing v0.11 corpora for note/convention ratios is critical before v1.0 freeze. If teams are routing >50% of writes to `note`, the gate is being bypassed, not respected.

**Tracker resolvers have inconsistent "in_progress + mine" semantics.** Seeds has `sd ready --mine` (verify with seeds maintainer). GitHub has `gh issue list --assignee @me --state open` but lacks a native "in progress" concept. Ship resolvers with conservative behavior (auto-link only on exactly one match), stamp a stderr line so wrong links self-correct via `--evidence-seeds <id>` override.

**Auto-prune-on-prime latency.** Pruning a 500-record corpus is not free. Cadence default is `off` in v0.11; if v1.0 enables it by default, fire-and-forget async with results surfaced on the *next* prime invocation.

**`ml audit` thresholds will be wrong for some corpus shapes.** Reference docs (third-party API quirks) are legitimately convention-heavy and evidence-light. Ship with `--ignore-domains` and per-domain threshold overrides; accept that the first quarter of v1.0 usage will surface tuning needs.

**The owner resolution chain at `src/schemas/record.ts:46-49` is documented but not implemented.** Either ship it as part of v0.11's `recorded_by` work (cheap, same chain) or remove the comment. Do not leave it in limbo at v1.0 freeze.

## One-sentence v1.0.0 commitment

*The audit pattern across seven repos becomes an artifact of the v0.x era — not a permanent property of the tool — because every failure mode it identified is structurally bounded at v1.0.0 by gates, automation, attribution, or auto-archival.*
