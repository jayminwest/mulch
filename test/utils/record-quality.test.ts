import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { findDuplicate, normalizeText, recordBodyText } from "../../src/utils/expertise.ts";
import { checkRecordQuality, findNearDuplicates } from "../../src/utils/record-quality.ts";

const at = "2026-01-01T00:00:00.000Z";

function convention(content: string, extra: Partial<ExpertiseRecord> = {}): ExpertiseRecord {
	return {
		type: "convention",
		content,
		classification: "tactical",
		recorded_at: at,
		...extra,
	} as ExpertiseRecord;
}

// The real pair that slipped past exact-match dedup (mx-5e6845 / mx-a36a41).
const VERSION_A =
	"cli.ts exports VERSION constant and handles --version --json early (before Commander), applies --quiet/-q early via setQuiet(). .version(VERSION, '-v, --version', 'Print version') uses short form -v. addHelpCommand(false) suppresses the default help subcommand.";
const VERSION_B =
	"cli.ts exports VERSION constant and handles --version --json early (before Commander), applies --quiet/-q early via setQuiet(). Use .version(VERSION, '-v, --version', 'Print version') for short -v flag. addHelpCommand(false) suppresses default help subcommand.";

describe("normalizeText", () => {
	it("folds case, punctuation, and whitespace runs", () => {
		expect(normalizeText("  Use X.  Always!\n")).toBe("use x always");
		expect(normalizeText("use-x, always")).toBe(normalizeText("Use X always"));
	});
});

describe("findDuplicate normalization", () => {
	it("treats case/punctuation/whitespace variants as the same convention", () => {
		const existing = [convention("Always use vitest.", { id: "mx-aaaaaa" })];
		const dup = findDuplicate(existing, convention("always  use Vitest"));
		expect(dup?.record.id).toBe("mx-aaaaaa");
	});

	it("does not match records of another type", () => {
		const existing = [convention("Always use vitest")];
		const pattern = {
			type: "pattern",
			name: "Always use vitest",
			description: "x",
			classification: "tactical",
			recorded_at: at,
		} as ExpertiseRecord;
		expect(findDuplicate(existing, pattern)).toBeNull();
	});

	describe("content_hash custom types", () => {
		let tmpDir: string;

		afterEach(async () => {
			resetRegistry();
			if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
		});

		it("dedups on the normalized body instead of never matching", async () => {
			tmpDir = await mkdtemp(join(tmpdir(), "mulch-quality-hash-"));
			await initMulchDir(tmpDir);
			await writeConfig(
				{
					...DEFAULT_CONFIG,
					custom_types: {
						hypothesis: {
							required: ["statement"],
							dedup_key: "content_hash",
							summary: "{statement}",
						},
					},
				},
				tmpDir,
			);
			await initRegistryFromConfig(tmpDir);
			const mk = (statement: string) =>
				({
					type: "hypothesis",
					statement,
					classification: "tactical",
					recorded_at: at,
				}) as unknown as ExpertiseRecord;
			expect(recordBodyText(mk("Caching helps"))).toBe("Caching helps");
			expect(findDuplicate([mk("Caching helps.")], mk("caching helps"))).not.toBeNull();
			expect(findDuplicate([mk("Caching helps")], mk("Caching hurts"))).toBeNull();
		});
	});
});

describe("findNearDuplicates", () => {
	it("flags the reworded pair that exact dedup missed", () => {
		const existing = [
			convention(VERSION_A, { id: "mx-5e6845" }),
			convention("Prefer withFileLock for every write because concurrent agents race"),
		];
		const found = findNearDuplicates(existing, convention(VERSION_B));
		expect(found).toHaveLength(1);
		expect(found[0]?.record.id).toBe("mx-5e6845");
		expect(found[0]?.similarity).toBeGreaterThan(0.6);
	});

	it("ignores unrelated records", () => {
		const existing = [convention("Prefer withFileLock for every write because agents race")];
		expect(findNearDuplicates(existing, convention(VERSION_B))).toHaveLength(0);
	});

	it("skips records the candidate supersedes", () => {
		const existing = [convention(VERSION_A, { id: "mx-5e6845" })];
		const candidate = convention(VERSION_B, { supersedes: ["mx-5e6845"] });
		expect(findNearDuplicates(existing, candidate)).toHaveLength(0);
	});

	it("uses a lower bar when records share a file anchor", () => {
		const a = "Retry the lock acquisition with backoff when the lock file is stale";
		const b = "Retry lock acquisition using jittered backoff when a stale lock file blocks writers";
		const plain = findNearDuplicates([convention(a, { id: "mx-111111" })], convention(b));
		expect(plain).toHaveLength(0);
		const anchored = findNearDuplicates(
			[convention(a, { id: "mx-111111", dir_anchors: ["src/utils"] })],
			convention(b, { dir_anchors: ["src/utils"] }),
		);
		expect(anchored).toHaveLength(1);
		expect(anchored[0]?.sharedAnchors).toEqual(["src/utils"]);
	});

	it("returns nothing for an empty candidate body", () => {
		expect(findNearDuplicates([convention("anything")], convention("a b"))).toHaveLength(0);
	});
});

describe("checkRecordQuality", () => {
	it("passes a grounded convention that states a rule", () => {
		const r = convention("Never call process.exit because tests share the process", {
			dir_anchors: ["src/commands"],
		});
		expect(checkRecordQuality(r)).toEqual([]);
	});

	it("flags conventions/patterns with no anchor or evidence", () => {
		const issues = checkRecordQuality(convention("Avoid sync fs calls because they block"));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatch(/no file\/dir anchor or evidence/);
		const pattern = {
			type: "pattern",
			name: "p",
			description: "d",
			classification: "tactical",
			recorded_at: at,
		} as ExpertiseRecord;
		expect(checkRecordQuality(pattern)[0]).toMatch(/pattern has no file\/dir anchor/);
	});

	it("does not count an auto-populated commit as evidence", () => {
		const r = convention("Avoid sync fs calls because they block", { evidence: { commit: "abc" } });
		expect(checkRecordQuality(r, { autoCommit: true })).toHaveLength(1);
		expect(checkRecordQuality(r, { autoCommit: false })).toEqual([]);
		const tracked = convention("Avoid sync fs calls because they block", {
			evidence: { commit: "abc", seeds: "mulch-a378" },
		});
		expect(checkRecordQuality(tracked, { autoCommit: true })).toEqual([]);
	});

	it("flags conventions that read like code restatement", () => {
		const r = convention("cli.ts exports VERSION", { evidence: { file: "src/cli.ts" } });
		const issues = checkRecordQuality(r);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatch(/restatement of code/);
	});

	it("leaves failure records alone", () => {
		const failure = {
			type: "failure",
			description: "Lock timeout",
			resolution: "Raise timeout",
			classification: "tactical",
			recorded_at: at,
		} as ExpertiseRecord;
		expect(checkRecordQuality(failure)).toEqual([]);
	});
});
