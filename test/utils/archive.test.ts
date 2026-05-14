import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
	ARCHIVE_BANNER,
	archiveRecords,
	getArchiveDir,
	getArchivePath,
	readArchiveFile,
	removeFromArchive,
	restoreToExpertise,
	stripArchiveFields,
	writeArchiveFile,
} from "../../src/utils/archive.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { readExpertiseFile } from "../../src/utils/expertise.ts";

function makeRecord(content: string): ExpertiseRecord {
	return {
		type: "convention",
		content,
		classification: "tactical",
		recorded_at: new Date().toISOString(),
	};
}

describe("archive utilities", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-archive-util-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("getArchivePath places domain files under .mulch/archive/", () => {
		const path = getArchivePath("testing", tmpDir);
		expect(path).toBe(join(getArchiveDir(tmpDir), "testing.jsonl"));
		expect(path.includes("/.mulch/archive/")).toBe(true);
	});

	it("writeArchiveFile prefixes file with the standard banner", async () => {
		const path = getArchivePath("testing", tmpDir);
		const records: ExpertiseRecord[] = [makeRecord("first")];
		await writeArchiveFile(path, records);
		const content = await readFile(path, "utf-8");
		expect(content.startsWith(ARCHIVE_BANNER)).toBe(true);
		expect(content).toContain('"first"');
	});

	it("readArchiveFile skips the banner comment line", async () => {
		const path = getArchivePath("testing", tmpDir);
		await writeArchiveFile(path, [makeRecord("alpha"), makeRecord("beta")]);
		const records = await readArchiveFile(path);
		expect(records).toHaveLength(2);
		expect(records[0]).toMatchObject({ content: "alpha" });
		expect(records[1]).toMatchObject({ content: "beta" });
	});

	it("readArchiveFile returns [] when archive file does not exist", async () => {
		const path = getArchivePath("testing", tmpDir);
		expect(existsSync(path)).toBe(false);
		const records = await readArchiveFile(path);
		expect(records).toEqual([]);
	});

	it("archiveRecords stamps status, archived_at, and archive_reason on each record", async () => {
		const now = new Date("2026-05-06T00:00:00.000Z");
		const live = makeRecord("payload");
		live.id = "mx-aaa111";
		await archiveRecords("testing", [live], now, "stale", tmpDir);
		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(1);
		expect(archived[0]?.status).toBe("archived");
		expect(archived[0]?.archived_at).toBe(now.toISOString());
		expect(archived[0]?.archive_reason).toBe("stale");
		expect(archived[0]?.id).toBe("mx-aaa111");
	});

	it("archiveRecords preserves a pre-stamped archive_reason over the param default", async () => {
		const now = new Date("2026-05-06T00:00:00.000Z");
		const preStamped: ExpertiseRecord = {
			...makeRecord("bottom-out"),
			archive_reason: "superseded",
		};
		preStamped.id = "mx-aaa111";
		await archiveRecords("testing", [preStamped], now, "stale", tmpDir);
		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived[0]?.archive_reason).toBe("superseded");
	});

	it("archiveRecords appends to an existing archive without losing prior records", async () => {
		const now = new Date();
		const first = makeRecord("first");
		first.id = "mx-aaa111";
		const second = makeRecord("second");
		second.id = "mx-bbb222";
		await archiveRecords("testing", [first], now, "stale", tmpDir);
		await archiveRecords("testing", [second], now, "manual", tmpDir);
		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(2);
		expect(archived.map((r) => r.id)).toEqual(["mx-aaa111", "mx-bbb222"]);
		expect(archived.map((r) => r.archive_reason)).toEqual(["stale", "manual"]);
	});

	it("readArchiveFile loads archives written before archive_reason landed (back-compat)", async () => {
		const path = getArchivePath("testing", tmpDir);
		// Hand-write an archive that predates archive_reason — readArchiveFile
		// must still load the record (field is optional).
		const legacy: ExpertiseRecord = {
			...makeRecord("legacy"),
			status: "archived",
			archived_at: "2026-04-01T00:00:00.000Z",
		};
		legacy.id = "mx-legacy1";
		await writeArchiveFile(path, [legacy]);
		const records = await readArchiveFile(path);
		expect(records).toHaveLength(1);
		expect(records[0]?.id).toBe("mx-legacy1");
		expect(records[0]?.archive_reason).toBeUndefined();
	});

	it("stripArchiveFields removes status, archived_at, and archive_reason", () => {
		const r: ExpertiseRecord = {
			...makeRecord("foo"),
			status: "archived",
			archived_at: "2026-05-06T00:00:00.000Z",
			archive_reason: "stale",
		};
		const stripped = stripArchiveFields(r);
		expect(stripped.status).toBeUndefined();
		expect(stripped.archived_at).toBeUndefined();
		expect(stripped.archive_reason).toBeUndefined();
		expect(stripped).toMatchObject({ content: "foo", type: "convention" });
	});

	it("removeFromArchive returns and deletes the matching record", async () => {
		const now = new Date();
		const first = makeRecord("first");
		first.id = "mx-aaa111";
		const second = makeRecord("second");
		second.id = "mx-bbb222";
		await archiveRecords("testing", [first, second], now, "stale", tmpDir);

		const removed = await removeFromArchive("testing", "mx-aaa111", tmpDir);
		expect(removed?.id).toBe("mx-aaa111");

		const remaining = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.id).toBe("mx-bbb222");

		// Banner is preserved on rewrite.
		const raw = await readFile(getArchivePath("testing", tmpDir), "utf-8");
		expect(raw.startsWith(ARCHIVE_BANNER)).toBe(true);
	});

	it("restoreToExpertise appends to the live file under a lock", async () => {
		const expertisePath = getExpertisePath("testing", tmpDir);
		const r = makeRecord("restored");
		r.id = "mx-ccc333";
		await restoreToExpertise(expertisePath, r);
		const records = await readExpertiseFile(expertisePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.id).toBe("mx-ccc333");
		expect(records[0]).toMatchObject({ content: "restored" });
	});
});
