import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
  readExpertiseFile,
} from "../../src/utils/expertise.ts";
import { formatTimeAgo, getRecordSummary } from "../../src/utils/format.ts";

let tmpDir: string;

function hoursAgo(hours: number): string {
  const d = new Date();
  d.setTime(d.getTime() - hours * 3600000);
  return d.toISOString();
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mulch-ready-test-"));
  await initMulchDir(tmpDir);
  await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing", "api"] }, tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ready command logic", () => {
  it("sorts records by recorded_at descending", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    await appendRecord(filePath, {
      type: "convention",
      content: "Old record",
      classification: "tactical",
      recorded_at: daysAgo(5),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "New record",
      classification: "tactical",
      recorded_at: hoursAgo(1),
    });

    const records = await readExpertiseFile(filePath);
    const sorted = [...records].sort(
      (a, b) =>
        new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
    );
    expect(sorted[0].type === "convention" && sorted[0].content).toBe(
      "New record",
    );
  });

  it("collects records across multiple domains", async () => {
    const testPath = getExpertisePath("testing", tmpDir);
    const apiPath = getExpertisePath("api", tmpDir);
    await createExpertiseFile(testPath);
    await createExpertiseFile(apiPath);

    await appendRecord(testPath, {
      type: "convention",
      content: "Testing convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(apiPath, {
      type: "convention",
      content: "API convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const testRecords = await readExpertiseFile(testPath);
    const apiRecords = await readExpertiseFile(apiPath);
    expect(testRecords.length + apiRecords.length).toBe(2);
  });

  it("limits results to requested count", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    for (let i = 0; i < 5; i++) {
      await appendRecord(filePath, {
        type: "convention",
        content: `Convention ${i}`,
        classification: "tactical",
        recorded_at: hoursAgo(i),
      });
    }

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(5);
    // Simulating --limit 3
    const limited = records.slice(0, 3);
    expect(limited).toHaveLength(3);
  });

  it("filters by since duration", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    await appendRecord(filePath, {
      type: "convention",
      content: "Recent",
      classification: "tactical",
      recorded_at: hoursAgo(12),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Old",
      classification: "tactical",
      recorded_at: daysAgo(3),
    });

    const records = await readExpertiseFile(filePath);
    // Simulate --since 1d (86400000ms)
    const cutoff = Date.now() - 86400000;
    const filtered = records.filter(
      (r) => new Date(r.recorded_at).getTime() >= cutoff,
    );
    expect(filtered).toHaveLength(1);
    if (filtered[0].type === "convention") {
      expect(filtered[0].content).toBe("Recent");
    }
  });
});

describe("formatTimeAgo", () => {
  it("returns 'just now' for very recent dates", () => {
    const now = new Date();
    expect(formatTimeAgo(now)).toBe("just now");
  });

  it("returns minutes for dates less than an hour ago", () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60000);
    expect(formatTimeAgo(thirtyMinsAgo)).toBe("30m ago");
  });

  it("returns hours for dates less than a day ago", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000);
    expect(formatTimeAgo(fiveHoursAgo)).toBe("5h ago");
  });

  it("returns days for dates more than a day ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    expect(formatTimeAgo(threeDaysAgo)).toBe("3d ago");
  });
});

describe("getRecordSummary", () => {
  it("returns content for conventions", () => {
    const record: ExpertiseRecord = {
      type: "convention",
      content: "Always use vitest",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    expect(getRecordSummary(record)).toBe("Always use vitest");
  });

  it("returns name for patterns", () => {
    const record: ExpertiseRecord = {
      type: "pattern",
      name: "init-artifacts",
      description: "Some description",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    expect(getRecordSummary(record)).toBe("init-artifacts");
  });

  it("returns title for decisions", () => {
    const record: ExpertiseRecord = {
      type: "decision",
      title: "Use TypeScript",
      rationale: "Type safety",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    expect(getRecordSummary(record)).toBe("Use TypeScript");
  });

  it("returns description for failures", () => {
    const record: ExpertiseRecord = {
      type: "failure",
      description: "Memory leak in parser",
      resolution: "Use streaming",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };
    expect(getRecordSummary(record)).toBe("Memory leak in parser");
  });
});
