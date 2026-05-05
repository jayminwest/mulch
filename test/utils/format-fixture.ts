import type { ExpertiseRecord } from "../../src/schemas/record.ts";

// A fixed record set covering all six built-in types with files/tags/relates_to/
// supersedes/outcomes/evidence so format renderers exercise every branch. Used
// as the input for byte-identical regression assertions across the pre-Phase-1
// and post-Phase-1 code paths. recorded_at timestamps are fixed, not derived
// from `new Date()`, so output is stable.
export const FIXTURE_RECORDS: ExpertiseRecord[] = [
	{
		id: "mx-c0n111",
		type: "convention",
		content: "Always use `records` not `entries` in user-facing strings.",
		classification: "foundational",
		recorded_at: "2026-01-01T00:00:00.000Z",
		evidence: { commit: "abc1234", file: "src/cli.ts" },
		tags: ["style", "cli"],
		relates_to: ["mx-pat222"],
		supersedes: ["mx-old001"],
		outcomes: [
			{ status: "success", duration: 42, agent: "claude", recorded_at: "2026-02-01T00:00:00.000Z" },
			{ status: "success", recorded_at: "2026-02-15T00:00:00.000Z" },
		],
	},
	{
		id: "mx-pat222",
		type: "pattern",
		name: "atomic-writes",
		description: "Write to temp file then rename to prevent partial JSONL.",
		files: ["src/utils/expertise.ts", "src/utils/lock.ts"],
		classification: "foundational",
		recorded_at: "2026-01-02T00:00:00.000Z",
		evidence: { commit: "def5678", date: "2026-01-02", issue: "mulch-100" },
		tags: ["concurrency"],
	},
	{
		id: "mx-fai333",
		type: "failure",
		description: "AJV strict mode rejects schemas missing `type: object`.",
		resolution: 'Add `type: "object"` alongside `required` and `properties`.',
		classification: "tactical",
		recorded_at: "2026-01-03T00:00:00.000Z",
		evidence: { commit: "fai0001" },
		outcomes: [{ status: "partial", notes: "Fixed in two of three schemas." }],
	},
	{
		id: "mx-dec444",
		type: "decision",
		title: "Singleton registry over DI",
		rationale: "DI ripples through ~30 files; singleton with lazy fallback is pragmatic.",
		date: "2026-04-30",
		classification: "foundational",
		recorded_at: "2026-01-04T00:00:00.000Z",
		tags: ["architecture", "v0.8.0"],
		relates_to: ["mx-pat222", "mx-ref555"],
	},
	{
		id: "mx-ref555",
		type: "reference",
		name: "AJV docs",
		description: "Reference for JSON-schema validation library.",
		files: ["node_modules/ajv/README.md"],
		classification: "observational",
		recorded_at: "2026-01-05T00:00:00.000Z",
	},
	{
		id: "mx-gui666",
		type: "guide",
		name: "How to add a custom record type",
		description: "Phase 2 step-by-step for declaring custom_types in mulch.config.yaml.",
		classification: "tactical",
		recorded_at: "2026-01-06T00:00:00.000Z",
		evidence: { commit: "gui0001" },
		outcomes: [{ status: "failure", agent: "tester", test_results: "5/8 passed" }],
	},
];

export const FIXTURE_LAST_UPDATED = new Date("2026-01-06T12:00:00.000Z");

// Records used to verify generateRecordId — same dedup keys as records above
// so the IDs derive deterministically from type + key field.
export const ID_GEN_RECORDS: Array<{ record: ExpertiseRecord; expected: string }> = [
	{
		record: {
			type: "convention",
			content: "Always use `records` not `entries` in user-facing strings.",
			classification: "foundational",
			recorded_at: "2026-01-01T00:00:00.000Z",
		},
		expected: "",
	},
	{
		record: {
			type: "pattern",
			name: "atomic-writes",
			description: "ignored",
			classification: "foundational",
			recorded_at: "2026-01-02T00:00:00.000Z",
		},
		expected: "",
	},
	{
		record: {
			type: "failure",
			description: "AJV strict mode rejects schemas missing `type: object`.",
			resolution: "ignored",
			classification: "tactical",
			recorded_at: "2026-01-03T00:00:00.000Z",
		},
		expected: "",
	},
	{
		record: {
			type: "decision",
			title: "Singleton registry over DI",
			rationale: "ignored",
			classification: "foundational",
			recorded_at: "2026-01-04T00:00:00.000Z",
		},
		expected: "",
	},
	{
		record: {
			type: "reference",
			name: "AJV docs",
			description: "ignored",
			classification: "observational",
			recorded_at: "2026-01-05T00:00:00.000Z",
		},
		expected: "",
	},
	{
		record: {
			type: "guide",
			name: "How to add a custom record type",
			description: "ignored",
			classification: "tactical",
			recorded_at: "2026-01-06T00:00:00.000Z",
		},
		expected: "",
	},
];
