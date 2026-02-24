const MARKER_START = "<!-- mulch:start -->";
const MARKER_END = "<!-- mulch:end -->";

export { MARKER_START, MARKER_END };

/**
 * Check whether content contains the mulch marker section.
 */
export function hasMarkerSection(content: string): boolean {
  return content.includes(MARKER_START);
}

/**
 * Replace the marker-bounded section with new content.
 * Returns null if no markers found.
 */
export function replaceMarkerSection(
  content: string,
  newSection: string,
): string | null {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) return null;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + MARKER_END.length);

  return before + newSection + after;
}

/**
 * Remove the marker-bounded section entirely.
 * Cleans up extra newlines left behind.
 */
export function removeMarkerSection(content: string): string {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) return content;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + MARKER_END.length);

  return `${(before + after).replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * Wrap a snippet in mulch markers.
 */
export function wrapInMarkers(snippet: string): string {
  return `${MARKER_START}\n${snippet}${MARKER_END}`;
}
