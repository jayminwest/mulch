import { describe, expect, it } from "bun:test";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  DEFAULT_BUDGET,
  applyBudget,
  estimateTokens,
  formatBudgetSummary,
} from "../../src/utils/budget.ts";
import type { DomainRecords } from "../../src/utils/budget.ts";
import type { Outcome, ScoredRecord } from "../../src/utils/scoring.ts";

function makeRecord(
  type: ExpertiseRecord["type"],
  classification: ExpertiseRecord["classification"],
  overrides: Record<string, unknown> = {},
): ScoredRecord {
  const base = {
    classification,
    recorded_at: new Date().toISOString(),
  };
  switch (type) {
    case "convention":
      return {
        ...base,
        type: "convention",
        content: (overrides.content as string) ?? "A convention",
        ...overrides,
      } as ScoredRecord;
    case "decision":
      return {
        ...base,
        type: "decision",
        title: (overrides.title as string) ?? "A decision",
        rationale: (overrides.rationale as string) ?? "Because reasons",
        ...overrides,
      } as ScoredRecord;
    case "pattern":
      return {
        ...base,
        type: "pattern",
        name: (overrides.name as string) ?? "A pattern",
        description: (overrides.description as string) ?? "A pattern desc",
        ...overrides,
      } as ScoredRecord;
    case "guide":
      return {
        ...base,
        type: "guide",
        name: (overrides.name as string) ?? "A guide",
        description: (overrides.description as string) ?? "A guide desc",
        ...overrides,
      } as ScoredRecord;
    case "failure":
      return {
        ...base,
        type: "failure",
        description: (overrides.description as string) ?? "A failure",
        resolution: (overrides.resolution as string) ?? "Fix it",
        ...overrides,
      } as ScoredRecord;
    case "reference":
      return {
        ...base,
        type: "reference",
        name: (overrides.name as string) ?? "A reference",
        description: (overrides.description as string) ?? "A ref desc",
        ...overrides,
      } as ScoredRecord;
  }
}

function makeOutcome(status: Outcome["status"]): Outcome {
  return { status, recorded_at: new Date().toISOString() };
}

function simpleEstimate(record: ExpertiseRecord): string {
  switch (record.type) {
    case "convention":
      return `[convention] ${record.content}`;
    case "pattern":
      return `[pattern] ${record.name}: ${record.description}`;
    case "failure":
      return `[failure] ${record.description} -> ${record.resolution}`;
    case "decision":
      return `[decision] ${record.title}: ${record.rationale}`;
    case "reference":
      return `[reference] ${record.name}: ${record.description}`;
    case "guide":
      return `[guide] ${record.name}: ${record.description}`;
  }
}

