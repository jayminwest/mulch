import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { buildBuiltinRegistry } from "../../src/registry/builtins.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { getRegistry, resetRegistry } from "../../src/registry/type-registry.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { recordSchema } from "../../src/schemas/record-schema.ts";
import { initMulchDir, writeConfig } from "../../src/utils/config.ts";

const baseTimestamp = "2026-05-07T00:00:00Z";

describe("owner field — built-in records (R-06)", () => {
	it("validator accepts a record carrying owner", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "convention",
				content: "use bun",
				owner: "@platform-team",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(true);
	});

	it("validator accepts a record without owner (back-compat)", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "convention",
				content: "use bun",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(true);
	});

	it("validator rejects a non-string owner value", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "convention",
				content: "use bun",
				owner: 42,
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(false);
	});

	it("owner is accepted on every built-in type", () => {
		const reg = buildBuiltinRegistry();
		const variants = [
			{ type: "convention", content: "x" },
			{ type: "pattern", name: "p", description: "d" },
			{ type: "failure", description: "d", resolution: "r" },
			{ type: "decision", title: "t", rationale: "r" },
			{ type: "reference", name: "n", description: "d" },
			{ type: "guide", name: "n", description: "d" },
		];
		for (const v of variants) {
			expect(
				reg.validator({
					...v,
					owner: "@team",
					classification: "tactical",
					recorded_at: baseTimestamp,
				}),
			).toBe(true);
		}
	});
});

describe("status field — built-in records (R-06)", () => {
	it("validator accepts each live status value", () => {
		const reg = buildBuiltinRegistry();
		for (const status of ["draft", "active", "deprecated"]) {
			expect(
				reg.validator({
					type: "convention",
					content: "x",
					status,
					classification: "foundational",
					recorded_at: baseTimestamp,
				}),
			).toBe(true);
		}
	});

	it("validator rejects a status outside the enum", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "convention",
				content: "x",
				status: "wip",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(false);
	});

	it("validator rejects status: 'archived' on live records (archive bypasses AJV)", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "convention",
				content: "x",
				status: "archived",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(false);
	});
});

describe("static reference schema (record-schema.ts)", () => {
	it("oneOf branches all declare owner and the status enum", () => {
		expect(recordSchema.oneOf).toHaveLength(6);
		for (const branch of recordSchema.oneOf) {
			const props = (branch as { properties: Record<string, unknown> }).properties;
			expect(props.owner).toEqual({ type: "string" });
			expect(props.status).toEqual({
				type: "string",
				enum: ["draft", "active", "deprecated"],
			});
		}
	});

	it("static schema accepts the same owner+status combination the runtime validator does", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);
		expect(
			validate({
				type: "decision",
				title: "Adopt bun",
				rationale: "speed",
				owner: "@platform-team",
				status: "active",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(true);
		expect(
			validate({
				type: "decision",
				title: "Adopt bun",
				rationale: "speed",
				status: "archived",
				classification: "foundational",
				recorded_at: baseTimestamp,
			}),
		).toBe(false);
	});
});

describe("custom types extending built-ins inherit owner and status", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-owner-status-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("a custom type extending decision accepts owner and live status values", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						required: ["decision_status"],
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const ok = getRegistry().validator({
			type: "adr",
			title: "Adopt bun",
			rationale: "speed",
			decision_status: "accepted",
			owner: "@platform-team",
			status: "active",
			classification: "foundational",
			recorded_at: baseTimestamp,
		});
		expect(ok).toBe(true);
	});

	it("a custom type rejects status: 'archived' just like its parent", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						required: ["decision_status"],
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const ok = getRegistry().validator({
			type: "adr",
			title: "Adopt bun",
			rationale: "speed",
			decision_status: "accepted",
			status: "archived",
			classification: "foundational",
			recorded_at: baseTimestamp,
		});
		expect(ok).toBe(false);
	});
});
