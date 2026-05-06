import { describe, expect, it } from "bun:test";
import {
	assertWritableDirAnchor,
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

	it("strips a leading ./ prefix", () => {
		// Regression for mulch-c282: prior normalization left "./prefix" untouched
		// so the same anchor stored from `--dir-anchor src/foo` and
		// `--dir-anchor ./src/foo` lived in two different equivalence classes
		// and missed each other in dedup / containment checks.
		expect(normalizeDirAnchor("./src/foo")).toBe("src/foo");
		expect(normalizeDirAnchor("./src/foo/")).toBe("src/foo");
	});
});

describe("assertWritableDirAnchor", () => {
	it("accepts repo-root-relative paths", () => {
		expect(() => assertWritableDirAnchor("src/utils")).not.toThrow();
		expect(() => assertWritableDirAnchor("./src/utils")).not.toThrow();
		expect(() => assertWritableDirAnchor("")).not.toThrow();
		expect(() => assertWritableDirAnchor("a/b/c/d")).not.toThrow();
	});

	it("rejects POSIX absolute paths", () => {
		expect(() => assertWritableDirAnchor("/etc/passwd")).toThrow(/absolute path/);
		expect(() => assertWritableDirAnchor("/")).toThrow(/absolute path/);
	});

	it("rejects Windows absolute paths", () => {
		expect(() => assertWritableDirAnchor("C:\\Users\\me")).toThrow(/absolute path/);
		expect(() => assertWritableDirAnchor("D:/repo/src")).toThrow(/absolute path/);
		expect(() => assertWritableDirAnchor("\\\\server\\share")).toThrow(/absolute path/);
	});

	it("rejects parent-traversal segments", () => {
		expect(() => assertWritableDirAnchor("..")).toThrow(/parent traversal/);
		expect(() => assertWritableDirAnchor("../parent")).toThrow(/parent traversal/);
		expect(() => assertWritableDirAnchor("src/../sibling")).toThrow(/parent traversal/);
		expect(() => assertWritableDirAnchor("a/b/../c")).toThrow(/parent traversal/);
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
