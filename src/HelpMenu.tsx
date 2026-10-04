import { useState } from 'react';
import { MantineProvider, Menu, Modal } from '@mantine/core';
// The component styles come in with BlockNote's (main.tsx); its variables are scoped to the editor, so Mantine's defaults go on the root.
import '@mantine/core/styles/default-css-variables.layer.css';
import { projects } from './api.ts';
import { Icon } from './icons.tsx';
import { posthog } from './posthog.ts';

/** Only shortcuts that exist. Keep in step with the handlers (Talk, NoteSheet, Draft, LevelPicker, Structure). */
const SHORTCUTS: [keys: string[], what: string][] = [
  [['⌘', '↵'], 'Parse writing'],
  [['⌘', '⇧', 'E'], 'From your reading, in a note'],
  [['1', '–', '5'], 'Pick a passage'],
  [['Esc'], 'Close a note or list'],
  [['/'], 'Blocks, in a note or the draft'],
  [['⌘', 'Z'], 'Undo in the draft'],
  [['⌘', '⇧', 'Z'], 'Redo in the draft'],
  [['⌘', 'A', '⌘', 'A'], 'Select the whole draft'],
  [['Tab'], 'Take the top match, adding a level'],
];

/** The ? at the top right. Mantine's menu and modal (already here through BlockNote), styled by the app's tokens. */
export function HelpMenu({ onError }: { onError: (message: string) => void }) {
  const [keys, setKeys] = useState(false);

  const openExample = async () => {
    try {
      const { slug } = await projects.fromExample();
      posthog?.capture('example_opened');
      location.search = `?p=${encodeURIComponent(slug)}`;
    } catch (e) { onError((e as Error).message); }
  };

  return (
    <MantineProvider forceColorScheme="light" theme={{ fontFamily: 'var(--sans)' }}>
      <Menu position="bottom-end" offset={6} width={200} classNames={{ dropdown: 'help-menu', item: 'help-item' }}>
        <Menu.Target>
          <button className="icon-btn" aria-label="Help" title="Help"><Icon name="help" /></button>
        </Menu.Target>
        <Menu.Dropdown>
          {/* "Watch the demo" goes first here once the demo exists (#45). */}
          <Menu.Item onClick={openExample}>Open an example</Menu.Item>
          <Menu.Item onClick={() => setKeys(true)}>Keyboard shortcuts</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={keys} onClose={() => setKeys(false)} title="Keyboard shortcuts" size="sm" centered
        classNames={{ content: 'help-sheet', title: 'help-sheet-title' }}>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, what]) => (
            <div key={what}>
              <dt>{k.map((c, i) => (c === '–' ? <span key={i}>–</span> : <kbd key={i} className="kbd">{c}</kbd>))}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </MantineProvider>
  );
}
