// `--description` as the primary text for every built-in type (mulch-7164).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { readExpertiseFile } from "../../src/utils/expertise.ts";
import {
	applyDescriptionDefaults,
	deriveName,
	deriveTitle,
	deriveUniqueName,
} from "../../src/utils/record-flags.ts";

const cliPath = resolve(process.cwd(), "src/cli.ts");
const BUILTIN = (name: string) => ({ name, kind: "builtin" });

describe("applyDescriptionDefaults", () => {
	it("derives names and titles", () => {
		expect(deriveName("Use withFileLock for every JSONL write, always!")).toBe(
			"use-withfilelock-for-every-jsonl-write",
		);
		expect(deriveName("!!!")).toBe("record");
		expect(deriveTitle("Chose Bun. Node was slower.")).toBe("Chose Bun.");
		expect(deriveTitle("x".repeat(100))).toBe(`${"x".repeat(77)}...`);
	});

	it("derived names carry a content hash so shared leading words do not collide", () => {
		const a = deriveUniqueName("Use withFileLock for every JSONL write in record.ts");
		const b = deriveUniqueName("Use withFileLock for every JSONL write in prune.ts");
		expect(a).not.toBe(b);
		expect(a.startsWith("use-withfilelock-for-every-jsonl-write-")).toBe(true);
		expect(deriveUniqueName("same text")).toBe(deriveUniqueName("same text"));
		expect(deriveUniqueName("word ".repeat(40)).length).toBeLessThanOrEqual(60);
	});

	it("fills only missing fields; explicit flags win", () => {
		const d = { description: "Pick A over B. B leaks." };
		expect(applyDescriptionDefaults(BUILTIN("decision"), undefined, d)).toMatchObject({
			title: "Pick A over B.",
			rationale: "Pick A over B. B leaks.",
		});
		expect(
			applyDescriptionDefaults(BUILTIN("decision"), undefined, { ...d, title: "Mine" }).title,
		).toBe("Mine");
		expect(applyDescriptionDefaults(BUILTIN("convention"), undefined, d).content).toBe(
			d.description,
		);
		// Positional content already feeds convention.content; leave it alone.
		expect(applyDescriptionDefaults(BUILTIN("convention"), "pos", d).content).toBeUndefined();
		expect(applyDescriptionDefaults(BUILTIN("guide"), "How to ship", {}).name).toMatch(
			/^how-to-ship-[0-9a-f]{6}$/,
		);
		expect(applyDescriptionDefaults(BUILTIN("guide"), "x", { name: "mine" }).name).toBe("mine");
		expect(applyDescriptionDefaults(BUILTIN("failure"), undefined, d)).toEqual(d);
		expect(applyDescriptionDefaults({ name: "x", kind: "custom" }, undefined, d)).toEqual(d);
		expect(applyDescriptionDefaults(BUILTIN("pattern"), undefined, {})).toEqual({});
	});
});

describe("ml record --description for every type", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-desc-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	function record(...args: string[]) {
		return spawnSync("bun", [cliPath, "record", "cli", ...args], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 8000,
		});
	}

	it("records convention, pattern, and decision from --description alone", async () => {
		const texts: Record<string, string> = {
			convention: "Prefer tabs because the formatter enforces them.",
			pattern: "Wrap every JSONL write in withFileLock",
			decision: "Chose Bun over Node. Startup time matters for hooks.",
		};
		for (const [type, text] of Object.entries(texts)) {
			expect(record("--type", type, "--description", text).status).toBe(0);
		}
		const recs = (await readExpertiseFile(getExpertisePath("cli", tmpDir))) as unknown as Array<
			Record<string, unknown>
		>;
		expect(recs.map((r) => r.type)).toEqual(["convention", "pattern", "decision"]);
		expect(recs[0]?.content).toBe(texts.convention);
		expect(recs[1]?.name).toMatch(/^wrap-every-jsonl-write-in-withfilelock-[0-9a-f]{6}$/);
		expect(recs[2]?.title).toBe("Chose Bun over Node.");
		expect(recs[2]?.rationale).toBe(texts.decision);
	});

	it("does not upsert-merge distinct records whose derived names share leading words", async () => {
		const a = "Use withFileLock for every JSONL write in record.ts";
		const b = "Use withFileLock for every JSONL write in prune.ts";
		expect(record("--type", "pattern", "--description", a).status).toBe(0);
		// Without the hash the second write silently upserted over the first.
		// Now the names differ, so the near-dup guard (mulch-a378) speaks up...
		const dup = record("--type", "pattern", "--description", b);
		expect(dup.status).toBe(1);
		expect(dup.stderr).toContain("similar record(s) already exist");
		// ...and --force records both as distinct records.
		expect(record("--type", "pattern", "--description", b, "--force").status).toBe(0);
		const recs = (await readExpertiseFile(getExpertisePath("cli", tmpDir))) as unknown as Array<
			Record<string, unknown>
		>;
		expect(recs).toHaveLength(2);
		expect(recs.map((r) => r.description)).toEqual([a, b]);
	});

	it("explicit --name keeps upsert semantics", async () => {
		expect(record("--type", "pattern", "--name", "lock", "--description", "first").status).toBe(0);
		expect(record("--type", "pattern", "--name", "lock", "--description", "second").status).toBe(0);
		const recs = (await readExpertiseFile(getExpertisePath("cli", tmpDir))) as unknown as Array<
			Record<string, unknown>
		>;
		expect(recs).toHaveLength(1);
	});

	it("still requires --resolution for failures", () => {
		const r = record("--type", "failure", "--description", "It broke");
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("--resolution");
	});
});
