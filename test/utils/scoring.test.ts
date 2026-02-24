import { describe, expect, it } from "bun:test";
import {
  type Outcome,
  type ScoredRecord,
  applyConfirmationBoost,
  computeConfirmationScore,
  getFailureCount,
  getSuccessCount,
  getSuccessRate,
  getTotalApplications,
  sortByConfirmationScore,
} from "../../src/utils/scoring.ts";

// Helpers for building test records
function makePattern(overrides: Partial<ScoredRecord> = {}): ScoredRecord {
  return {
    type: "pattern",
    name: "test-pattern",
    description: "A test pattern",
    classification: "foundational",
    recorded_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOutcome(
  status: Outcome["status"],
  extra: Partial<Outcome> = {},
): Outcome {
  return {
    status,
    recorded_at: "2024-01-01T00:00:00Z",
    ...extra,
  };
}

describe("scoring", () => {
  describe("getSuccessCount", () => {
    it("returns 0 for record with no outcomes", () => {
      expect(getSuccessCount(makePattern())).toBe(0);
    });

    it("returns 0 for record with empty outcomes array", () => {
      expect(getSuccessCount(makePattern({ outcomes: [] }))).toBe(0);
    });

    it("counts only success outcomes", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("failure"),
          makeOutcome("partial"),
        ],
      });
      expect(getSuccessCount(record)).toBe(2);
    });

    it("returns 0 when all outcomes are failures", () => {
      const record = makePattern({
        outcomes: [makeOutcome("failure"), makeOutcome("failure")],
      });
      expect(getSuccessCount(record)).toBe(0);
    });

    it("returns full count when all outcomes are successes", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      expect(getSuccessCount(record)).toBe(3);
    });
  });

  describe("getFailureCount", () => {
    it("returns 0 for record with no outcomes", () => {
      expect(getFailureCount(makePattern())).toBe(0);
    });

    it("returns 0 for record with empty outcomes array", () => {
      expect(getFailureCount(makePattern({ outcomes: [] }))).toBe(0);
    });

    it("counts only failure outcomes", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("failure"),
          makeOutcome("failure"),
          makeOutcome("partial"),
        ],
      });
      expect(getFailureCount(record)).toBe(2);
    });

    it("returns 0 when all outcomes are successes", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      expect(getFailureCount(record)).toBe(0);
    });
  });

  describe("getTotalApplications", () => {
    it("returns 0 for record with no outcomes", () => {
      expect(getTotalApplications(makePattern())).toBe(0);
    });

    it("returns 0 for empty outcomes array", () => {
      expect(getTotalApplications(makePattern({ outcomes: [] }))).toBe(0);
    });

    it("returns total count across all statuses", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("failure"),
          makeOutcome("partial"),
        ],
      });
      expect(getTotalApplications(record)).toBe(3);
    });
  });

  describe("getSuccessRate", () => {
    it("returns 0 for record with no outcomes", () => {
      expect(getSuccessRate(makePattern())).toBe(0);
    });

    it("returns 0 for empty outcomes array", () => {
      expect(getSuccessRate(makePattern({ outcomes: [] }))).toBe(0);
    });

    it("returns 1.0 when all outcomes are successes", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      expect(getSuccessRate(record)).toBe(1.0);
    });

    it("returns 0 when all outcomes are failures", () => {
      const record = makePattern({
        outcomes: [makeOutcome("failure"), makeOutcome("failure")],
      });
      expect(getSuccessRate(record)).toBe(0);
    });

    it("returns 0.5 for one success and one failure", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("failure")],
      });
      expect(getSuccessRate(record)).toBe(0.5);
    });

    it("counts partial outcomes as 0.5 success", () => {
      // 1 success + 1 partial (0.5) out of 2 = 0.75
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("partial")],
      });
      expect(getSuccessRate(record)).toBe(0.75);
    });

    it("handles mixed outcomes correctly", () => {
      // 2 success (2.0) + 2 partial (1.0) + 1 failure (0) = 3.0 out of 5
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("partial"),
          makeOutcome("partial"),
          makeOutcome("failure"),
        ],
      });
      expect(getSuccessRate(record)).toBe(0.6);
    });
  });

  describe("computeConfirmationScore", () => {
    it("returns 0 for record with no outcomes", () => {
      expect(computeConfirmationScore(makePattern())).toBe(0);
    });

    it("returns 0 for empty outcomes array", () => {
      expect(computeConfirmationScore(makePattern({ outcomes: [] }))).toBe(0);
    });

    it("returns 0 when all outcomes are failures", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("failure"),
          makeOutcome("failure"),
          makeOutcome("failure"),
        ],
      });
      expect(computeConfirmationScore(record)).toBe(0);
    });

    it("returns success count for all-success records", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      expect(computeConfirmationScore(record)).toBe(3);
    });

    it("counts partial outcomes as 0.5", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("partial")],
      });
      expect(computeConfirmationScore(record)).toBe(1.5);
    });

    it("score equals success count when no partials", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("failure"),
        ],
      });
      expect(computeConfirmationScore(record)).toBe(2);
    });

    it("records with more successes score higher than fewer successes", () => {
      const highConfirm = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      const lowConfirm = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("failure")],
      });
      expect(computeConfirmationScore(highConfirm)).toBeGreaterThan(
        computeConfirmationScore(lowConfirm),
      );
    });
  });

  describe("applyConfirmationBoost", () => {
    it("returns base score unchanged when record has no outcomes", () => {
      const record = makePattern();
      expect(applyConfirmationBoost(2.5, record)).toBe(2.5);
    });

    it("returns base score unchanged when record has no successes", () => {
      const record = makePattern({
        outcomes: [makeOutcome("failure"), makeOutcome("failure")],
      });
      expect(applyConfirmationBoost(2.5, record)).toBe(2.5);
    });

    it("boosts score for record with successes", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      const boosted = applyConfirmationBoost(2.5, record);
      expect(boosted).toBeGreaterThan(2.5);
    });

    it("uses default boost factor of 0.1", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      // score = 2, boost = 1 + 0.1 * 2 = 1.2, result = 2.5 * 1.2 = 3.0
      expect(applyConfirmationBoost(2.5, record)).toBeCloseTo(3.0);
    });

    it("respects custom boost factor", () => {
      const record = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      // score = 2, boost = 1 + 0.5 * 2 = 2.0, result = 2.5 * 2.0 = 5.0
      expect(applyConfirmationBoost(2.5, record, 0.5)).toBeCloseTo(5.0);
    });

    it("larger confirmation score produces larger boost", () => {
      const manySuccesses = makePattern({
        outcomes: Array.from({ length: 10 }, () => makeOutcome("success")),
      });
      const fewSuccesses = makePattern({
        outcomes: [makeOutcome("success")],
      });
      const baseScore = 1.0;
      expect(applyConfirmationBoost(baseScore, manySuccesses)).toBeGreaterThan(
        applyConfirmationBoost(baseScore, fewSuccesses),
      );
    });

    it("boost factor of 0 returns base score unchanged", () => {
      const record = makePattern({
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      expect(applyConfirmationBoost(2.5, record, 0)).toBe(2.5);
    });
  });

  describe("sortByConfirmationScore", () => {
    it("returns empty array for empty input", () => {
      expect(sortByConfirmationScore([])).toEqual([]);
    });

    it("returns single record unchanged", () => {
      const record = makePattern();
      const result = sortByConfirmationScore([record]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(record);
    });

    it("sorts records by confirmation score descending", () => {
      const noOutcomes = makePattern({ name: "no-outcomes" });
      const oneSuccess = makePattern({
        name: "one-success",
        outcomes: [makeOutcome("success")],
      });
      const manySuccesses = makePattern({
        name: "many-successes",
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });

      const sorted = sortByConfirmationScore([
        noOutcomes,
        oneSuccess,
        manySuccesses,
      ]);

      expect(
        sorted[0].type === "pattern" && (sorted[0] as { name: string }).name,
      ).toBe("many-successes");
      expect(
        sorted[1].type === "pattern" && (sorted[1] as { name: string }).name,
      ).toBe("one-success");
      expect(
        sorted[2].type === "pattern" && (sorted[2] as { name: string }).name,
      ).toBe("no-outcomes");
    });

    it("records with no outcomes sort to the end", () => {
      const withSuccess = makePattern({
        name: "with-success",
        outcomes: [makeOutcome("success")],
      });
      const noOutcomes1 = makePattern({ name: "no-outcomes-1" });
      const noOutcomes2 = makePattern({ name: "no-outcomes-2" });

      const sorted = sortByConfirmationScore([
        noOutcomes1,
        withSuccess,
        noOutcomes2,
      ]);

      expect(
        sorted[0].type === "pattern" && (sorted[0] as { name: string }).name,
      ).toBe("with-success");
    });

    it("does not mutate the original array", () => {
      const records = [
        makePattern({ name: "b", outcomes: [makeOutcome("success")] }),
        makePattern({
          name: "a",
          outcomes: [makeOutcome("success"), makeOutcome("success")],
        }),
      ];
      const original = [...records];
      sortByConfirmationScore(records);
      expect(records[0]).toBe(original[0]);
      expect(records[1]).toBe(original[1]);
    });

    it("preserves type information on sorted records", () => {
      const convention: ScoredRecord = {
        type: "convention",
        content: "Use semicolons",
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
        outcomes: [makeOutcome("success")],
      };
      const pattern = makePattern({
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const sorted = sortByConfirmationScore([convention, pattern]);
      expect(sorted[0].type).toBe("pattern");
      expect(sorted[1].type).toBe("convention");
    });

    it("handles records with mixed outcome types", () => {
      const reliable = makePattern({
        name: "reliable",
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("failure"),
        ],
      });
      const unreliable = makePattern({
        name: "unreliable",
        outcomes: [
          makeOutcome("success"),
          makeOutcome("failure"),
          makeOutcome("failure"),
          makeOutcome("failure"),
        ],
      });

      const sorted = sortByConfirmationScore([unreliable, reliable]);

      // reliable has 3 successes vs unreliable's 1, so reliable comes first
      expect(
        sorted[0].type === "pattern" && (sorted[0] as { name: string }).name,
      ).toBe("reliable");
    });
  });
});
