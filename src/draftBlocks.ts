import type { ScratchBlock, ScratchEditor } from './blocks.tsx';

/**
 * The draft is still stored as markdown with `<!--s:lane-->` section markers and `<!--u:id-->` idea anchors, so the
 * server, history and export are unchanged. These convert it to BlockNote blocks and back. Anchors cross the markdown
 * parser as a token it leaves alone, then become chips.
 */

const SECTION = /^<!--s:([a-z0-9-]+)-->$/;
const ANCHOR = /<!--u:([a-z0-9]+)-->/g;
const TOKEN = /⟦u:([a-z0-9]+)⟧/g;

type Inline = { type: string; text?: string; styles?: Record<string, unknown>; props?: Record<string, unknown>; content?: unknown };

/** Split text items at chip tokens, keeping their styles. */
function chipsFromTokens(content: Inline[]): Inline[] {
  return content.flatMap((c) => {
    if (c.type !== 'text' || !c.text?.includes('⟦u:')) return [c];
    const out: Inline[] = [];
    let last = 0;
    for (const m of c.text.matchAll(TOKEN)) {
      if (m.index! > last) out.push({ ...c, text: c.text.slice(last, m.index) });
      out.push({ type: 'idea', props: { id: m[1] } });
      last = m.index! + m[0].length;
    }
    if (last < c.text.length) out.push({ ...c, text: c.text.slice(last) });
    return out;
  });
}

function tokensFromChips(content: Inline[]): Inline[] {
  return content.map((c) => (c.type === 'idea' ? { type: 'text', text: `⟦u:${String(c.props?.id)}⟧`, styles: {} } : c));
}

/** Apply `f` to every block's inline content, children and table cells included. */
function mapInline(blocks: ScratchBlock[], f: (c: Inline[]) => Inline[]): ScratchBlock[] {
  return blocks.map((b) => {
    const any = b as unknown as { content?: unknown; children: ScratchBlock[] };
    let content = any.content;
    if (Array.isArray(content)) content = f(content as Inline[]);
    else if (content && (content as { type?: string }).type === 'tableContent') {
      const t = content as { rows: { cells: unknown[] }[] };
      content = { ...t, rows: t.rows.map((r) => ({ ...r, cells: r.cells.map((cell) => (Array.isArray(cell) ? f(cell as Inline[])
        : cell && typeof cell === 'object' && Array.isArray((cell as { content?: unknown }).content)
          ? { ...(cell as object), content: f((cell as { content: Inline[] }).content) } : cell)) })) };
    }
    return { ...b, content, children: mapInline(any.children ?? [], f) } as ScratchBlock;
  });
}

/** One section's markdown as blocks (never empty: an editor always holds at least one line). */
export function markdownToBlocks(editor: ScratchEditor, md: string): ScratchBlock[] {
  const text = md.replace(ANCHOR, '⟦u:$1⟧').trim();
  const blocks = text ? mapInline(editor.tryParseMarkdownToBlocks(text), chipsFromTokens) : [];
  return blocks.length ? blocks : [{ type: 'paragraph' } as unknown as ScratchBlock];
}

/** One section's blocks as markdown, anchors back to `<!--u:id-->`. */
export function blocksToMarkdown(editor: ScratchEditor, blocks: ScratchBlock[]): string {
  return editor.blocksToMarkdownLossy(mapInline(blocks, tokensFromChips)).replace(TOKEN, '<!--u:$1-->').trim();
}

export type Part = { lane: string; md: string };

/** The stored draft as sections in order. Text before the first marker belongs to the first section. */
export function splitSections(doc: string): Part[] {
  const parts: Part[] = [];
  const lead: string[] = [];
  for (const line of doc.split('\n')) {
    const m = line.trim().match(SECTION);
    if (m) parts.push({ lane: m[1], md: '' });
    else if (parts.length) parts[parts.length - 1].md += (parts[parts.length - 1].md ? '\n' : '') + line;
    else lead.push(line);
  }
  if (parts.length && lead.join('').trim()) parts[0].md = `${lead.join('\n')}\n${parts[0].md}`;
  return parts.map((p) => ({ ...p, md: p.md.trim() }));
}

/** Sections back into the stored draft: each marker on its own line, then its text. */
export const joinSections = (parts: Part[]) => parts.map((p) => `<!--s:${p.lane}-->\n${p.md ? `${p.md}\n` : ''}`).join('\n');
