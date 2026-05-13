---
name: release
---

## intro

Prepare a release by updating docs and bumping the version.

User specified: $ARGUMENTS

## Steps

### 1. Analyze changes since last release

- Run `git log --oneline` to find the last version tag/release commit
- Run `git diff --stat <last-release>..HEAD` to see all changed files
- Read the commit messages to understand what was added, fixed, and changed
- Run `npm test` to get the current test count, file count, and expect() count

### 2. Determine version bump

- If the user specified `major`, `minor`, or `patch` above, use that
- Default: `patch` if nothing was specified
- Current version is in `package.json` (`"version"` field) and `src/cli.ts` (`.version()` call)

### 3. Bump version

Run: `bun run version:bump <major|minor|patch>`

This atomically updates both `package.json` and `src/cli.ts`.

### 4. Update CHANGELOG.md

- Add a new `## [X.Y.Z] - YYYY-MM-DD` section under `## [Unreleased]`
- Categorize changes into `### Added`, `### Fixed`, `### Changed` subsections
- Use sub-headers (####) for grouping related changes (e.g., "New CLI Commands", "Testing")
- Include updated test counts (tests, files, expect() calls)
- Update the comparison links at the bottom of the file:
  - `[Unreleased]` link should compare against the new version
  - Add a new link for the new version comparing against the previous

### 5. Update CLAUDE.md

- Update command counts if new commands were added
- Add new files to the directory structure listing
- Update any descriptions that changed (e.g., file format migrations)
- Keep the structure consistent with existing entries

### 6. Update README.md

- Update test counts in the Tech Stack and Development sections
- Update command counts in the Project Structure section
- Add new CLI commands/flags to the CLI Reference section
- Update architecture descriptions if features changed
- Add new files to the Project Structure listing

### 7. Update CONFIG.md

CONFIG.md is the user-facing reference for every configuration surface Mulch exposes (the `.mulch/mulch.config.yaml` schema, hooks, custom types, decay, recipes, CLI flags). Releases that touch any of these MUST update it; if nothing relevant changed, say so explicitly in the summary so it's a deliberate choice, not an oversight.

Check whether this release touched any of:

- `src/schemas/config.ts` / `src/schemas/config-schema.ts` — new/removed/renamed config keys, default changes
- `src/schemas/record.ts` / `src/schemas/record-schema.ts` — new base-record fields, type changes
- `src/registry/` — built-in type definitions, `extends`/`disabled_types`/`aliases` semantics
- `src/utils/hooks.ts` — new hook events, payload shape changes, timeout/env contract
- `src/utils/domain-rules.ts` — per-domain rule semantics
- `src/commands/prune.ts` — decay knobs, demotion ladder, archive behavior
- `src/commands/setup.ts` / `src/utils/recipe-discovery.ts` — built-in recipes added/removed, discovery order, `ProviderRecipe` shape
- `src/cli.ts` — new global flags or top-level commands
- `src/utils/runtime-flags.ts` — `--allow-*` escape hatches

For each relevant change:

- Update the matching section in Part 1 (Admin) or Part 2 (IC).
- Update the alphabetical config-key index in Appendix A.
- Update the hook event quick reference (Appendix B) if hooks changed.
- Update the CLI flags table (Appendix C) if flags changed.
- Update the file path reference (Appendix D) if `.mulch/` layout changed.
- Update the version banner at the very top (`v0.X.Y`).

Removed config keys or types: leave them out of the doc entirely (CONFIG.md is reference, not changelog). The CHANGELOG entry covers the removal.

### 8. Present summary

- Show a summary of all changes made
- List the version bump (old -> new)
- Summarize what was documented in the changelog

Do NOT commit or push. Just make the edits and present the summary.
