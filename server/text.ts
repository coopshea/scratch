import { LABEL_MAX_CHARS, LABEL_MAX_WORDS } from '../shared/types.ts';

/** Find the parser's text in the blurt. Returns the true verbatim slice, tolerating whitespace and quote-style drift. */
export function locate(hay: string, needle: string): [number, number] | null {
  const exact = hay.indexOf(needle);
  if (exact >= 0) return [exact, exact + needle.length];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’]/g, "['‘’]").replace(/["“”]/g, '["“”]');
  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(words.map(esc).join('\\s+')).exec(hay);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** A label cut from the passage itself, never written: its first words, within the label limits. */
export function cutLabel(quote: string): string {
  let label = '';
  for (const w of quote.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').split(/\s+/).filter(Boolean)) {
    const next = label ? `${label} ${w}` : w;
    if (next.split(' ').length > LABEL_MAX_WORDS || next.length > LABEL_MAX_CHARS) break;
    label = next;
  }
  return label.replace(/[,;:.\u2014-]+$/, '') || quote.slice(0, LABEL_MAX_CHARS).trim();
}
