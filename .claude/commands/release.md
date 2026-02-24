Prepare a release by updating docs and bumping the version.

## Steps

### 1. Analyze changes since last release

- Run `git log --oneline` to find the last version tag/release commit
- Run `git diff --stat <last-release>..HEAD` to see all changed files
- Read the commit messages to understand what was added, fixed, and changed
- Run `npm test` to get the current test count, file count, and expect() count

### 2. Determine version bump

- If the user specified `major`, `minor`, or `patch`, use that
- Default: `patch` if not specified
- Current version is in `package.json` (`"version"` field) and `src/cli.ts` (`.version()` call)

### 3. Bump version in both locations

- `package.json` — update `"version"` field
- `src/cli.ts` — update `.version("...")` call

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

### 7. Present summary

- Show a summary of all changes made
- List the version bump (old -> new)
- Summarize what was documented in the changelog

Do NOT commit or push. Just make the edits and present the summary.
