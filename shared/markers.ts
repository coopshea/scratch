const SECTION = /^<!--s:([a-z0-9-]+)-->$/;

/**
 * Repair section markers on load. A marker must sit alone on its line (that is what makes it a divider), so line
 * breaks lost around one are put back. Each section has one marker: a repeat (left behind when an older bug joined
 * a marker to text and a fresh one was added) is dropped, and the text after it stays, in the section above.
 */
export function normalizeMarkers(doc: string): string {
  const split = doc.replace(/([^\n])(<!--s:[a-z0-9-]+-->)/g, '$1\n$2').replace(/(<!--s:[a-z0-9-]+-->)([^\n])/g, '$1\n$2');
  const seen = new Set<string>();
  return split.split('\n').filter((line) => {
    const m = line.trim().match(SECTION);
    if (!m) return true;
    if (seen.has(m[1])) return false;
    seen.add(m[1]);
    return true;
  }).join('\n');
}
