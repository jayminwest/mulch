import { describe, expect, it } from "bun:test";
import { DEFAULT_PRIME_TIER_WEIGHTS } from "../../src/schemas/config.ts";
import type { ExpertiseRecord, Outcome } from "../../src/schemas/record.ts";
import type { ActiveContext } from "../../src/utils/git.ts";
import {
	buildSurfaceAnnotations,
	computeTrustScore,
	formatSurfaceReason,
	RECENT_AUTHORSHIP_DAYS,
	resolveTierWeights,
	type SurfaceReason,
	sortByTrust,
	whySurfaced,
} from "../../src/utils/prime-ranking.ts";

function makeConvention(over: Partial<ExpertiseRecord> = {}): ExpertiseRecord {
	return {
		type: "convention",
		content: "x",
		classification: "tactical",
		recorded_at: "2024-01-01T00:00:00Z",
		...over,
	} as ExpertiseRecord;
}

function makePattern(over: Partial<ExpertiseRecord> = {}): ExpertiseRecord {
	return {
		type: "pattern",
		name: "p",
		description: "d",
		classification: "tactical",
		recorded_at: "2024-01-01T00:00:00Z",
		...over,
	} as ExpertiseRecord;
}

function ok(extra: Partial<Outcome> = {}): Outcome {
	return { status: "success", recorded_at: "2024-01-01T00:00:00Z", ...extra };
}

const NO_CTX: ActiveContext | null = null;

