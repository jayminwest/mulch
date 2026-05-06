import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeRecords } from "../../src/commands/compact.ts";
import { matchFilesToDomains } from "../../src/commands/learn.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import type { CustomTypeConfig } from "../../src/schemas/config.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import {
	appendRecord,
	createExpertiseFile,
	findDuplicate,
	readExpertiseFile,
} from "../../src/utils/expertise.ts";

const HYPOTHESIS_CFG: CustomTypeConfig = {
	required: ["statement", "prediction"],
	optional: ["evidence_source"],
	dedup_key: "statement",
	id_key: "statement",
	summary: "{statement} -> {prediction}",
	compact: "merge_outcomes",
	section_title: "Hypotheses",
};

const RUNBOOK_CFG: CustomTypeConfig = {
	required: ["title", "steps"],
	optional: ["files"],
	dedup_key: "title",
	id_key: "title",
	summary: "{title}",
	extracts_files: true,
	files_field: "files",
	compact: "concat",
	section_title: "Runbooks",
};

describe("custom_types end-to-end", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-custom-e2e-"));
		await initMulchDir(tmpDir);
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { research: {} },
				custom_types: { hypothesis: HYPOTHESIS_CFG, runbook: RUNBOOK_CFG },
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("registry sees both built-ins and declared custom types", async () => {
		const { getRegistry } = await import("../../src/registry/type-registry.ts");
		const reg = getRegistry();
		expect(reg.names()).toContain("convention");
		expect(reg.names()).toContain("hypothesis");
		expect(reg.names()).toContain("runbook");
		expect(reg.get("hypothesis")?.kind).toBe("custom");
	});

	it("validator accepts a well-formed custom-type record", async () => {
		const { getRegistry } = await import("../../src/registry/type-registry.ts");
		const validator = getRegistry().validator;
		const ok = validator({
			type: "hypothesis",
			statement: "rain forecast",
			prediction: "tomorrow",
			classification: "tactical",
			recorded_at: "2026-05-04T00:00:00Z",
		});
		expect(ok).toBe(true);
	});

	it("validator rejects a custom-type record missing required fields", async () => {
		const { getRegistry } = await import("../../src/registry/type-registry.ts");
		const validator = getRegistry().validator;
		const ok = validator({
			type: "hypothesis",
			statement: "rain forecast",
			classification: "tactical",
			recorded_at: "2026-05-04T00:00:00Z",
		});
		expect(ok).toBe(false);
	});

	it("validator rejects unknown fields not declared in required/optional", async () => {
		const { getRegistry } = await import("../../src/registry/type-registry.ts");
		const validator = getRegistry().validator;
		const ok = validator({
			type: "hypothesis",
			statement: "rain forecast",
			prediction: "tomorrow",
			confidence: 0.9, // not declared
			classification: "tactical",
			recorded_at: "2026-05-04T00:00:00Z",
		});
		expect(ok).toBe(false);
	});

	it("dedup matches by configured dedup_key", async () => {
		const filePath = getExpertisePath("research", tmpDir);
		await createExpertiseFile(filePath);
		const r1 = {
			type: "hypothesis",
			statement: "X causes Y",
			prediction: "Y will happen",
			classification: "tactical",
			recorded_at: "2026-05-04T00:00:00Z",
		} as unknown as ExpertiseRecord;
		await appendRecord(filePath, r1);

		const existing = await readExpertiseFile(filePath);
		const dup = findDuplicate(existing, {
			...r1,
			prediction: "Y might not happen",
		} as unknown as ExpertiseRecord);
		expect(dup).not.toBeNull();
		expect(dup?.index).toBe(0);
	});

	it("learn extracts files from custom types declaring extracts_files: true", async () => {
		const filePath = getExpertisePath("research", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "runbook",
			title: "Deploy",
			steps: "1. ssh\n2. pull",
			files: ["deploy.sh"],
			classification: "tactical",
			recorded_at: "2026-05-04T00:00:00Z",
		} as unknown as ExpertiseRecord);

		const { matches } = await matchFilesToDomains(["deploy.sh"], tmpDir);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.domain).toBe("research");
	});

	it("compact merge_outcomes combines outcomes for same id_key", () => {
		const records: ExpertiseRecord[] = [
			{
				type: "hypothesis",
				statement: "X causes Y",
				prediction: "Y will happen",
				classification: "tactical",
				recorded_at: "2026-05-01T00:00:00Z",
				outcomes: [{ status: "success" }],
			} as unknown as ExpertiseRecord,
			{
				type: "hypothesis",
				statement: "X causes Y",
				prediction: "Y will happen",
				classification: "tactical",
				recorded_at: "2026-05-02T00:00:00Z",
				outcomes: [{ status: "failure" }],
			} as unknown as ExpertiseRecord,
		];
		const merged = mergeRecords(records);
		expect((merged as { type: string }).type).toBe("hypothesis");
		expect(merged.outcomes?.length).toBe(2);
		expect(merged.outcomes?.[0]?.status).toBe("success");
		expect(merged.outcomes?.[1]?.status).toBe("failure");
		expect(merged.supersedes?.length ?? 0).toBe(0); // no ids set, so empty
	});

	it("compact concat for runbook joins steps and picks longest title", () => {
		const records: ExpertiseRecord[] = [
			{
				type: "runbook",
				title: "Short",
				steps: "step a",
				classification: "tactical",
				recorded_at: "2026-05-01T00:00:00Z",
			} as unknown as ExpertiseRecord,
			{
				type: "runbook",
				title: "Much Longer Title",
				steps: "step b",
				classification: "tactical",
				recorded_at: "2026-05-02T00:00:00Z",
			} as unknown as ExpertiseRecord,
		];
		const merged = mergeRecords(records) as unknown as Record<string, unknown>;
		expect(merged.title).toBe("Much Longer Title");
		expect(merged.steps).toBe("step a\n\nstep b");
	});

	it("compact strategy 'manual' refuses to auto-compact", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { research: {} },
				custom_types: {
					adr: {
						required: ["title", "decision"],
						dedup_key: "title",
						summary: "{title}",
						compact: "manual",
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const records: ExpertiseRecord[] = [
			{
				type: "adr",
				title: "Use bun",
				decision: "yes",
				classification: "foundational",
				recorded_at: "2026-05-01T00:00:00Z",
			} as unknown as ExpertiseRecord,
			{
				type: "adr",
				title: "Use bun",
				decision: "still yes",
				classification: "foundational",
				recorded_at: "2026-05-02T00:00:00Z",
			} as unknown as ExpertiseRecord,
		];
		expect(() => mergeRecords(records)).toThrow(/manual/);
	});

	it("config validation rejects shadowing built-in at registry init", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { research: {} },
				custom_types: {
					pattern: {
						required: ["x"],
						dedup_key: "x",
						summary: "{x}",
					},
				},
			},
			tmpDir,
		);
		expect(initRegistryFromConfig(tmpDir)).rejects.toThrow(/shadows a built-in/);
	});
});
