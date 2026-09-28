import { useState } from 'react';
import { useCombobox } from 'downshift';
import type { Role } from '../shared/structures.ts';

type Common = { name: string; role: Role; numbered?: boolean };

/** Levels people reach for most. Numbered ones count up: argument 1, argument 2. */
const COMMON: Common[] = [
  { name: 'hook', role: 'hook' },
  { name: 'background', role: 'context' },
  { name: 'stakes', role: 'context' },
  { name: 'prior work', role: 'context' },
  { name: 'thesis', role: 'thesis' },
  { name: 'argument', role: 'point', numbered: true },
  { name: 'reason', role: 'point', numbered: true },
  { name: 'section', role: 'point', numbered: true },
  { name: 'method', role: 'point' },
  { name: 'results', role: 'point' },
  { name: 'worked example', role: 'example' },
  { name: 'example', role: 'example', numbered: true },
  { name: 'counterargument', role: 'objection' },
  { name: 'limitations', role: 'objection' },
  { name: 'common misconception', role: 'objection' },
  { name: 'discussion', role: 'close' },
  { name: 'conclusion', role: 'close' },
  { name: 'call to action', role: 'close' },
  { name: 'open questions', role: 'close' },
  { name: 'footnotes', role: 'footnote' },
];

function nextNumbered(base: string, existing: string[]) {
  const re = new RegExp(`^${base}(?: (\\d+))?$`);
  let n = 1;
  for (const e of existing) { const m = e.match(re); if (m) n = Math.max(n, (m[1] ? Number(m[1]) : 1) + 1); }
  return `${base} ${n}`;
}

type Item = { label: string; role: Role };

/**
 * Editable combobox: type to filter, Tab takes the top match, Enter keeps exactly what was typed
 * (or the item picked with the arrow keys), Escape cancels.
 */
export function LevelPicker({ existing, onPick, onCancel }: { existing: string[]; onPick: (name: string, role?: Role) => void; onCancel: () => void }) {
  const [input, setInput] = useState('');
  const q = input.trim().toLowerCase();
  const items: Item[] = COMMON
    .filter((c) => !q || c.name.includes(q))
    .map((c) => ({ label: c.numbered ? nextNumbered(c.name, existing) : c.name, role: c.role }))
    .filter((i) => !existing.includes(i.label));

  const { getInputProps, getMenuProps, getItemProps, highlightedIndex } = useCombobox<Item>({
    items,
    inputValue: input,
    isOpen: true,
    defaultHighlightedIndex: -1,
    itemToString: (i) => i?.label ?? '',
    onInputValueChange: ({ inputValue, type }) => { if (type === useCombobox.stateChangeTypes.InputChange) setInput(inputValue ?? ''); },
    onSelectedItemChange: ({ selectedItem }) => { if (selectedItem) onPick(selectedItem.label, selectedItem.role); },
  });

  return (
    <div className="level-picker">
      <input
        {...getInputProps({
          autoFocus: true,
          spellCheck: false,
          onKeyDown: (e) => {
            const native = e.nativeEvent as KeyboardEvent & { preventDownshiftDefault?: boolean };
            if (e.key === 'Tab' && items[0]) { e.preventDefault(); native.preventDownshiftDefault = true; onPick(items[0].label, items[0].role); }
            // Read the field itself: state can lag a fast typist by a keystroke.
            else if (e.key === 'Enter' && highlightedIndex < 0) { e.preventDefault(); native.preventDownshiftDefault = true; const typed = e.currentTarget.value.trim().toLowerCase(); if (typed) onPick(typed); }
            else if (e.key === 'Escape') { native.preventDownshiftDefault = true; onCancel(); }
          },
          onBlur: () => { if (!q) onCancel(); },
        })}
      />
      <ul {...getMenuProps()} className="picker-menu">
        {items.slice(0, 8).map((item, index) => (
          <li key={item.label} {...getItemProps({ item, index })} className={`${highlightedIndex === index ? 'hl' : ''} ${index === 0 && highlightedIndex < 0 && q ? 'top' : ''}`}>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
