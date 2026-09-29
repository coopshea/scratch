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

const sectionFor = (lane: string) => `<!--s:${lane}-->`;

/**
 * Give every level of the outline a section marker, in outline order. With nothing written yet, the markers are laid
 * out fresh for this outline. Otherwise a missing one goes in before the next level that has one, and a marker left
 * from another outline is dropped when nothing was written under it; one with writing under it stays, words and all.
 */
export function ensureSections(doc: string, laneIds: string[]): string {
  const fresh = (body: string) => laneIds.map((id, i) => `${sectionFor(id)}\n${i === 0 && body ? body + '\n' : ''}`).join('\n');
  if (!doc.split('\n').some((l) => SECTION.test(l.trim()))) return fresh(doc.trim());
  if (!doc.replace(/<!--s:[a-z0-9-]+-->/g, '').trim()) return fresh('') === doc ? doc : fresh('');

  const wanted = new Set(laneIds);
  let lines = doc.split('\n');
  const laneAt = (i: number) => lines[i].trim().match(SECTION)?.[1];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lane = laneAt(i);
    if (lane && !wanted.has(lane)) {
      let j = i + 1;
      while (j < lines.length && !laneAt(j)) j++;
      if (lines.slice(i + 1, j).every((l) => !l.trim())) { i = j - 1; continue; }
    }
    kept.push(lines[i]);
  }
  lines = kept;

  const markerLine = (id: string) => lines.findIndex((l) => l.trim() === sectionFor(id));
  laneIds.forEach((id, i) => {
    if (markerLine(id) >= 0) return;
    const nextId = laneIds.slice(i + 1).find((n) => markerLine(n) >= 0);
    const at = nextId ? markerLine(nextId) : lines.length;
    lines.splice(at, 0, sectionFor(id), '');
  });
  const out = lines.join('\n');
  return out === doc ? doc : out;
}
