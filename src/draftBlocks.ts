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

export function markdownToBlocks(editor: ScratchEditor, doc: string): ScratchBlock[] {
  const out: ScratchBlock[] = [];
  let buf: string[] = [];
  const flush = () => {
    const md = buf.join('\n').replace(ANCHOR, '⟦u:$1⟧').trim();
    buf = [];
    if (md) out.push(...mapInline(editor.tryParseMarkdownToBlocks(md), chipsFromTokens));
  };
  for (const line of doc.split('\n')) {
    const m = line.trim().match(SECTION);
    if (!m) { buf.push(line); continue; }
    flush();
    out.push({ type: 'section', props: { lane: m[1] } } as unknown as ScratchBlock);
  }
  flush();
  // Every section keeps a line to write on, as the markdown draft's blank line under each marker did.
  return out.flatMap((b, i) => (b.type === 'section' && (i + 1 === out.length || out[i + 1].type === 'section')
    ? [b, { type: 'paragraph' } as unknown as ScratchBlock] : [b]));
}

export function blocksToMarkdown(editor: ScratchEditor, blocks: ScratchBlock[]): string {
  const parts: string[] = [];
  let run: ScratchBlock[] = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(editor.blocksToMarkdownLossy(mapInline(run, tokensFromChips)).replace(TOKEN, '<!--u:$1-->').trim());
    run = [];
  };
  for (const b of blocks) {
    if (b.type !== 'section') { run.push(b); continue; }
    flush();
    parts.push(`<!--s:${(b.props as { lane: string }).lane}-->`);
  }
  flush();
  return parts.join('\n') + '\n';
}
