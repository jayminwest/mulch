import { afterAll, beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateRecordId } from "../../src/utils/expertise.ts";
import {
	formatDomainExpertise,
	formatDomainExpertiseCompact,
	formatDomainExpertisePlain,
	formatDomainExpertiseXml,
	getRecordSummary,
} from "../../src/utils/format.ts";
import { FIXTURE_LAST_UPDATED, FIXTURE_RECORDS, ID_GEN_RECORDS } from "./format-fixture.ts";

// Pin "now" so formatTimeAgo output is stable across days.
const PINNED_NOW = new Date("2026-05-04T12:00:00.000Z");

const SNAPSHOT_PATH = join(import.meta.dir, "__snapshots__", "format-fixture.snapshot.json");

interface Snapshot {
	markdown_compact: string;
	markdown_summary: string;
	markdown_full: string;
	xml: string;
	plain: string;
	summaries: string[];
	ids: string[];
}

function buildSnapshot(): Snapshot {
	return {
		markdown_compact: formatDomainExpertiseCompact("test", FIXTURE_RECORDS, FIXTURE_LAST_UPDATED),
		markdown_summary: formatDomainExpertise("test", FIXTURE_RECORDS, FIXTURE_LAST_UPDATED),
		markdown_full: formatDomainExpertise("test", FIXTURE_RECORDS, FIXTURE_LAST_UPDATED, {
			full: true,
		}),
		xml: formatDomainExpertiseXml("test", FIXTURE_RECORDS, FIXTURE_LAST_UPDATED),
		plain: formatDomainExpertisePlain("test", FIXTURE_RECORDS, FIXTURE_LAST_UPDATED),
		summaries: FIXTURE_RECORDS.map(getRecordSummary),
		ids: ID_GEN_RECORDS.map(({ record }) => generateRecordId(record)),
	};
}

describe("format/id regression (Phase 1 type-registry refactor)", () => {
	beforeAll(() => {
		setSystemTime(PINNED_NOW);
	});

	afterAll(() => {
		setSystemTime();
	});

	it("renders byte-identical output for the canonical fixture", async () => {
		const current = buildSnapshot();

		if (process.env.UPDATE_SNAPSHOTS === "1") {
			await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
			await writeFile(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
			return;
		}

		if (!existsSync(SNAPSHOT_PATH)) {
			throw new Error(
				`Snapshot missing at ${SNAPSHOT_PATH}. Run with UPDATE_SNAPSHOTS=1 to generate.`,
			);
		}

		const expected = JSON.parse(await readFile(SNAPSHOT_PATH, "utf-8")) as Snapshot;
		expect(current.markdown_compact).toBe(expected.markdown_compact);
		expect(current.markdown_summary).toBe(expected.markdown_summary);
		expect(current.markdown_full).toBe(expected.markdown_full);
		expect(current.xml).toBe(expected.xml);
		expect(current.plain).toBe(expected.plain);
		expect(current.summaries).toEqual(expected.summaries);
		expect(current.ids).toEqual(expected.ids);
	});
});
