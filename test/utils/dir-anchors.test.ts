import { describe, expect, it } from "bun:test";
import {
	fileLivesUnderDir,
	inferDirAnchors,
	normalizeDirAnchor,
} from "../../src/utils/dir-anchors.ts";

describe("normalizeDirAnchor", () => {
	it("strips trailing slash", () => {
		expect(normalizeDirAnchor("src/utils/")).toBe("src/utils");
	});

	it("collapses repo root markers", () => {
		expect(normalizeDirAnchor(".")).toBe("");
		expect(normalizeDirAnchor("./")).toBe("");
		expect(normalizeDirAnchor("")).toBe("");
	});

	it("converts backslashes to POSIX separators", () => {
		expect(normalizeDirAnchor("src\\utils")).toBe("src/utils");
	});
});

describe("fileLivesUnderDir", () => {
	it("matches direct children", () => {
		expect(fileLivesUnderDir("src/utils/foo.ts", "src/utils")).toBe(true);
	});

	it("matches nested descendants", () => {
		expect(fileLivesUnderDir("src/utils/sub/bar.ts", "src/utils")).toBe(true);
	});

	it("rejects sibling directories with shared prefix", () => {
		// "src/util" must NOT match "src/utils/foo.ts" — boundary check.
		expect(fileLivesUnderDir("src/utils/foo.ts", "src/util")).toBe(false);
	});

	it("tolerates stored trailing slash", () => {
		expect(fileLivesUnderDir("src/utils/foo.ts", "src/utils/")).toBe(true);
	});

	it("repo root anchor matches everything", () => {
		expect(fileLivesUnderDir("anywhere/foo.ts", "")).toBe(true);
	});
});

describe("inferDirAnchors", () => {
	it("returns dirs that parent 3+ files (default threshold)", () => {
		const dirs = inferDirAnchors([
			"src/utils/a.ts",
			"src/utils/b.ts",
			"src/utils/c.ts",
			"src/cli.ts",
		]);
		expect(dirs).toEqual(["src/utils"]);
	});

	it("returns nothing when no parent dir reaches threshold", () => {
		const dirs = inferDirAnchors(["src/utils/a.ts", "src/utils/b.ts", "src/cli.ts"]);
		expect(dirs).toEqual([]);
	});

	it("ignores files at the repo root (no parent dir)", () => {
		const dirs = inferDirAnchors(["a.ts", "b.ts", "c.ts"]);
		expect(dirs).toEqual([]);
	});

	it("supports a custom threshold", () => {
		const dirs = inferDirAnchors(["src/x/a.ts", "src/x/b.ts"], 2);
		expect(dirs).toEqual(["src/x"]);
	});

	it("only counts the immediate parent directory of each file", () => {
		// 3 files at src/x/a.ts but distributed across src/x/{sub1,sub2,sub3}
		// don't share a single immediate parent → no anchor.
		const dirs = inferDirAnchors(["src/x/sub1/a.ts", "src/x/sub2/b.ts", "src/x/sub3/c.ts"]);
		expect(dirs).toEqual([]);
	});
});
