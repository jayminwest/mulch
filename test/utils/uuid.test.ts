import { describe, expect, it } from "bun:test";
import { uuidv7Hex } from "../../src/utils/uuid.ts";

describe("uuidv7Hex", () => {
  it("returns a 32-char lowercase hex string", () => {
    const hex = uuidv7Hex();
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it("has version nibble 7 at index 12", () => {
    const hex = uuidv7Hex();
    expect(hex[12]).toBe("7");
  });

  it("has variant nibble 8|9|a|b at index 16", () => {
    const hex = uuidv7Hex();
    expect(hex[16]).toMatch(/^[89ab]$/);
  });

  it("is monotonically increasing (lexicographic order matches generation order)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(uuidv7Hex());
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });

  it("generates unique IDs (1000 IDs, no duplicates)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(uuidv7Hex());
    }
    expect(ids.size).toBe(1000);
  });
});
