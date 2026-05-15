import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPiConfig, resolvePiConfig } from "../../extensions/pi/lib/config.ts";
import { DEFAULT_PI_CONFIG } from "../../src/schemas/config.ts";

describe("pi-extension config", () => {
	describe("resolvePiConfig", () => {
		it("returns full defaults when user config is undefined", () => {
			expect(resolvePiConfig(undefined)).toEqual({
				auto_prime: DEFAULT_PI_CONFIG.auto_prime,
				scope_load: {
					enabled: DEFAULT_PI_CONFIG.scope_load.enabled,
					budget: DEFAULT_PI_CONFIG.scope_load.budget,
					debounce_ms: DEFAULT_PI_CONFIG.scope_load.debounce_ms,
				},
				tools: DEFAULT_PI_CONFIG.tools,
				commands: DEFAULT_PI_CONFIG.commands,
				agent_end_widget: DEFAULT_PI_CONFIG.agent_end_widget,
			});
		});

		it("respects user overrides for top-level booleans", () => {
			const resolved = resolvePiConfig({
				auto_prime: false,
				tools: false,
				commands: false,
				agent_end_widget: false,
			});
			expect(resolved.auto_prime).toBe(false);
			expect(resolved.tools).toBe(false);
			expect(resolved.commands).toBe(false);
			expect(resolved.agent_end_widget).toBe(false);
			// scope_load untouched
			expect(resolved.scope_load.enabled).toBe(true);
			expect(resolved.scope_load.budget).toBe(2000);
		});

		it("merges partial scope_load overrides on top of defaults", () => {
			const resolved = resolvePiConfig({
				scope_load: { budget: 500 },
			});
			expect(resolved.scope_load.budget).toBe(500);
			expect(resolved.scope_load.enabled).toBe(true);
			expect(resolved.scope_load.debounce_ms).toBe(500);
		});

		it("accepts explicit false for scope_load.enabled", () => {
			const resolved = resolvePiConfig({ scope_load: { enabled: false } });
			expect(resolved.scope_load.enabled).toBe(false);
		});
	});

	describe("readPiConfig", () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = await mkdtemp(join(tmpdir(), "mulch-pi-config-test-"));
			await mkdir(join(tmpDir, ".mulch", "expertise"), { recursive: true });
		});

		afterEach(async () => {
			await rm(tmpDir, { recursive: true, force: true });
		});

		it("returns defaults when pi block is absent", async () => {
			await writeFile(
				join(tmpDir, ".mulch", "mulch.config.yaml"),
				"version: '1'\ndomains: {}\n",
				"utf-8",
			);
			const resolved = await readPiConfig(tmpDir);
			expect(resolved.auto_prime).toBe(true);
			expect(resolved.scope_load.budget).toBe(2000);
		});

		it("reads pi.* knobs from disk", async () => {
			await writeFile(
				join(tmpDir, ".mulch", "mulch.config.yaml"),
				[
					"version: '1'",
					"domains: {}",
					"pi:",
					"  auto_prime: false",
					"  scope_load:",
					"    budget: 1234",
					"    debounce_ms: 50",
					"  agent_end_widget: false",
					"",
				].join("\n"),
				"utf-8",
			);
			const resolved = await readPiConfig(tmpDir);
			expect(resolved.auto_prime).toBe(false);
			expect(resolved.scope_load.budget).toBe(1234);
			expect(resolved.scope_load.debounce_ms).toBe(50);
			expect(resolved.scope_load.enabled).toBe(true); // default preserved
			expect(resolved.agent_end_widget).toBe(false);
			expect(resolved.tools).toBe(true);
			expect(resolved.commands).toBe(true);
		});
	});
});
