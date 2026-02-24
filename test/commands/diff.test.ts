import { describe, expect, it } from "bun:test";
import {
  formatDiffOutput,
  parseExpertiseDiff,
} from "../../src/commands/diff.ts";

describe("diff command", () => {
  describe("parseExpertiseDiff", () => {
    it("parses added records from diff output", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,2 +1,3 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
+{"type":"pattern","name":"diff-cmd","description":"Shows changes","classification":"tactical","recorded_at":"2024-01-02T00:00:00.000Z","id":"mx-bbb222"}`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(1);
      expect(entries[0].domain).toBe("cli");
      expect(entries[0].added).toHaveLength(1);
      expect(entries[0].added[0].type).toBe("pattern");
      expect(entries[0].added[0].id).toBe("mx-bbb222");
      expect(entries[0].removed).toHaveLength(0);
    });

    it("parses removed records from diff output", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,2 +1,1 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
-{"type":"failure","description":"Old bug","resolution":"Fixed it","classification":"observational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-ccc333"}`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(1);
      expect(entries[0].domain).toBe("cli");
      expect(entries[0].added).toHaveLength(0);
      expect(entries[0].removed).toHaveLength(1);
      expect(entries[0].removed[0].type).toBe("failure");
      expect(entries[0].removed[0].id).toBe("mx-ccc333");
    });

    it("groups by domain", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,1 +1,2 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
+{"type":"pattern","name":"cli-pattern","description":"CLI pattern","classification":"tactical","recorded_at":"2024-01-02T00:00:00.000Z","id":"mx-bbb222"}
diff --git a/.mulch/expertise/testing.jsonl b/.mulch/expertise/testing.jsonl
index xyz789..uvw456 100644
--- a/.mulch/expertise/testing.jsonl
+++ b/.mulch/expertise/testing.jsonl
@@ -1,1 +1,2 @@
 {"type":"convention","content":"No mocks","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-ddd444"}
+{"type":"pattern","name":"test-pattern","description":"Test pattern","classification":"tactical","recorded_at":"2024-01-02T00:00:00.000Z","id":"mx-eee555"}`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(2);
      expect(entries[0].domain).toBe("cli");
      expect(entries[0].added).toHaveLength(1);
      expect(entries[0].added[0].id).toBe("mx-bbb222");
      expect(entries[1].domain).toBe("testing");
      expect(entries[1].added).toHaveLength(1);
      expect(entries[1].added[0].id).toBe("mx-eee555");
    });

    it("handles multiple domains in one diff", () => {
      const diffOutput = `diff --git a/.mulch/expertise/alpha.jsonl b/.mulch/expertise/alpha.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/alpha.jsonl
+++ b/.mulch/expertise/alpha.jsonl
@@ -1,1 +1,2 @@
+{"type":"convention","content":"Alpha convention","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
diff --git a/.mulch/expertise/beta.jsonl b/.mulch/expertise/beta.jsonl
index xyz789..uvw456 100644
--- a/.mulch/expertise/beta.jsonl
+++ b/.mulch/expertise/beta.jsonl
@@ -1,1 +1,1 @@
-{"type":"convention","content":"Beta convention","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-bbb222"}`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(2);
      // Entries are sorted by domain
      expect(entries[0].domain).toBe("alpha");
      expect(entries[0].added).toHaveLength(1);
      expect(entries[0].removed).toHaveLength(0);
      expect(entries[1].domain).toBe("beta");
      expect(entries[1].added).toHaveLength(0);
      expect(entries[1].removed).toHaveLength(1);
    });

    it("skips non-JSON lines (hunk headers, context)", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,2 +1,3 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
+{"type":"pattern","name":"diff-cmd","description":"Shows changes","classification":"tactical","recorded_at":"2024-01-02T00:00:00.000Z","id":"mx-bbb222"}
+not a json line`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(1);
      expect(entries[0].domain).toBe("cli");
      expect(entries[0].added).toHaveLength(1);
      expect(entries[0].added[0].id).toBe("mx-bbb222");
    });

    it("returns empty array for empty diff", () => {
      const entries = parseExpertiseDiff("");
      expect(entries).toHaveLength(0);
    });

    it("filters out domains with no actual changes", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,1 +1,1 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}`;

      const entries = parseExpertiseDiff(diffOutput);

      // No added or removed records, so domain should be filtered out
      expect(entries).toHaveLength(0);
    });

    it("parses both added and removed records in same domain", () => {
      const diffOutput = `diff --git a/.mulch/expertise/cli.jsonl b/.mulch/expertise/cli.jsonl
index abc123..def456 100644
--- a/.mulch/expertise/cli.jsonl
+++ b/.mulch/expertise/cli.jsonl
@@ -1,2 +1,3 @@
 {"type":"convention","content":"Use ESM","classification":"foundational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-aaa111"}
+{"type":"pattern","name":"diff-cmd","description":"Shows changes","classification":"tactical","recorded_at":"2024-01-02T00:00:00.000Z","id":"mx-bbb222"}
-{"type":"failure","description":"Old bug","resolution":"Fixed it","classification":"observational","recorded_at":"2024-01-01T00:00:00.000Z","id":"mx-ccc333"}`;

      const entries = parseExpertiseDiff(diffOutput);

      expect(entries).toHaveLength(1);
      expect(entries[0].domain).toBe("cli");
      expect(entries[0].added).toHaveLength(1);
      expect(entries[0].added[0].id).toBe("mx-bbb222");
      expect(entries[0].removed).toHaveLength(1);
      expect(entries[0].removed[0].id).toBe("mx-ccc333");
    });
  });

  describe("formatDiffOutput", () => {
    it("formats single domain with added records", () => {
      const entries = [
        {
          domain: "cli",
          added: [
            {
              type: "pattern" as const,
              name: "diff-cmd",
              description: "Shows changes",
              classification: "tactical" as const,
              recorded_at: "2024-01-02T00:00:00.000Z",
              id: "mx-bbb222",
            },
          ],
          removed: [],
        },
      ];

      const output = formatDiffOutput(entries, "HEAD~1");

      expect(output).toContain("Expertise changes since HEAD~1");
      expect(output).toContain("cli (1 change):");
      expect(output).toContain("+ [pattern] mx-bbb222");
      expect(output).toContain("diff-cmd");
    });

    it("formats multiple domains", () => {
      const entries = [
        {
          domain: "cli",
          added: [
            {
              type: "pattern" as const,
              name: "cli-pattern",
              description: "CLI pattern",
              classification: "tactical" as const,
              recorded_at: "2024-01-02T00:00:00.000Z",
              id: "mx-aaa111",
            },
          ],
          removed: [],
        },
        {
          domain: "testing",
          added: [
            {
              type: "convention" as const,
              content: "No mocks",
              classification: "foundational" as const,
              recorded_at: "2024-01-01T00:00:00.000Z",
              id: "mx-bbb222",
            },
          ],
          removed: [],
        },
      ];

      const output = formatDiffOutput(entries, "main");

      expect(output).toContain("Expertise changes since main");
      expect(output).toContain("cli (1 change):");
      expect(output).toContain("+ [pattern] mx-aaa111");
      expect(output).toContain("testing (1 change):");
      expect(output).toContain("+ [convention] mx-bbb222");
    });

    it("shows record type and ID in output", () => {
      const entries = [
        {
          domain: "cli",
          added: [
            {
              type: "failure" as const,
              description: "Bug found",
              resolution: "Fixed it",
              classification: "observational" as const,
              recorded_at: "2024-01-02T00:00:00.000Z",
              id: "mx-xyz789",
            },
          ],
          removed: [
            {
              type: "decision" as const,
              title: "Use TypeScript",
              rationale: "Type safety",
              classification: "foundational" as const,
              recorded_at: "2024-01-01T00:00:00.000Z",
              id: "mx-abc123",
            },
          ],
        },
      ];

      const output = formatDiffOutput(entries, "HEAD~1");

      expect(output).toContain("+ [failure] mx-xyz789");
      expect(output).toContain("- [decision] mx-abc123");
      expect(output).toContain("cli (2 changes):");
    });

    it("uses correct plural form for changes count", () => {
      const entries = [
        {
          domain: "cli",
          added: [
            {
              type: "convention" as const,
              content: "Use ESM",
              classification: "foundational" as const,
              recorded_at: "2024-01-01T00:00:00.000Z",
              id: "mx-aaa111",
            },
            {
              type: "pattern" as const,
              name: "test",
              description: "Test pattern",
              classification: "tactical" as const,
              recorded_at: "2024-01-02T00:00:00.000Z",
              id: "mx-bbb222",
            },
          ],
          removed: [],
        },
      ];

      const output = formatDiffOutput(entries, "HEAD~1");

      expect(output).toContain("cli (2 changes):");
    });
  });
});
