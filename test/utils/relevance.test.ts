import { describe, expect, it } from "bun:test";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  DEFAULT_RELEVANCE_CONFIG,
  DEFAULT_RELEVANCE_WEIGHTS,
  computeRelevanceScore,
  rankByRelevance,
  scoreClassification,
  scoreFileAffinity,
  scoreOutcomeSuccess,
  scoreRecency,
  scoreType,
} from "../../src/utils/relevance.ts";
import type { Outcome } from "../../src/utils/scoring.ts";

function makeRecord(
  type: ExpertiseRecord["type"],
  classification: ExpertiseRecord["classification"],
  overrides: Record<string, unknown> = {},
): ExpertiseRecord {
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
      } as ExpertiseRecord;
    case "decision":
      return {
        ...base,
        type: "decision",
        title: (overrides.title as string) ?? "A decision",
        rationale: (overrides.rationale as string) ?? "Because reasons",
        ...overrides,
      } as ExpertiseRecord;
    case "pattern":
      return {
        ...base,
        type: "pattern",
        name: (overrides.name as string) ?? "A pattern",
        description: (overrides.description as string) ?? "A pattern desc",
        ...overrides,
      } as ExpertiseRecord;
    case "guide":
      return {
        ...base,
        type: "guide",
        name: (overrides.name as string) ?? "A guide",
        description: (overrides.description as string) ?? "A guide desc",
        ...overrides,
      } as ExpertiseRecord;
    case "failure":
      return {
        ...base,
        type: "failure",
        description: (overrides.description as string) ?? "A failure",
        resolution: (overrides.resolution as string) ?? "Fix it",
        ...overrides,
      } as ExpertiseRecord;
    case "reference":
      return {
        ...base,
        type: "reference",
        name: (overrides.name as string) ?? "A reference",
        description: (overrides.description as string) ?? "A ref desc",
        ...overrides,
      } as ExpertiseRecord;
  }
}

function makeOutcome(status: Outcome["status"]): Outcome {
  return { status, recorded_at: new Date().toISOString() };
}

