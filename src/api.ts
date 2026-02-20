import type { ExpertiseRecord, Classification, Outcome } from "./schemas/record.js";
import { readConfig, getExpertisePath } from "./utils/config.js";
import {
  readExpertiseFile,
  writeExpertiseFile,
  appendRecord,
  findDuplicate,
  resolveRecordId,
  searchRecords,
  filterByType,
  filterByClassification,
  filterByFile,
} from "./utils/expertise.js";
import { withFileLock } from "./utils/lock.js";

export interface RecordOptions {
  force?: boolean;
  cwd?: string;
}

export interface RecordResult {
  action: "created" | "updated" | "skipped";
  record: ExpertiseRecord;
}

export interface SearchOptions {
  domain?: string;
  type?: string;
  tag?: string;
  classification?: string;
  file?: string;
  cwd?: string;
}

export interface SearchResult {
  domain: string;
  records: ExpertiseRecord[];
}

export interface QueryOptions {
  type?: string;
  classification?: string;
  file?: string;
  cwd?: string;
}

export interface EditOptions {
  cwd?: string;
}

export interface RecordUpdates {
  classification?: Classification;
  tags?: string[];
  relates_to?: string[];
  supersedes?: string[];
  outcome?: Outcome;
  // type-specific fields
  content?: string;
  name?: string;
  description?: string;
  resolution?: string;
  title?: string;
  rationale?: string;
  files?: string[];
}

/**
 * Record an expertise record in the given domain.
 * Named record types (pattern, decision, reference, guide) are upserted on
 * duplicate key; convention and failure duplicates are skipped unless force=true.
 */
export async function recordExpertise(
  domain: string,
  record: ExpertiseRecord,
  options: RecordOptions = {},
): Promise<RecordResult> {
  const { force = false, cwd } = options;

  const config = await readConfig(cwd);
  if (!config.domains.includes(domain)) {
    throw new Error(
      `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
    );
  }

  const filePath = getExpertisePath(domain, cwd);

  return withFileLock(filePath, async () => {
    const existing = await readExpertiseFile(filePath);
    const dup = findDuplicate(existing, record);

    if (dup && !force) {
      const isNamed =
        record.type === "pattern" ||
        record.type === "decision" ||
        record.type === "reference" ||
        record.type === "guide";

      if (isNamed) {
        existing[dup.index] = record;
        await writeExpertiseFile(filePath, existing);
        return { action: "updated" as const, record };
      } else {
        return { action: "skipped" as const, record: dup.record };
      }
    } else {
      await appendRecord(filePath, record);
      return { action: "created" as const, record };
    }
  });
}

/**
 * Search expertise records across domains using BM25 ranking.
 * Returns domains with at least one matching record.
 */
export async function searchExpertise(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { cwd } = options;
  const config = await readConfig(cwd);

  let domainsToSearch: string[];
  if (options.domain) {
    if (!config.domains.includes(options.domain)) {
      throw new Error(
        `Domain "${options.domain}" not found in config. Available domains: ${config.domains.join(", ")}`,
      );
    }
    domainsToSearch = [options.domain];
  } else {
    domainsToSearch = config.domains;
  }

  const results: SearchResult[] = [];

  for (const d of domainsToSearch) {
    const filePath = getExpertisePath(d, cwd);
    let records = await readExpertiseFile(filePath);

    if (options.type) {
      records = filterByType(records, options.type);
    }
    if (options.tag) {
      const tagLower = options.tag.toLowerCase();
      records = records.filter((r) =>
        r.tags?.some((t) => t.toLowerCase() === tagLower),
      );
    }
    if (options.classification) {
      records = filterByClassification(records, options.classification);
    }
    if (options.file) {
      records = filterByFile(records, options.file);
    }

    const matches = searchRecords(records, query);
    if (matches.length > 0) {
      results.push({ domain: d, records: matches });
    }
  }

  return results;
}

/**
 * Query all records in a domain with optional filtering.
 */
export async function queryDomain(
  domain: string,
  options: QueryOptions = {},
): Promise<ExpertiseRecord[]> {
  const { cwd } = options;
  const config = await readConfig(cwd);

  if (!config.domains.includes(domain)) {
    throw new Error(
      `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
    );
  }

  const filePath = getExpertisePath(domain, cwd);
  let records = await readExpertiseFile(filePath);

  if (options.type) {
    records = filterByType(records, options.type);
  }
  if (options.classification) {
    records = filterByClassification(records, options.classification);
  }
  if (options.file) {
    records = filterByFile(records, options.file);
  }

  return records;
}

/**
 * Edit an existing record by ID in the given domain.
 * Only provided fields in updates are modified; all other fields are preserved.
 */
export async function editRecord(
  domain: string,
  id: string,
  updates: RecordUpdates,
  options: EditOptions = {},
): Promise<ExpertiseRecord> {
  const { cwd } = options;
  const config = await readConfig(cwd);

  if (!config.domains.includes(domain)) {
    throw new Error(
      `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
    );
  }

  const filePath = getExpertisePath(domain, cwd);

  return withFileLock(filePath, async () => {
    const records = await readExpertiseFile(filePath);
    const resolved = resolveRecordId(records, id);

    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    const targetIndex = resolved.index;
    const record = { ...records[targetIndex] };

    // Apply common updates
    if (updates.classification !== undefined) {
      record.classification = updates.classification;
    }
    if (updates.tags !== undefined) {
      record.tags = updates.tags;
    }
    if (updates.relates_to !== undefined) {
      record.relates_to = updates.relates_to;
    }
    if (updates.supersedes !== undefined) {
      record.supersedes = updates.supersedes;
    }
    if (updates.outcome !== undefined) {
      record.outcome = updates.outcome;
    }

    // Apply type-specific updates
    switch (record.type) {
      case "convention":
        if (updates.content !== undefined) {
          record.content = updates.content;
        }
        break;
      case "pattern":
        if (updates.name !== undefined) {
          record.name = updates.name;
        }
        if (updates.description !== undefined) {
          record.description = updates.description;
        }
        if (updates.files !== undefined) {
          record.files = updates.files;
        }
        break;
      case "failure":
        if (updates.description !== undefined) {
          record.description = updates.description;
        }
        if (updates.resolution !== undefined) {
          record.resolution = updates.resolution;
        }
        break;
      case "decision":
        if (updates.title !== undefined) {
          record.title = updates.title;
        }
        if (updates.rationale !== undefined) {
          record.rationale = updates.rationale;
        }
        break;
      case "reference":
        if (updates.name !== undefined) {
          record.name = updates.name;
        }
        if (updates.description !== undefined) {
          record.description = updates.description;
        }
        if (updates.files !== undefined) {
          record.files = updates.files;
        }
        break;
      case "guide":
        if (updates.name !== undefined) {
          record.name = updates.name;
        }
        if (updates.description !== undefined) {
          record.description = updates.description;
        }
        break;
    }

    records[targetIndex] = record;
    await writeExpertiseFile(filePath, records);

    return record;
  });
}
