import { describe, expect, it } from "bun:test";
import {
  MARKER_END,
  MARKER_START,
  hasMarkerSection,
  removeMarkerSection,
  replaceMarkerSection,
  wrapInMarkers,
} from "../../src/utils/markers.ts";

describe("markers utility", () => {
  it("hasMarkerSection detects markers", () => {
    const content = `# Header\n\n${MARKER_START}\nsome content\n${MARKER_END}\n`;
    expect(hasMarkerSection(content)).toBe(true);
  });

  it("hasMarkerSection returns false when no markers", () => {
    expect(hasMarkerSection("# Just a normal file\n")).toBe(false);
    expect(hasMarkerSection("")).toBe(false);
  });

  it("replaceMarkerSection swaps content between markers", () => {
    const content = `# Header\n\n${MARKER_START}\nold content\n${MARKER_END}\n\n# Footer\n`;
    const result = replaceMarkerSection(
      content,
      `${MARKER_START}\nnew content\n${MARKER_END}`,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("new content");
    expect(result).not.toContain("old content");
    expect(result).toContain("# Header");
    expect(result).toContain("# Footer");
  });

  it("replaceMarkerSection returns null when no markers found", () => {
    expect(replaceMarkerSection("no markers here", "new")).toBeNull();
  });

  it("removeMarkerSection removes markers and content, cleans newlines", () => {
    const content = `# Header\n\n\n${MARKER_START}\ncontent\n${MARKER_END}\n\n\n# Footer\n`;
    const result = removeMarkerSection(content);
    expect(result).not.toContain(MARKER_START);
    expect(result).not.toContain("content");
    expect(result).toContain("# Header");
    expect(result).toContain("# Footer");
    // No triple+ newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("removeMarkerSection returns content unchanged when no markers", () => {
    const content = "# Just text\n";
    expect(removeMarkerSection(content)).toBe(content);
  });

  it("wrapInMarkers wraps content in start/end markers", () => {
    const snippet = "## My Section\n\nSome text.\n";
    const wrapped = wrapInMarkers(snippet);
    expect(wrapped).toBe(`${MARKER_START}\n${snippet}${MARKER_END}`);
    expect(wrapped.startsWith(MARKER_START)).toBe(true);
    expect(wrapped.endsWith(MARKER_END)).toBe(true);
  });
});
