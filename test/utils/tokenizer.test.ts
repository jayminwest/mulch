import { describe, expect, it } from "bun:test";
import { createTokenizer } from "../../src/utils/tokenizer.ts";

describe("tokenizer", () => {
  describe("createTokenizer", () => {
    it("creates a cl100k_base tokenizer", () => {
      const t = createTokenizer("cl100k_base");
      expect(t.name()).toBe("cl100k_base");
    });

    it("creates an o200k_base tokenizer", () => {
      const t = createTokenizer("o200k_base");
      expect(t.name()).toBe("o200k_base");
    });

    it("creates an estimator tokenizer for 'none'", () => {
      const t = createTokenizer("none");
      expect(t.name()).toBe("none");
    });

    it("throws for unknown encoding", () => {
      expect(() => createTokenizer("unknown")).toThrow(
        'Unknown tokenizer encoding: "unknown"',
      );
    });
  });

  describe("cl100k_base", () => {
    const t = createTokenizer("cl100k_base");

    it("returns 0 for empty string", () => {
      expect(t.count("")).toBe(0);
    });

    it("returns accurate token count for 'hello world'", () => {
      // "hello world" is 2 tokens in cl100k_base
      expect(t.count("hello world")).toBe(2);
    });

    it("returns accurate token count for longer text", () => {
      const text = "The quick brown fox jumps over the lazy dog";
      const count = t.count(text);
      // BPE tokenization — this is a known sentence, should be 9 tokens
      expect(count).toBe(9);
    });

    it("differs from naive char/4 estimate", () => {
      const text = "function calculateTokenBudget(text: string): number {}";
      const bpeCount = t.count(text);
      const naiveCount = Math.ceil(text.length / 4);
      // BPE and naive should differ for code-like text
      expect(bpeCount).not.toBe(naiveCount);
    });
  });

  describe("o200k_base", () => {
    const t = createTokenizer("o200k_base");

    it("returns 0 for empty string", () => {
      expect(t.count("")).toBe(0);
    });

    it("returns a token count for text", () => {
      const count = t.count("hello world");
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("none (estimator)", () => {
    const t = createTokenizer("none");

    it("returns Math.ceil(len/4)", () => {
      expect(t.count("abcd")).toBe(1);
      expect(t.count("abcde")).toBe(2);
      expect(t.count("a".repeat(400))).toBe(100);
    });

    it("returns 0 for empty string", () => {
      expect(t.count("")).toBe(0);
    });
  });
});
