import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
	computeAnchorValidity,
	getRecordAnchors,
	passedAnchorGrace,
} from "../../src/utils/anchor-validity.ts";

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

function makeConvention(over: Partial<ExpertiseRecord> = {}): ExpertiseRecord {
	return {
		type: "convention",
		content: "x",
		classification: "tactical",
		recorded_at: "2024-01-01T00:00:00Z",
		...over,
	} as ExpertiseRecord;
}

describe("getRecordAnchors", () => {
	it("returns empty array when record has no anchors", () => {
		expect(getRecordAnchors(makeConvention())).toEqual([]);
	});

	it("extracts typed files[] as file anchors", () => {
		const anchors = getRecordAnchors(makePattern({ files: ["src/a.ts", "src/b.ts"] }));
		expect(anchors).toEqual([
			{ kind: "file", path: "src/a.ts" },
			{ kind: "file", path: "src/b.ts" },
		]);
	});

	it("extracts dir_anchors[] as dir anchors", () => {
		const anchors = getRecordAnchors(makeConvention({ dir_anchors: ["src/", "test/"] }));
		expect(anchors).toEqual([
			{ kind: "dir", path: "src/" },
			{ kind: "dir", path: "test/" },
		]);
	});

	it("extracts evidence.file as evidence_file anchor", () => {
		const anchors = getRecordAnchors(makeConvention({ evidence: { file: "src/foo.ts" } }));
		expect(anchors).toEqual([{ kind: "evidence_file", path: "src/foo.ts" }]);
	});

	it("combines files, dir_anchors, and evidence.file in order", () => {
		const anchors = getRecordAnchors(
			makePattern({
				files: ["src/a.ts"],
				dir_anchors: ["test/"],
				evidence: { file: "docs/x.md" },
			}),
		);
		expect(anchors).toEqual([
			{ kind: "file", path: "src/a.ts" },
			{ kind: "dir", path: "test/" },
			{ kind: "evidence_file", path: "docs/x.md" },
		]);
	});

	it("skips empty-string and non-string entries in files[]", () => {
		const anchors = getRecordAnchors(
			makePattern({ files: ["", "src/a.ts", 42 as unknown as string] }),
		);
		expect(anchors).toEqual([{ kind: "file", path: "src/a.ts" }]);
	});

	it("skips empty-string and non-string entries in dir_anchors[]", () => {
		const anchors = getRecordAnchors(
			makeConvention({ dir_anchors: ["", "src/", null as unknown as string] }),
		);
		expect(anchors).toEqual([{ kind: "dir", path: "src/" }]);
	});

	it("ignores evidence without a file field", () => {
		const anchors = getRecordAnchors(makeConvention({ evidence: { commit: "abc123" } }));
		expect(anchors).toEqual([]);
	});

	it("ignores non-array files / dir_anchors", () => {
		const anchors = getRecordAnchors(
			makePattern({
				files: "src/a.ts" as unknown as string[],
				dir_anchors: "src/" as unknown as string[],
			}),
		);
		expect(anchors).toEqual([]);
	});
});

describe("computeAnchorValidity", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "anchor-validity-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("returns validFraction null when record has zero anchors", () => {
		const v = computeAnchorValidity(makeConvention(), root);
		expect(v).toEqual({ total: 0, valid: 0, broken: [], validFraction: null });
	});

	it("returns 1.0 when every anchor resolves", () => {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "a.ts"), "");
		writeFileSync(join(root, "src", "b.ts"), "");
		const v = computeAnchorValidity(
			makePattern({ files: ["src/a.ts", "src/b.ts"], dir_anchors: ["src/"] }),
			root,
		);
		expect(v.total).toBe(3);
		expect(v.valid).toBe(3);
		expect(v.broken).toEqual([]);
		expect(v.validFraction).toBe(1);
	});

	it("returns 0 and lists every anchor as broken when none resolve", () => {
		const v = computeAnchorValidity(
			makePattern({ files: ["src/missing.ts"], dir_anchors: ["nope/"] }),
			root,
		);
		expect(v.total).toBe(2);
		expect(v.valid).toBe(0);
		expect(v.broken).toEqual([
			{ kind: "file", path: "src/missing.ts" },
			{ kind: "dir", path: "nope/" },
		]);
		expect(v.validFraction).toBe(0);
	});

	it("computes partial validity and reports only broken anchors", () => {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "a.ts"), "");
		const v = computeAnchorValidity(
			makePattern({
				files: ["src/a.ts", "src/missing.ts"],
				dir_anchors: ["src/", "absent/"],
			}),
			root,
		);
		expect(v.total).toBe(4);
		expect(v.valid).toBe(2);
		expect(v.broken).toEqual([
			{ kind: "file", path: "src/missing.ts" },
			{ kind: "dir", path: "absent/" },
		]);
		expect(v.validFraction).toBe(0.5);
	});

	it("resolves evidence.file relative to projectRoot", () => {
		writeFileSync(join(root, "found.ts"), "");
		const v = computeAnchorValidity(makeConvention({ evidence: { file: "found.ts" } }), root);
		expect(v.valid).toBe(1);
		expect(v.broken).toEqual([]);
		expect(v.validFraction).toBe(1);

		const v2 = computeAnchorValidity(makeConvention({ evidence: { file: "missing.ts" } }), root);
		expect(v2.valid).toBe(0);
		expect(v2.broken).toEqual([{ kind: "evidence_file", path: "missing.ts" }]);
		expect(v2.validFraction).toBe(0);
	});
});

describe("passedAnchorGrace", () => {
	it("returns false when record age is exactly the grace period", () => {
		const recorded = "2024-01-01T00:00:00Z";
		const now = new Date("2024-01-08T00:00:00Z"); // 7 days later
		expect(passedAnchorGrace(makeConvention({ recorded_at: recorded }), now, 7)).toBe(false);
	});

	it("returns false when record is younger than grace period", () => {
		const now = new Date("2024-01-04T00:00:00Z");
		expect(passedAnchorGrace(makeConvention({ recorded_at: "2024-01-01T00:00:00Z" }), now, 7)).toBe(
			false,
		);
	});

	it("returns true when record is older than grace period", () => {
		const now = new Date("2024-01-10T00:00:00Z");
		expect(passedAnchorGrace(makeConvention({ recorded_at: "2024-01-01T00:00:00Z" }), now, 7)).toBe(
			true,
		);
	});

	it("treats graceDays=0 as 'any non-zero age passes'", () => {
		const recorded = "2024-01-01T00:00:00Z";
		expect(
			passedAnchorGrace(makeConvention({ recorded_at: recorded }), new Date(recorded), 0),
		).toBe(false);
		expect(
			passedAnchorGrace(
				makeConvention({ recorded_at: recorded }),
				new Date("2024-01-01T00:00:01Z"),
				0,
			),
		).toBe(true);
	});

	it("handles sub-day comparisons via fractional days", () => {
		const recorded = "2024-01-01T00:00:00Z";
		const halfDayLater = new Date("2024-01-01T12:00:00Z");
		expect(passedAnchorGrace(makeConvention({ recorded_at: recorded }), halfDayLater, 1)).toBe(
			false,
		);
		const dayAndHalf = new Date("2024-01-02T12:00:00Z");
		expect(passedAnchorGrace(makeConvention({ recorded_at: recorded }), dayAndHalf, 1)).toBe(true);
	});
});
