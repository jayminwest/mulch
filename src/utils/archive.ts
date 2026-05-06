import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getMulchDir, validateDomainName } from "./config.ts";
import { readExpertiseFile, writeExpertiseFile } from "./expertise.ts";
import { withFileLock } from "./lock.ts";

const ARCHIVE_DIR = "archive";

export const ARCHIVE_BANNER = "# ARCHIVED — not for active use. Run `ml restore <id>` to revive.";

export function getArchiveDir(cwd: string = process.cwd()): string {
	return join(getMulchDir(cwd), ARCHIVE_DIR);
}

export function getArchivePath(domain: string, cwd: string = process.cwd()): string {
	validateDomainName(domain);
	return join(getArchiveDir(cwd), `${domain}.jsonl`);
}

/**
 * Read archived records from an archive file. The file's leading banner
 * comment is stripped by readExpertiseFile (which skips `#`-prefixed lines).
 */
export async function readArchiveFile(filePath: string): Promise<ExpertiseRecord[]> {
	return readExpertiseFile(filePath, { allowUnknownTypes: true });
}

/**
 * Write archive records back, prefixed with the standard banner. Uses the
 * same temp-file + rename atomic pattern as writeExpertiseFile.
 */
export async function writeArchiveFile(
	filePath: string,
	records: ExpertiseRecord[],
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const body = records.map((r) => JSON.stringify(r)).join("\n");
	const content = `${ARCHIVE_BANNER}\n${body}${records.length > 0 ? "\n" : ""}`;
	const tmpPath = `${filePath}.tmp.${randomBytes(8).toString("hex")}`;
	await writeFile(tmpPath, content, "utf-8");
	try {
		await rename(tmpPath, filePath);
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			/* best-effort cleanup */
		}
		throw err;
	}
}

/**
 * Move records from a live expertise file to the corresponding archive file.
 * Each archived record gets `status: "archived"` and an `archived_at` timestamp.
 * Locks the archive file during the merge+write; the caller is responsible
 * for locking the source expertise file before invoking.
 */
export async function archiveRecords(
	domain: string,
	records: ExpertiseRecord[],
	now: Date,
	cwd: string = process.cwd(),
): Promise<void> {
	if (records.length === 0) return;
	const archivePath = getArchivePath(domain, cwd);
	const stamped = records.map((r) => ({
		...r,
		status: "archived" as const,
		archived_at: r.archived_at ?? now.toISOString(),
	}));
	await mkdir(dirname(archivePath), { recursive: true });
	await withFileLock(archivePath, async () => {
		const existing = await readArchiveFile(archivePath);
		await writeArchiveFile(archivePath, [...existing, ...stamped]);
	});
}

/** Strip soft-archive lifecycle fields. Used when restoring a record to live. */
export function stripArchiveFields(record: ExpertiseRecord): ExpertiseRecord {
	const { status, archived_at, ...rest } = record as ExpertiseRecord & {
		status?: unknown;
		archived_at?: unknown;
	};
	void status;
	void archived_at;
	return rest as ExpertiseRecord;
}

/**
 * Remove a record from an archive file by id (mutates archive on disk under a
 * lock). Returns the removed record, or null if not found.
 */
export async function removeFromArchive(
	domain: string,
	recordId: string,
	cwd: string = process.cwd(),
): Promise<ExpertiseRecord | null> {
	const archivePath = getArchivePath(domain, cwd);
	return withFileLock(archivePath, async () => {
		const records = await readArchiveFile(archivePath);
		const idx = records.findIndex((r) => r.id === recordId);
		if (idx === -1) return null;
		const [removed] = records.splice(idx, 1);
		await writeArchiveFile(archivePath, records);
		return removed ?? null;
	});
}

/**
 * Append a single record to a live expertise file under a lock. Used by
 * `ml restore` to push an archived record back into circulation.
 */
export async function restoreToExpertise(
	expertisePath: string,
	record: ExpertiseRecord,
): Promise<void> {
	await withFileLock(expertisePath, async () => {
		const existing = await readExpertiseFile(expertisePath);
		await writeExpertiseFile(expertisePath, [...existing, record]);
	});
}
