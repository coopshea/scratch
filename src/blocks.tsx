import { createContext, useContext } from 'react';
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, filterSuggestionItems } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import {
  createReactInlineContentSpec, getDefaultReactSlashMenuItems, SideMenu, useExtensionState, type SideMenuProps,
} from '@blocknote/react';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * One block schema for every BlockNote editor in Scratch: the note in the idea sheet and each section of the draft. Sharing it is
 * what lets a block be dragged from one into another; BlockNote moves blocks between editors on the same page when
 * their schemas match.
 */

/** Unit labels by id, for chips. Draft provides it; elsewhere a chip falls back to "idea". */
export const ChipLabels = createContext<Map<string, string>>(new Map());

/** An idea placed in the text: a quiet chip showing the idea's label. */
function Chip({ id }: { id: string }) {
  const labels = useContext(ChipLabels);
  return <span className="draft-chip" data-id={id}>{labels.get(id) ?? 'idea'}</span>;
}
const Idea = createReactInlineContentSpec(
  { type: 'idea', propSchema: { id: { default: '' } }, content: 'none' },
  { meta: { draggable: true }, render: ({ inlineContent }) => <Chip id={inlineContent.props.id} /> },
);
// BlockNote makes inline content without text unselectable. A chip should behave like a word: click selects it,
// Backspace deletes it, and it drags to another spot.
Idea.implementation.node = Idea.implementation.node.extend({ selectable: true, draggable: true });

/** No hint naming the kind of block just chosen from the / menu ("Heading", "List", "Toggle"): the line is empty, and the writer types. */
export const noBlockHints = { heading: '', bulletListItem: '', numberedListItem: '', checkListItem: '', toggleListItem: '' };

export const schema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: { ...defaultInlineContentSpecs, idea: Idea },
});
export type ScratchEditor = typeof schema.BlockNoteEditor;
export type ScratchBlock = typeof schema.Block;

/** Scratch's own slash items come first in the menu, ahead of BlockNote's. A gap, `[ ]`, for something to find out later, with the cursor inside it. */
function gapItem(editor: ScratchEditor) {
  return {
    title: 'Gap',
    subtext: 'Something to find out later',
    aliases: ['gap', 'todo', 'later', 'bracket'],
    group: 'Scratch',
    icon: <span className="slash-glyph">[ ]</span>,
    onItemClick: () => {
      editor.insertInlineContent(['[]']);
      const tt = editor._tiptapEditor;
      tt.commands.setTextSelection(tt.state.selection.from - 1);
    },
  };
}

/**
 * Marks each code block spellcheck="false" (and the one holding the cursor, code-here) through the editor's own decorations. Setting the attribute on the DOM
 * directly makes the editor redraw the block, which drops it again (and a watcher re-adding it loops forever).
 */
export const noSpellcheckInCode = () => new Plugin({
  props: {
    decorations: (state) => {
      const marks: Decoration[] = [];
      const { from } = state.selection;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'codeBlock') return true;
        // The block holding the cursor is marked too, so it can say how to leave it.
        const here = from > pos && from < pos + node.nodeSize;
        marks.push(Decoration.node(pos, pos + node.nodeSize, here ? { spellcheck: 'false', class: 'code-here' } : { spellcheck: 'false' }));
        return false;
      });
      return DecorationSet.create(state.doc, marks);
    },
  },
});

export const slashItems = async (editor: ScratchEditor, query: string) =>
  filterSuggestionItems([gapItem(editor), ...getDefaultReactSlashMenuItems(editor)], query);

/**
 * The + and drag handle show beside a block with something in it, not beside an empty line: an empty line already
 * reads as a place to write, and handles on each one looked like a stack of new boxes.
 */
export function ScratchSideMenu(props: SideMenuProps) {
  const block = useExtensionState(SideMenuExtension, { selector: (s) => s?.block });
  if (!block) return null;
  const empty = Array.isArray(block.content) && block.content.length === 0 && block.type === 'paragraph' && !block.children.length;
  return empty ? null : <SideMenu {...props} />;
}