describe("prime-ranking", () => {
	describe("resolveTierWeights", () => {
		it("returns the defaults when no override is supplied", () => {
			expect(resolveTierWeights()).toEqual(DEFAULT_PRIME_TIER_WEIGHTS);
			expect(resolveTierWeights(undefined)).toEqual(DEFAULT_PRIME_TIER_WEIGHTS);
		});

		it("merges partial overrides onto the defaults without mutating them", () => {
			const merged = resolveTierWeights({ tactical: 999 });
			expect(merged.tactical).toBe(999);
			expect(merged.foundational).toBe(DEFAULT_PRIME_TIER_WEIGHTS.foundational);
			expect(merged.observational).toBe(DEFAULT_PRIME_TIER_WEIGHTS.observational);
			expect(merged.star).toBe(DEFAULT_PRIME_TIER_WEIGHTS.star);
			// defaults must not be mutated
			expect(DEFAULT_PRIME_TIER_WEIGHTS.tactical).not.toBe(999);
		});

		it("accepts a full override", () => {
			const w = resolveTierWeights({ star: 1, foundational: 2, tactical: 3, observational: 4 });
			expect(w).toEqual({ star: 1, foundational: 2, tactical: 3, observational: 4 });
		});
	});

	describe("computeTrustScore", () => {
		const w = resolveTierWeights();

		it("returns tier weight when there are no outcomes", () => {
			expect(computeTrustScore(makeConvention({ classification: "foundational" }), w)).toBe(
				w.foundational,
			);
			expect(computeTrustScore(makeConvention({ classification: "tactical" }), w)).toBe(w.tactical);
			expect(computeTrustScore(makeConvention({ classification: "observational" }), w)).toBe(
				w.observational,
			);
		});

		it("adds star * confirmations on top of the tier weight", () => {
			const r = makeConvention({
				classification: "observational",
				outcomes: [ok(), ok(), ok()],
			});
			expect(computeTrustScore(r, w)).toBe(3 * w.star + w.observational);
		});

		it("counts partial outcomes as half a confirmation", () => {
			const r = makeConvention({
				classification: "tactical",
				outcomes: [ok(), { status: "partial", recorded_at: "2024-01-01T00:00:00Z" }],
			});
			expect(computeTrustScore(r, w)).toBe(1.5 * w.star + w.tactical);
		});

		it("ignores failure-only records (score == tier)", () => {
			const r = makeConvention({
				classification: "tactical",
				outcomes: [{ status: "failure", recorded_at: "2024-01-01T00:00:00Z" }],
			});
			expect(computeTrustScore(r, w)).toBe(w.tactical);
		});
	});

	describe("sortByTrust", () => {
		const w = resolveTierWeights();

		it("orders star-confirmed > foundational > tactical > observational", () => {
			const observational = makeConvention({ classification: "observational", id: "obs" });
			const tactical = makeConvention({ classification: "tactical", id: "tac" });
			const foundational = makeConvention({ classification: "foundational", id: "fnd" });
			const starred = makeConvention({
				classification: "observational",
				id: "star",
				outcomes: [ok()],
			});
			const out = sortByTrust([observational, tactical, foundational, starred], w);
			expect(out.map((r) => r.id)).toEqual(["star", "fnd", "tac", "obs"]);
		});

		it("preserves insertion order across ties (stable sort)", () => {
			const a = makeConvention({ classification: "tactical", id: "a" });
			const b = makeConvention({ classification: "tactical", id: "b" });
			const c = makeConvention({ classification: "tactical", id: "c" });
			const out = sortByTrust([a, b, c], w);
			expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
		});

		it("returns a new array and does not mutate the input", () => {
			const a = makeConvention({ classification: "tactical", id: "a" });
			const b = makeConvention({ classification: "foundational", id: "b" });
			const input = [a, b];
			const out = sortByTrust(input, w);
			expect(out).not.toBe(input);
			expect(input.map((r) => r.id)).toEqual(["a", "b"]);
			expect(out.map((r) => r.id)).toEqual(["b", "a"]);
		});

		it("handles an empty array", () => {
			expect(sortByTrust([], w)).toEqual([]);
		});
	});

	describe("whySurfaced", () => {
		it("returns universal when no context is provided and record has no anchors/stars/recency", () => {
			// Old recorded_at (well past RECENT_AUTHORSHIP_DAYS)
			const r = makeConvention({ recorded_at: "2020-01-01T00:00:00Z" });
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "universal" });
		});

		it("returns stars when record has successful outcomes", () => {
			const r = makeConvention({ outcomes: [ok(), ok()] });
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "stars", count: 2 });
		});

		it("reports half-stars for partial outcomes", () => {
			const r = makeConvention({
				outcomes: [ok(), { status: "partial", recorded_at: "2024-01-01T00:00:00Z" }],
			});
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "stars", count: 1.5 });
		});

		it("returns recent for records recorded within the recency window", () => {
			const now = new Date();
			const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
			const r = makeConvention({ recorded_at: twoDaysAgo });
			const reason = whySurfaced(r, NO_CTX);
			expect(reason.kind).toBe("recent");
			if (reason.kind === "recent") {
				expect(reason.daysAgo).toBeGreaterThanOrEqual(1);
				expect(reason.daysAgo).toBeLessThanOrEqual(2);
			}
		});

		it("returns recent with daysAgo=0 for records recorded today", () => {
			const r = makeConvention({ recorded_at: new Date().toISOString() });
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "recent", daysAgo: 0 });
		});

		it("falls through to universal once a record is older than RECENT_AUTHORSHIP_DAYS", () => {
			const old = new Date(
				Date.now() - (RECENT_AUTHORSHIP_DAYS + 1) * 24 * 60 * 60 * 1000,
			).toISOString();
			const r = makeConvention({ recorded_at: old });
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "universal" });
		});

		it("falls through to universal when recorded_at is unparseable", () => {
			const r = makeConvention({ recorded_at: "not-a-date" });
			expect(whySurfaced(r, NO_CTX)).toEqual({ kind: "universal" });
		});

		it("prefers file_match over stars / tracker / recency", () => {
			const r = makePattern({
				files: ["src/foo.ts"],
				outcomes: [ok(), ok()],
				recorded_at: new Date().toISOString(),
				evidence: { seeds: "sd-1" },
			});
			const ctx: ActiveContext = {
				changedFiles: ["src/foo.ts"],
				trackers: { seeds: "sd-1" },
			};
			expect(whySurfaced(r, ctx)).toEqual({ kind: "file_match", anchor: "src/foo.ts" });
		});

		it("matches via dir_anchors when no files match", () => {
			const r = makePattern({ dir_anchors: ["src/utils"] });
			const ctx: ActiveContext = {
				changedFiles: ["src/utils/foo.ts"],
				trackers: {},
			};
			expect(whySurfaced(r, ctx)).toEqual({ kind: "file_match", anchor: "src/utils" });
		});

		it("falls back to tracker_match when neither files nor dir_anchors match", () => {
			const r = makePattern({
				files: ["src/other.ts"],
				evidence: { seeds: "sd-42" },
			});
			const ctx: ActiveContext = {
				changedFiles: ["src/unrelated.ts"],
				trackers: { seeds: "sd-42" },
			};
			expect(whySurfaced(r, ctx)).toEqual({ kind: "tracker_match", tracker: "seeds", id: "sd-42" });
		});

		it("ignores tracker matches where the active value is an empty string", () => {
			const r = makePattern({ evidence: { seeds: "" } });
			const ctx: ActiveContext = { changedFiles: [], trackers: { seeds: "" } };
			expect(whySurfaced(r, ctx)).toEqual({ kind: "universal" });
		});

		it("ignores tracker matches where evidence value differs from the active value", () => {
			const r = makePattern({
				outcomes: [ok()],
				evidence: { gh: "100" },
			});
			const ctx: ActiveContext = { changedFiles: [], trackers: { gh: "200" } };
			// Falls through to stars (no tracker hit)
			expect(whySurfaced(r, ctx)).toEqual({ kind: "stars", count: 1 });
		});

		it("does not consider files when record has no files field (e.g. convention)", () => {
			const r = makeConvention({ outcomes: [ok()] });
			const ctx: ActiveContext = { changedFiles: ["src/anything.ts"], trackers: {} };
			expect(whySurfaced(r, ctx)).toEqual({ kind: "stars", count: 1 });
		});
	});

	describe("formatSurfaceReason", () => {
		it("formats file_match", () => {
			expect(formatSurfaceReason({ kind: "file_match", anchor: "src/x.ts" })).toBe(
				"why: file match (src/x.ts)",
			);
		});

		it("formats tracker_match", () => {
			expect(formatSurfaceReason({ kind: "tracker_match", tracker: "seeds", id: "sd-1" })).toBe(
				"why: in-progress seeds:sd-1",
			);
		});

		it("formats integer stars without a decimal", () => {
			expect(formatSurfaceReason({ kind: "stars", count: 3 })).toBe("why: ★3 confirmations");
		});

		it("formats fractional stars with one decimal", () => {
			expect(formatSurfaceReason({ kind: "stars", count: 1.5 })).toBe("why: ★1.5 confirmations");
		});

		it("formats recent with daysAgo=0 as 'recorded today'", () => {
			expect(formatSurfaceReason({ kind: "recent", daysAgo: 0 })).toBe("why: recorded today");
		});

		it("formats recent with daysAgo > 0", () => {
			expect(formatSurfaceReason({ kind: "recent", daysAgo: 3 })).toBe("why: recorded 3d ago");
		});

		it("formats universal", () => {
			expect(formatSurfaceReason({ kind: "universal" })).toBe("why: applies broadly (no anchors)");
		});

		it("covers every SurfaceReason kind (exhaustive)", () => {
			const cases: SurfaceReason[] = [
				{ kind: "file_match", anchor: "a" },
				{ kind: "tracker_match", tracker: "gh", id: "1" },
				{ kind: "stars", count: 2 },
				{ kind: "recent", daysAgo: 1 },
				{ kind: "universal" },
			];
			for (const c of cases) {
				expect(formatSurfaceReason(c).startsWith("why:")).toBe(true);
			}
		});
	});

	describe("buildSurfaceAnnotations", () => {
		it("returns an empty map for an empty record list", () => {
			expect(buildSurfaceAnnotations([], NO_CTX).size).toBe(0);
		});

		it("skips records without an id", () => {
			const r = makeConvention({ outcomes: [ok()] }); // no id
			const map = buildSurfaceAnnotations([r], NO_CTX);
			expect(map.size).toBe(0);
		});

		it("keys annotations by record id", () => {
			const r1 = makeConvention({ id: "r1", outcomes: [ok()] });
			const r2 = makeConvention({
				id: "r2",
				recorded_at: "2020-01-01T00:00:00Z",
			});
			const map = buildSurfaceAnnotations([r1, r2], NO_CTX);
			expect(map.get("r1")).toBe("why: ★1 confirmations");
			expect(map.get("r2")).toBe("why: applies broadly (no anchors)");
			expect(map.size).toBe(2);
		});

		it("uses the active context to surface file matches", () => {
			const r = makePattern({ id: "p1", files: ["src/foo.ts"] });
			const ctx: ActiveContext = { changedFiles: ["src/foo.ts"], trackers: {} };
			const map = buildSurfaceAnnotations([r], ctx);
			expect(map.get("p1")).toBe("why: file match (src/foo.ts)");
		});
	});
});
