import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { getRegistry, resetRegistry } from "../../src/registry/type-registry.ts";

let tmpDir: string;

async function makeTempProject(configBody: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "mulch-disabled-"));
	await mkdir(join(dir, ".mulch", "expertise"), { recursive: true });
	await writeFile(join(dir, ".mulch", "mulch.config.yaml"), configBody, "utf-8");
	return dir;
}

afterEach(async () => {
	resetRegistry();
	if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe("disabled_types", () => {
	it("registry reports isDisabled=true but type stays in enabled() and validates", async () => {
		tmpDir = await makeTempProject(
			[
				"version: '1'",
				"domains: []",
				"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
				"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
				"disabled_types: [failure]",
				"",
			].join("\n"),
		);
		await initRegistryFromConfig(tmpDir);
		const reg = getRegistry();

		expect(reg.isDisabled("failure")).toBe(true);
		expect(reg.isDisabled("convention")).toBe(false);
		expect(reg.names()).toContain("failure");
		expect(reg.disabledNames()).toEqual(["failure"]);

		// Disabled types still pass schema validation (writes succeed).
		expect(
			reg.validator({
				type: "failure",
				description: "d",
				resolution: "r",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe(true);
	});

	it("rejects disabled_types referencing an unregistered type", async () => {
		tmpDir = await makeTempProject(
			[
				"version: '1'",
				"domains: []",
				"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
				"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
				"disabled_types: [nonexistent_type]",
				"",
			].join("\n"),
		);
		await expect(initRegistryFromConfig(tmpDir)).rejects.toThrow(
			/disabled_types references unregistered type "nonexistent_type"/,
		);
	});

	it("disabled set is empty when config omits disabled_types", async () => {
		tmpDir = await makeTempProject(
			[
				"version: '1'",
				"domains: []",
				"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
				"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
				"",
			].join("\n"),
		);
		await initRegistryFromConfig(tmpDir);
		const reg = getRegistry();
		expect(reg.disabledNames()).toEqual([]);
		expect(reg.isDisabled("failure")).toBe(false);
	});

	it("builtinDefs() and customDefs() partition by kind", async () => {
		tmpDir = await makeTempProject(
			[
				"version: '1'",
				"domains: []",
				"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
				"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
				"custom_types:",
				"  hypothesis:",
				"    required: [statement]",
				"    dedup_key: statement",
				"    summary: '{statement}'",
				"",
			].join("\n"),
		);
		await initRegistryFromConfig(tmpDir);
		const reg = getRegistry();
		expect(reg.builtinDefs().map((d) => d.name)).toEqual([
			"convention",
			"pattern",
			"failure",
			"decision",
			"reference",
			"guide",
		]);
		expect(reg.customDefs().map((d) => d.name)).toEqual(["hypothesis"]);
	});
});
