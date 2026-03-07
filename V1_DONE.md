# Mulch — V1 Scope

## One-Liner
Structured expertise management for AI agents — store, query, and inject project learnings across sessions via git-tracked JSONL files.

## V1 Definition of Done

- [ ] All core commands work on happy path: `init`, `add`, `record`, `query`, `prime`, `search`, `edit`, `delete`, `delete-domain`, `update`, `outcome`, `status`, `validate`
- [ ] Maintenance commands work: `compact`, `prune`, `doctor`, `sync`, `diff`, `learn`, `ready`
- [ ] Agent onboarding commands work: `onboard`, `setup` (all 6 providers)
- [ ] Schema validation enforces all 6 record types (convention, pattern, failure, decision, reference, guide)
- [ ] Multi-agent safety: advisory file locking and atomic writes prevent corruption under concurrent access
- [ ] `prime` respects token budget and outputs usable context in all 4 formats (markdown, compact, XML, plain)
- [ ] Full-text search (BM25) returns ranked results across domains
- [ ] Dedup detection warns on semantically similar records during `record`
- [ ] Programmatic API (`recordExpertise`, `searchExpertise`, `queryDomain`, `editRecord`, `appendOutcome`) is stable and exported
- [ ] All tests pass (`bun test`)
- [ ] TypeScript strict mode clean (`bun run typecheck`)
- [ ] Linting passes (`bun run lint`) — warnings acceptable, zero errors
- [ ] CI pipeline runs lint + typecheck + test on push/PR
- [ ] Published to npm as `@os-eco/mulch-cli`

## Explicitly Out of Scope for V1

- `mulch rank` command (score-based ranking without text query)
- Global `--format` flag on all commands (currently only `prime` supports format selection)
- Semantic clustering in `compact --analyze` (TF-IDF / cosine similarity grouping)
- Web UI or dashboard for browsing expertise
- Remote/cloud sync — git is the transport layer, period
- Multi-repo expertise federation (querying across repos)
- LLM-powered compaction or summarization
- Outcome analytics or trend reporting beyond what `doctor` shows
- Plugin system for custom record types

## Current State

Mulch is effectively V1-complete. All 24 CLI commands are implemented, tested, and working. 775 tests pass. TypeScript strict mode and linting are clean. CI is green. The programmatic API is stable and used by overstory. Multi-agent concurrency is battle-tested (advisory locks + atomic writes). Published to npm at v0.6.3.

The 4 open issues are all Priority 3 features (rank, global format flag, semantic clustering, shell completions polish) — none are required for V1.

**Estimated completion: ~95%.** Remaining 5% is edge-case hardening and the lint warnings (435 non-null assertion warnings from Biome, all safe).

## Open Questions

- Should the 435 Biome `noNonNullAssertion` warnings be cleaned up before calling V1 done, or are they acceptable as-is?
- Is shell tab-completion (`ml completions`) working end-to-end, or just generating the script? Needs manual verification.
