import { describe, expect, it } from "bun:test";
import Ajv from "ajv";
import { recordSchema } from "../../src/schemas/record-schema.ts";

describe("validate command", () => {
  const ajv = new Ajv();
  const validate = ajv.compile(recordSchema);

  describe("valid records pass validation", () => {
    it("validates a convention record", () => {
      const record = {
        type: "convention",
        content: "Use single quotes for strings",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a pattern record", () => {
      const record = {
        type: "pattern",
        name: "Error Handler",
        description: "Centralized error handling middleware",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a pattern record with files", () => {
      const record = {
        type: "pattern",
        name: "Service Layer",
        description: "Business logic in service classes",
        files: ["src/services/", "src/controllers/"],
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a failure record", () => {
      const record = {
        type: "failure",
        description: "Memory leak in event listeners",
        resolution: "Remove listeners in cleanup function",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a decision record", () => {
      const record = {
        type: "decision",
        title: "Use PostgreSQL",
        rationale: "Better JSON support and reliability",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a record with evidence", () => {
      const record = {
        type: "convention",
        content: "Always add error boundaries",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
        evidence: {
          commit: "abc123",
          issue: "#42",
          file: "src/App.tsx",
        },
      };
      expect(validate(record)).toBe(true);
    });

    it("validates a decision record with date", () => {
      const record = {
        type: "decision",
        title: "Migrate to ESM",
        rationale: "Better ecosystem support",
        date: "2025-01-15",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(true);
    });
  });

  describe("invalid records fail validation", () => {
    it("rejects record with missing type", () => {
      const record = {
        content: "Some content",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects record with invalid type", () => {
      const record = {
        type: "unknown",
        content: "Some content",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects record with invalid classification", () => {
      const record = {
        type: "convention",
        content: "Some content",
        classification: "invalid",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects convention without content", () => {
      const record = {
        type: "convention",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects pattern without name", () => {
      const record = {
        type: "pattern",
        description: "A description",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects pattern without description", () => {
      const record = {
        type: "pattern",
        name: "A name",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects failure without resolution", () => {
      const record = {
        type: "failure",
        description: "Something broke",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects decision without title", () => {
      const record = {
        type: "decision",
        rationale: "Some rationale",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects decision without rationale", () => {
      const record = {
        type: "decision",
        title: "Some title",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects record without recorded_at", () => {
      const record = {
        type: "convention",
        content: "Some content",
        classification: "tactical",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects record with additional properties", () => {
      const record = {
        type: "convention",
        content: "Some content",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
        extra_field: "not allowed",
      };
      expect(validate(record)).toBe(false);
    });

    it("rejects record with invalid evidence properties", () => {
      const record = {
        type: "convention",
        content: "Some content",
        classification: "tactical",
        recorded_at: "2025-01-01T00:00:00.000Z",
        evidence: {
          commit: "abc123",
          unknown_field: "not allowed",
        },
      };
      expect(validate(record)).toBe(false);
    });
  });
});
