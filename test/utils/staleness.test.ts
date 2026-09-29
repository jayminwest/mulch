import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { applyBudget } from "../../src/utils/budget.ts";
import { formatIndexLine } from "../../src/utils/format.ts";
import { findStaleRecords, STALE_CHURN_COMMITS } from "../../src/utils/staleness.ts";

const SHELF_LIFE = { tactical: 14, observational: 30 };
const DAY_MS = 86_400_000;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

async function commitFile(cwd: string, path: string, content: string): Promise<string> {
	await writeFile(join(cwd, path), content);
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", `edit ${path}`]);
	return git(cwd, ["rev-parse", "HEAD"]);
}

function convention(overrides: Partial<ExpertiseRecord> & { id: string }): ExpertiseRecord {
	return {
		type: "convention",
		content: "Some rule",
		classification: "foundational",
		recorded_at: new Date().toISOString(),
		...overrides,
	} as ExpertiseRecord;
}

function pattern(id: string, files: string[], commit: string): ExpertiseRecord {
	return {
		type: "pattern",
		name: id,
		description: "Some pattern",
		classification: "foundational",
		recorded_at: new Date(Date.now() - DAY_MS).toISOString(),
		id,
		files,
		evidence: { commit },
	} as ExpertiseRecord;
}

describe("findStaleRecords (mulch-094a)", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mulch-staleness-test-"));
		git(dir, ["init", "-q", "-b", "main"]);
		git(dir, ["config", "user.email", "test@test.com"]);
		git(dir, ["config", "user.name", "Test"]);
		git(dir, ["config", "commit.gpgsign", "false"]);
		await mkdir(join(dir, "src"), { recursive: true });
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const opts = () => ({ cwd: dir, now: new Date(), shelfLife: SHELF_LIFE });

	it("flags records whose anchors changed in enough commits since the evidence commit", async () => {
		const base = await commitFile(dir, "src/a.ts", "v0");
		await commitFile(dir, "src/b.ts", "untouched");
		for (let i = 1; i <= STALE_CHURN_COMMITS; i++) await commitFile(dir, "src/a.ts", `v${i}`);
		const stale = findStaleRecords(
			[
				pattern("mx-0001", ["src/a.ts"], base),
				pattern("mx-0002", ["src/b.ts"], base),
				pattern("mx-0003", ["src/a.ts"], base.slice(0, 7)),
			],
			opts(),
		);
		expect(stale.get("mx-0001")?.[0]?.kind).toBe("anchors_changed");
		expect(stale.get("mx-0001")?.[0]?.detail).toContain(
			`src/a.ts changed in ${STALE_CHURN_COMMITS}`,
		);
		expect(stale.has("mx-0002")).toBe(false);
		expect(stale.get("mx-0003")?.[0]?.kind).toBe("anchors_changed");
	});

	it("does not flag light churn, dir anchors below threshold, or unknown commits", async () => {
		const base = await commitFile(dir, "src/a.ts", "v0");
		await commitFile(dir, "src/a.ts", "v1");
		const dirRecord = convention({
			id: "mx-0011",
			dir_anchors: ["src"],
			evidence: { commit: base },
		});
		const stale = findStaleRecords(
			[
				pattern("mx-0010", ["src/a.ts"], base),
				dirRecord,
				pattern("mx-0012", ["src/a.ts"], "f".repeat(40)),
			],
			opts(),
		);
		expect(stale.size).toBe(0);
	});

	it("counts dir-anchor churn across files under the directory", async () => {
		const base = await commitFile(dir, "src/a.ts", "v0");
		for (let i = 1; i <= STALE_CHURN_COMMITS; i++) await commitFile(dir, `src/f${i}.ts`, "x");
		const stale = findStaleRecords(
			[convention({ id: "mx-0020", dir_anchors: ["src"], evidence: { commit: base } })],
			opts(),
		);
		expect(stale.get("mx-0020")?.[0]?.detail).toContain(`(+${STALE_CHURN_COMMITS - 1} more)`);
	});

	it("flags missing anchors and skips the git check for them", async () => {
		const base = await commitFile(dir, "src/a.ts", "v0");
		const stale = findStaleRecords([pattern("mx-0030", ["src/gone.ts"], base)], opts());
		expect(stale.get("mx-0030")).toEqual([
			{ kind: "anchors_missing", detail: "missing anchors: src/gone.ts" },
		]);
	});

	it("flags non-foundational records past shelf life only when unconfirmed", () => {
		const old = new Date(Date.now() - 40 * DAY_MS).toISOString();
		const stale = findStaleRecords(
			[
				convention({ id: "mx-0040", classification: "tactical", recorded_at: old }),
				convention({
					id: "mx-0041",
					classification: "tactical",
					recorded_at: old,
					outcomes: [{ status: "success" }],
				}),
				convention({ id: "mx-0042", classification: "foundational", recorded_at: old }),
				convention({ id: "mx-0043", classification: "tactical" }),
				{ ...convention({ id: "x", classification: "tactical", recorded_at: old }), id: undefined },
			],
			opts(),
		);
		expect([...stale.keys()]).toEqual(["mx-0040"]);
		expect(stale.get("mx-0040")?.[0]?.detail).toBe("tactical, 40d old, never confirmed");
	});

	it("degrades to local checks outside a git repo", async () => {
		const plain = await mkdtemp(join(tmpdir(), "mulch-staleness-nogit-"));
		try {
			await writeFile(join(plain, "a.ts"), "x");
			const stale = findStaleRecords([pattern("mx-0050", ["a.ts"], "abc1234")], {
				...opts(),
				cwd: plain,
			});
			expect(stale.size).toBe(0);
		} finally {
			await rm(plain, { recursive: true, force: true });
		}
	});
});

describe("stale demotion + marker (mulch-094a)", () => {
	it("ranks stale records after fresh ones within the same budget tier", () => {
		const fresh = convention({ id: "mx-0101", content: "fresh rule" });
		const stale = convention({ id: "mx-0102", content: "stale rule" });
		const failure = {
			type: "failure",
			description: "stale failure",
			resolution: "fix it",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			id: "mx-0103",
		} as ExpertiseRecord;
		const isStale = (r: ExpertiseRecord) => r.id === "mx-0102" || r.id === "mx-0103";
		const format = (r: ExpertiseRecord) => formatIndexLine(r);
		const cost = Math.ceil(format(failure).length / 4) + Math.ceil(format(fresh).length / 4);
		const { kept } = applyBudget(
			[{ domain: "cli", records: [stale, failure, fresh] }],
			cost,
			format,
			undefined,
			isStale,
		);
		// Failures still lead (tier beats staleness); the fresh convention beats the stale one.
		expect(kept[0]?.records.map((r) => r.id)).toEqual(["mx-0103", "mx-0101"]);
	});

	it("marks stale index lines with (stale?)", () => {
		const r = convention({ id: "mx-0110" });
		expect(formatIndexLine(r, true)).toEndWith(" (stale?)");
		expect(formatIndexLine(r)).not.toContain("stale?");
	});
});
