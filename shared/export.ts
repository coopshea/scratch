import type { Unit } from './types.ts';

const SECTION = /^<!--s:[a-z0-9-]+-->$/;
const ANCHOR = /<!--u:([a-z0-9]+)-->/g;

/**
 * Clean markdown for a reader. Section markers are scaffolding and drop out. Evidence placed in the
 * text becomes numbered footnotes quoting it; figures still to make become a visible placeholder;
 * every other idea chip disappears, leaving only the writer's prose.
 */
export function toMarkdown(title: string, draft: string, units: Unit[]): string {
  const byId = new Map(units.map((u) => [u.id, u]));
  const notes: string[] = [];
  const noteNo = new Map<string, number>();

  const body = draft
    .split('\n')
    .filter((l) => !SECTION.test(l.trim()))
    .join('\n')
    .replace(ANCHOR, (_m, id: string) => {
      const u = byId.get(id);
      if (!u) return '';
      if (u.type === 'artifact') return `*[Figure: ${u.label}]*`;
      if (u.type !== 'evidence') return '';
      let n = noteNo.get(id);
      if (!n) {
        n = notes.length + 1;
        noteNo.set(id, n);
        const s = u.source;
        const cite = s ? ` (${[s.author, s.title && `*${s.title}*`, s.url].filter(Boolean).join(', ')})` : '';
        notes.push(`[^${n}]: ${(s?.quote ?? u.text).trim().replace(/\s+/g, ' ')}${cite}`);
      }
      return `[^${n}]`;
    })
    .split('\n')
    .map((l) => l.replace(/[ \t]+\[\^/g, '[^').replace(/(\S)\*\[Figure/g, '$1 *[Figure').replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `# ${title}\n\n${body}\n${notes.length ? `\n${notes.join('\n')}\n` : ''}`;
}
