import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MulchConfig } from "../../src/schemas/config.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getConfigPath, initMulchDir, readConfig, writeConfig } from "../../src/utils/config.ts";

describe("DomainConfig allowed_types", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-domain-cfg-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("round-trips allowed_types via writeConfig + readConfig", async () => {
		const cfg: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: {
				backend: { allowed_types: ["convention", "pattern"] },
				frontend: { allowed_types: ["convention"] },
				notes: {},
			},
		};
		await writeConfig(cfg, tmpDir);

		const got = await readConfig(tmpDir);
		expect(got.domains.backend?.allowed_types).toEqual(["convention", "pattern"]);
		expect(got.domains.frontend?.allowed_types).toEqual(["convention"]);
		expect(got.domains.notes?.allowed_types).toBeUndefined();
	});

	it("parses allowed_types from hand-authored YAML", async () => {
		const raw = `version: "1"
domains:
  backend:
    allowed_types: [convention, pattern, decision]
  frontend:
    allowed_types: [convention]
  notes: {}
governance:
  max_entries: 100
  warn_entries: 150
  hard_limit: 200
classification_defaults:
  shelf_life:
    tactical: 14
    observational: 30
`;
		await writeFile(getConfigPath(tmpDir), raw, "utf-8");

		const cfg = await readConfig(tmpDir);
		expect(cfg.domains.backend?.allowed_types).toEqual(["convention", "pattern", "decision"]);
		expect(cfg.domains.frontend?.allowed_types).toEqual(["convention"]);
		expect(cfg.domains.notes?.allowed_types).toBeUndefined();
	});

	it("legacy array shape normalizes to empty DomainConfig (no allowed_types)", async () => {
		const legacy = `version: "1"
domains:
  - backend
  - frontend
governance:
  max_entries: 100
  warn_entries: 150
  hard_limit: 200
classification_defaults:
  shelf_life:
    tactical: 14
    observational: 30
`;
		await writeFile(getConfigPath(tmpDir), legacy, "utf-8");

		const cfg = await readConfig(tmpDir);
		expect(cfg.domains.backend?.allowed_types).toBeUndefined();
		expect(cfg.domains.frontend?.allowed_types).toBeUndefined();
	});

	it("allowed_types serializes as a YAML list under the domain map", async () => {
		const cfg: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { backend: { allowed_types: ["convention", "pattern"] } },
		};
		await writeConfig(cfg, tmpDir);

		const raw = await readFile(getConfigPath(tmpDir), "utf-8");
		const parsed = yaml.load(raw) as { domains: { backend: { allowed_types: string[] } } };
		expect(parsed.domains.backend.allowed_types).toEqual(["convention", "pattern"]);
	});
});