describe("relevance scoring", () => {
  describe("scoreType", () => {
    it("returns expected scores for each type", () => {
      expect(scoreType("convention")).toBeCloseTo(1.0);
      expect(scoreType("decision")).toBeCloseTo(0.8);
      expect(scoreType("pattern")).toBeCloseTo(0.6);
      expect(scoreType("guide")).toBeCloseTo(0.4);
      expect(scoreType("failure")).toBeCloseTo(0.2);
      expect(scoreType("reference")).toBeCloseTo(0.0);
    });
  });

  describe("scoreClassification", () => {
    it("returns expected scores for each classification", () => {
      expect(scoreClassification("foundational")).toBeCloseTo(1.0);
      expect(scoreClassification("tactical")).toBeCloseTo(0.5);
      expect(scoreClassification("observational")).toBeCloseTo(0.0);
    });
  });

  describe("scoreRecency", () => {
    const now = new Date("2026-03-06T00:00:00Z");

    it("returns 1.0 for records from today", () => {
      expect(scoreRecency("2026-03-06T00:00:00Z", now)).toBeCloseTo(1.0);
    });

    it("returns 0.5 at half-life (30 days)", () => {
      expect(scoreRecency("2026-02-04T00:00:00Z", now)).toBeCloseTo(0.5, 1);
    });

    it("returns ~0.25 at double half-life (60 days)", () => {
      expect(scoreRecency("2026-01-05T00:00:00Z", now)).toBeCloseTo(0.25, 1);
    });

    it("returns 0.0 at maxAge (365 days)", () => {
      expect(scoreRecency("2025-03-06T00:00:00Z", now)).toBe(0);
    });

    it("returns 0.0 beyond maxAge", () => {
      expect(scoreRecency("2020-01-01T00:00:00Z", now)).toBe(0);
    });

    it("returns 1.0 for future dates", () => {
      expect(scoreRecency("2027-01-01T00:00:00Z", now)).toBe(1.0);
    });

    it("returns 0.5 for undefined date", () => {
      expect(scoreRecency(undefined, now)).toBe(0.5);
    });

    it("returns 0.5 for invalid date", () => {
      expect(scoreRecency("not-a-date", now)).toBe(0.5);
    });

    it("respects custom halfLifeDays", () => {
      // 10-day half-life, 10 days ago
      expect(scoreRecency("2026-02-24T00:00:00Z", now, 10, 365)).toBeCloseTo(
        0.5,
        1,
      );
    });

    it("respects custom maxAgeDays", () => {
      // 100-day maxAge, 100 days ago should return 0
      expect(scoreRecency("2025-11-26T00:00:00Z", now, 30, 100)).toBe(0);
    });
  });

  describe("scoreOutcomeSuccess", () => {
    it("returns 0.5 for records with no outcomes", () => {
      const record = makeRecord("pattern", "foundational");
      expect(scoreOutcomeSuccess(record)).toBe(0.5);
    });

    it("returns 0.5 for records with empty outcomes array", () => {
      const record = makeRecord("pattern", "foundational", { outcomes: [] });
      expect(scoreOutcomeSuccess(record)).toBe(0.5);
    });

    it("scores all-success records high", () => {
      const record = makeRecord("pattern", "foundational", {
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      // rate=1.0, volume=2/10=0.2 → 1.0*0.9 + 0.2*0.1 = 0.92
      expect(scoreOutcomeSuccess(record)).toBeCloseTo(0.92);
    });

    it("scores all-failure records low", () => {
      const record = makeRecord("pattern", "foundational", {
        outcomes: [makeOutcome("failure"), makeOutcome("failure")],
      });
      // rate=0.0, volume=2/10=0.2 → 0*0.9 + 0.2*0.1 = 0.02
      expect(scoreOutcomeSuccess(record)).toBeCloseTo(0.02);
    });

    it("scores partial outcomes at 0.5 rate", () => {
      const record = makeRecord("pattern", "foundational", {
        outcomes: [makeOutcome("partial")],
      });
      // rate=0.5, volume=1/10=0.1 → 0.5*0.9 + 0.1*0.1 = 0.46
      expect(scoreOutcomeSuccess(record)).toBeCloseTo(0.46);
    });

    it("rewards higher application volume", () => {
      const few = makeRecord("pattern", "foundational", {
        outcomes: [makeOutcome("success")],
      });
      const many = makeRecord("pattern", "foundational", {
        outcomes: Array.from({ length: 10 }, () => makeOutcome("success")),
      });
      // few: 1.0*0.9 + 0.1*0.1 = 0.91
      // many: 1.0*0.9 + 1.0*0.1 = 1.0
      expect(scoreOutcomeSuccess(many)).toBeGreaterThan(
        scoreOutcomeSuccess(few),
      );
      expect(scoreOutcomeSuccess(many)).toBeCloseTo(1.0);
    });

    it("caps volume contribution at 10 applications", () => {
      const ten = makeRecord("pattern", "foundational", {
        outcomes: Array.from({ length: 10 }, () => makeOutcome("success")),
      });
      const twenty = makeRecord("pattern", "foundational", {
        outcomes: Array.from({ length: 20 }, () => makeOutcome("success")),
      });
      expect(scoreOutcomeSuccess(ten)).toBeCloseTo(scoreOutcomeSuccess(twenty));
    });
  });

  describe("scoreFileAffinity", () => {
    it("returns 0.5 when no context files provided", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/foo.ts"],
      });
      expect(scoreFileAffinity(record, undefined)).toBe(0.5);
    });

    it("returns 0.5 when context files is empty", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/foo.ts"],
      });
      expect(scoreFileAffinity(record, [])).toBe(0.5);
    });

    it("returns 0.5 for records without files field", () => {
      const record = makeRecord("convention", "foundational");
      expect(scoreFileAffinity(record, ["src/foo.ts"])).toBe(0.5);
    });

    it("returns 0.5 for records with empty files array", () => {
      const record = makeRecord("pattern", "foundational", { files: [] });
      expect(scoreFileAffinity(record, ["src/foo.ts"])).toBe(0.5);
    });

    it("returns 0.0 when record files don't match context", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/bar.ts"],
      });
      expect(scoreFileAffinity(record, ["src/foo.ts"])).toBe(0.0);
    });

    it("returns 1.0 when all record files match context", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/foo.ts"],
      });
      expect(scoreFileAffinity(record, ["src/foo.ts"])).toBe(1.0);
    });

    it("returns partial score when some files match", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/foo.ts", "src/bar.ts"],
      });
      // 1 of 2 match → 0.5 + 0.5 * (1/2) = 0.75
      expect(scoreFileAffinity(record, ["src/foo.ts"])).toBeCloseTo(0.75);
    });

    it("returns 1.0 when both files match", () => {
      const record = makeRecord("pattern", "foundational", {
        files: ["src/foo.ts", "src/bar.ts"],
      });
      expect(
        scoreFileAffinity(record, ["src/foo.ts", "src/bar.ts"]),
      ).toBeCloseTo(1.0);
    });
  });

  describe("computeRelevanceScore", () => {
    const now = new Date("2026-03-06T00:00:00Z");

    it("returns a score between 0 and 1", () => {
      const record = makeRecord("convention", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
      });
      const result = computeRelevanceScore(record, undefined, now);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("includes all signal values", () => {
      const record = makeRecord("convention", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
      });
      const result = computeRelevanceScore(record, undefined, now);
      expect(result.signals.type).toBeCloseTo(1.0);
      expect(result.signals.classification).toBeCloseTo(1.0);
      expect(result.signals.recency).toBeCloseTo(1.0);
      expect(result.signals.outcome).toBe(0.5);
      expect(result.signals.fileAffinity).toBe(0.5);
    });

    it("convention + foundational + fresh scores higher than reference + observational + old", () => {
      const best = makeRecord("convention", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
      });
      const worst = makeRecord("reference", "observational", {
        recorded_at: "2025-01-01T00:00:00Z",
      });
      const bestResult = computeRelevanceScore(best, undefined, now);
      const worstResult = computeRelevanceScore(worst, undefined, now);
      expect(bestResult.score).toBeGreaterThan(worstResult.score);
    });

    it("uses custom config weights", () => {
      const record = makeRecord("reference", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
      });
      // With all weight on classification, type=reference shouldn't matter
      const config = {
        ...DEFAULT_RELEVANCE_CONFIG,
        weights: {
          type: 0,
          classification: 1,
          recency: 0,
          outcome: 0,
          fileAffinity: 0,
        },
      };
      const result = computeRelevanceScore(record, undefined, now, config);
      // foundational = 1.0, and only classification has weight
      expect(result.score).toBeCloseTo(1.0);
    });

    it("file affinity boosts matching records", () => {
      const matching = makeRecord("pattern", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
        files: ["src/foo.ts"],
      });
      const nonMatching = makeRecord("pattern", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
        files: ["src/bar.ts"],
      });
      const matchResult = computeRelevanceScore(matching, ["src/foo.ts"], now);
      const noMatchResult = computeRelevanceScore(
        nonMatching,
        ["src/foo.ts"],
        now,
      );
      expect(matchResult.score).toBeGreaterThan(noMatchResult.score);
    });
  });

  describe("rankByRelevance", () => {
    const now = new Date("2026-03-06T00:00:00Z");

    it("returns records sorted by descending relevance score", () => {
      const records = [
        makeRecord("reference", "observational", {
          recorded_at: "2025-01-01T00:00:00Z",
        }),
        makeRecord("convention", "foundational", {
          recorded_at: "2026-03-06T00:00:00Z",
        }),
        makeRecord("pattern", "tactical", {
          recorded_at: "2026-02-01T00:00:00Z",
        }),
      ];

      const ranked = rankByRelevance(records, undefined, now);
      expect(ranked).toHaveLength(3);
      // Convention + foundational + fresh should be first
      expect(ranked[0].record.type).toBe("convention");
      // Scores should be in descending order
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].relevance.score).toBeGreaterThanOrEqual(
          ranked[i].relevance.score,
        );
      }
    });

    it("returns empty array for empty input", () => {
      expect(rankByRelevance([], undefined, now)).toHaveLength(0);
    });

    it("passes context files through to scoring", () => {
      const matching = makeRecord("pattern", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
        files: ["src/target.ts"],
      });
      const nonMatching = makeRecord("pattern", "foundational", {
        recorded_at: "2026-03-06T00:00:00Z",
        files: ["src/other.ts"],
      });

      const ranked = rankByRelevance(
        [nonMatching, matching],
        ["src/target.ts"],
        now,
      );
      expect(ranked[0].record).toBe(matching);
    });
  });

  describe("DEFAULT_RELEVANCE_WEIGHTS", () => {
    it("weights sum to 1.0", () => {
      const w = DEFAULT_RELEVANCE_WEIGHTS;
      const sum =
        w.type + w.classification + w.recency + w.outcome + w.fileAffinity;
      expect(sum).toBeCloseTo(1.0);
    });
  });
});