describe("budget utility", () => {
  describe("estimateTokens", () => {
    it("returns chars / 4 rounded up", () => {
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
      expect(estimateTokens("a".repeat(400))).toBe(100);
    });

    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("DEFAULT_BUDGET", () => {
    it("is 4000", () => {
      expect(DEFAULT_BUDGET).toBe(4000);
    });
  });

  describe("applyBudget", () => {
    it("keeps all records when budget is large", () => {
      const domains: DomainRecords[] = [
        {
          domain: "d1",
          records: [
            makeRecord("convention", "foundational"),
            makeRecord("decision", "foundational"),
            makeRecord("pattern", "tactical"),
          ],
        },
      ];

      const result = applyBudget(domains, 100000, simpleEstimate);
      expect(result.droppedCount).toBe(0);
      expect(result.droppedDomainCount).toBe(0);
      expect(result.kept[0].records).toHaveLength(3);
    });

    it("drops records when budget is exceeded", () => {
      const records: ExpertiseRecord[] = [];
      for (let i = 0; i < 50; i++) {
        records.push(
          makeRecord("convention", "foundational", {
            content: `Convention ${i} with a reasonable amount of text padding`,
          }),
        );
      }
      const domains: DomainRecords[] = [{ domain: "d1", records }];

      const result = applyBudget(domains, 100, simpleEstimate);
      expect(result.droppedCount).toBeGreaterThan(0);
      expect(result.kept[0].records.length).toBeLessThan(50);
    });

    it("prioritizes by type: convention > decision > pattern > guide > failure > reference", () => {
      // One record of each type, all foundational
      const convention = makeRecord("convention", "foundational", {
        content: "conv",
      });
      const decision = makeRecord("decision", "foundational", {
        title: "dec",
        rationale: "rat",
      });
      const pattern = makeRecord("pattern", "foundational", {
        name: "pat",
        description: "desc",
      });
      const guide = makeRecord("guide", "foundational", {
        name: "gui",
        description: "desc",
      });
      const failure = makeRecord("failure", "foundational", {
        description: "fail",
        resolution: "fix",
      });
      const reference = makeRecord("reference", "foundational", {
        name: "ref",
        description: "desc",
      });

      // Put them in reverse priority order
      const domains: DomainRecords[] = [
        {
          domain: "d1",
          records: [reference, failure, guide, pattern, decision, convention],
        },
      ];

      // Budget that fits 3 records
      const costs = [convention, decision, pattern].map((r) =>
        estimateTokens(simpleEstimate(r)),
      );
      const budget = costs.reduce((a, b) => a + b, 0) + 1;

      const result = applyBudget(domains, budget, simpleEstimate);
      const keptTypes = result.kept[0].records.map((r) => r.type);
      // Convention, decision, and pattern should be kept (highest priority)
      expect(keptTypes).toContain("convention");
      expect(keptTypes).toContain("decision");
      expect(keptTypes).toContain("pattern");
    });

    it("prioritizes by classification within same type", () => {
      const obs = makeRecord("convention", "observational", {
        content: "observational conv",
      });
      const tac = makeRecord("convention", "tactical", {
        content: "tactical conv",
      });
      const found = makeRecord("convention", "foundational", {
        content: "foundational conv",
      });

      const domains: DomainRecords[] = [
        { domain: "d1", records: [obs, tac, found] },
      ];

      // Budget for 2 records
      const cost = estimateTokens(simpleEstimate(found));
      const result = applyBudget(domains, cost * 2 + 1, simpleEstimate);

      const keptClassifications = result.kept[0].records.map(
        (r) => r.classification,
      );
      expect(keptClassifications).toContain("foundational");
      expect(keptClassifications).toContain("tactical");
      expect(keptClassifications).not.toContain("observational");
    });

    it("prioritizes newer records within same type and classification", () => {
      const old = makeRecord("convention", "foundational", {
        content: "old convention",
        recorded_at: "2024-01-01T00:00:00Z",
      });
      const recent = makeRecord("convention", "foundational", {
        content: "new convention",
        recorded_at: "2025-12-01T00:00:00Z",
      });

      const domains: DomainRecords[] = [
        { domain: "d1", records: [old, recent] },
      ];

      const cost = estimateTokens(simpleEstimate(recent));
      const result = applyBudget(domains, cost + 1, simpleEstimate);

      expect(result.kept[0].records).toHaveLength(1);
      expect((result.kept[0].records[0] as { content: string }).content).toBe(
        "new convention",
      );
    });

    it("preserves original record order within kept records", () => {
      const r1 = makeRecord("convention", "foundational", { content: "first" });
      const r2 = makeRecord("convention", "foundational", {
        content: "second",
      });
      const r3 = makeRecord("convention", "foundational", { content: "third" });

      const domains: DomainRecords[] = [
        { domain: "d1", records: [r1, r2, r3] },
      ];

      const result = applyBudget(domains, 100000, simpleEstimate);
      const contents = result.kept[0].records.map(
        (r) => (r as { content: string }).content,
      );
      expect(contents).toEqual(["first", "second", "third"]);
    });

    it("preserves original domain order", () => {
      const domains: DomainRecords[] = [
        {
          domain: "zebra",
          records: [makeRecord("convention", "foundational", { content: "z" })],
        },
        {
          domain: "alpha",
          records: [makeRecord("convention", "foundational", { content: "a" })],
        },
      ];

      const result = applyBudget(domains, 100000, simpleEstimate);
      expect(result.kept[0].domain).toBe("zebra");
      expect(result.kept[1].domain).toBe("alpha");
    });

    it("omits domains whose records are all dropped", () => {
      const domains: DomainRecords[] = [
        {
          domain: "keep",
          records: [
            makeRecord("convention", "foundational", { content: "hi" }),
          ],
        },
        {
          domain: "drop",
          records: [
            makeRecord("reference", "observational", {
              name: "big ref",
              description:
                "A very long reference description that takes up a lot of budget space",
            }),
          ],
        },
      ];

      const keepCost = estimateTokens(simpleEstimate(domains[0].records[0]));
      const result = applyBudget(domains, keepCost + 1, simpleEstimate);

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].domain).toBe("keep");
      expect(result.droppedDomainCount).toBe(1);
    });

    it("returns empty kept array with zero budget", () => {
      const domains: DomainRecords[] = [
        { domain: "d1", records: [makeRecord("convention", "foundational")] },
      ];

      const result = applyBudget(domains, 0, simpleEstimate);
      expect(result.kept).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("handles empty domain list", () => {
      const result = applyBudget([], 4000, simpleEstimate);
      expect(result.droppedCount).toBe(0);
      expect(result.droppedDomainCount).toBe(0);
      expect(result.kept).toHaveLength(0);
    });

    it("handles domains with no records", () => {
      const domains: DomainRecords[] = [{ domain: "empty", records: [] }];
      const result = applyBudget(domains, 4000, simpleEstimate);
      expect(result.droppedCount).toBe(0);
      expect(result.kept).toHaveLength(0);
    });

    it("prioritizes records with higher confirmation scores over unscored records of the same type/classification", () => {
      const unscored = makeRecord("pattern", "foundational", {
        name: "unscored",
        description: "no outcomes",
      });
      const confirmed = makeRecord("pattern", "foundational", {
        name: "confirmed",
        description: "has outcomes",
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      // Put unscored first, confirmed second
      const domains: DomainRecords[] = [
        { domain: "d1", records: [unscored, confirmed] },
      ];

      // Budget that fits only 1 record
      const cost = estimateTokens(simpleEstimate(confirmed));
      const result = applyBudget(domains, cost + 1, simpleEstimate);

      expect(result.kept[0].records).toHaveLength(1);
      expect((result.kept[0].records[0] as { name: string }).name).toBe(
        "confirmed",
      );
    });

    it("prioritizes records with more confirmations over those with fewer", () => {
      const oneSuccess = makeRecord("pattern", "foundational", {
        name: "one-success",
        description: "one outcome",
        outcomes: [makeOutcome("success")],
      });
      const threeSuccesses = makeRecord("pattern", "foundational", {
        name: "three-successes",
        description: "three outcomes",
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });

      const domains: DomainRecords[] = [
        { domain: "d1", records: [oneSuccess, threeSuccesses] },
      ];

      const cost = estimateTokens(simpleEstimate(threeSuccesses));
      const result = applyBudget(domains, cost + 1, simpleEstimate);

      expect(result.kept[0].records).toHaveLength(1);
      expect((result.kept[0].records[0] as { name: string }).name).toBe(
        "three-successes",
      );
    });

    it("partial outcomes contribute 0.5 to confirmation score", () => {
      const onePartial = makeRecord("pattern", "foundational", {
        name: "one-partial",
        description: "partial outcome",
        outcomes: [makeOutcome("partial")],
      });
      const oneSuccess = makeRecord("pattern", "foundational", {
        name: "one-success",
        description: "success outcome",
        outcomes: [makeOutcome("success")],
      });

      const domains: DomainRecords[] = [
        { domain: "d1", records: [onePartial, oneSuccess] },
      ];

      const cost = estimateTokens(simpleEstimate(oneSuccess));
      const result = applyBudget(domains, cost + 1, simpleEstimate);

      // success (score=1) > partial (score=0.5)
      expect(result.kept[0].records).toHaveLength(1);
      expect((result.kept[0].records[0] as { name: string }).name).toBe(
        "one-success",
      );
    });

    it("type priority still takes precedence over confirmation score", () => {
      const highlyConfirmedReference = makeRecord("reference", "foundational", {
        name: "popular ref",
        description: "very well confirmed reference",
        outcomes: Array.from({ length: 10 }, () => makeOutcome("success")),
      });
      const unscoredConvention = makeRecord("convention", "foundational", {
        content: "plain convention",
      });

      const domains: DomainRecords[] = [
        {
          domain: "d1",
          records: [highlyConfirmedReference, unscoredConvention],
        },
      ];

      const cost = estimateTokens(simpleEstimate(unscoredConvention));
      const result = applyBudget(domains, cost + 1, simpleEstimate);

      // Convention (type priority 0) beats reference (type priority 5) regardless of score
      expect(result.kept[0].records).toHaveLength(1);
      expect(result.kept[0].records[0].type).toBe("convention");
    });
  });

  describe("formatBudgetSummary", () => {
    it("plural records and domains", () => {
      expect(formatBudgetSummary(5, 3)).toBe(
        "... and 5 more records across 3 domains (use --budget <n> to show more)",
      );
    });

    it("singular record and domain", () => {
      expect(formatBudgetSummary(1, 1)).toBe(
        "... and 1 more record across 1 domain (use --budget <n> to show more)",
      );
    });

    it("no domain info when droppedDomainCount is 0", () => {
      expect(formatBudgetSummary(2, 0)).toBe(
        "... and 2 more records (use --budget <n> to show more)",
      );
    });
  });
});
