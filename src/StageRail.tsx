import { Fragment, useEffect, useState } from 'react';
import { MantineProvider, Tooltip } from '@mantine/core';
import { Icon } from './icons.tsx';

export type Stage = 'talk' | 'structure' | 'draft';
export const STAGES: Stage[] = ['talk', 'structure', 'draft'];
/** What the writer sees; the stage ids stay as they are in code, saved preferences and the event log. */
export const STAGE_NAME: Record<Stage, string> = { talk: 'Spill', structure: 'Shape', draft: 'Draft' };
const STAGE_TIP: Record<Stage, string> = {
  talk: 'Get everything out of your head.',
  structure: 'Decide what goes where.',
  draft: 'Turn your outline into finished writing.',
};
/** One line the first time someone enters a stage, gone on their first action there. */
const STAGE_HINT: Record<Stage, string> = {
  talk: 'Type or talk; Parse cuts it into ideas.',
  structure: 'Drag ideas onto the outline.',
  draft: 'Write each section; drag ideas into the text.',
};

// Per browser: accounts have no place for interface flags, and a hint seen twice costs little.
const hintKey = (s: Stage) => `hint-seen:${s}`;
const hintSeen = (s: Stage) => { try { return localStorage.getItem(hintKey(s)) === '1'; } catch { return true; } };
const markSeen = (s: Stage) => { try { localStorage.setItem(hintKey(s), '1'); } catch { /* storage unavailable */ } };

/**
 * The hint for this stage, if it hasn't been seen: shown on entering, and on the first action below the bar (a press
 * released, or a key) it folds away and is marked seen. Folding on release, not press, keeps a drag from jumping.
 */
export function useStageHint(stage: Stage, quiet: boolean) {
  const [hint, setHint] = useState<{ stage: Stage; leaving: boolean } | null>(null);
  useEffect(() => { setHint(quiet || hintSeen(stage) ? null : { stage, leaving: false }); }, [stage, quiet]);

  const live = hint && !hint.leaving ? hint.stage : null;
  useEffect(() => {
    if (!live) return;
    const done = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.topbar')) return;
      markSeen(live);
      setHint({ stage: live, leaving: true });
    };
    document.addEventListener('pointerup', done, true);
    document.addEventListener('keydown', done, true);
    return () => { document.removeEventListener('pointerup', done, true); document.removeEventListener('keydown', done, true); };
  }, [live]);
  // Gone once it has folded.
  useEffect(() => {
    if (!hint?.leaving) return;
    const t = window.setTimeout(() => setHint((h) => (h?.leaving ? null : h)), 220);
    return () => window.clearTimeout(t);
  }, [hint?.leaving]);
  return hint;
}

/** One quiet line under the bar. */
export function StageHint({ hint }: { hint: ReturnType<typeof useStageHint> }) {
  return hint && <p className={`stage-hint ${hint.leaving ? 'leaving' : ''}`} role="status">{STAGE_HINT[hint.stage]}</p>;
}

/**
 * The stages, 1 › 2 › 3, and the only way between them. When the current stage has done its part, the next one
 * turns blue with an arrow. `quiet` (History) drops the arrow. `hint` is the stage whose hint is showing.
 */
export function StageRail({ stage, next, onStage, quiet, hint }: { stage: Stage; next: Stage | null; onStage: (s: Stage) => void; quiet: boolean; hint: Stage | null }) {
  return (
    <MantineProvider forceColorScheme="light" theme={{ fontFamily: 'var(--sans)' }}>
      <nav className="rail" aria-label="Stages">
        {STAGES.map((s, i) => {
          const lit = !quiet && s === next;
          return (
            <Fragment key={s}>
              {i > 0 && <span className="sep" aria-hidden><Icon name="chevron" small /></span>}
              {/* While a stage's hint shows, its tooltip waits, so only one line speaks at a time. */}
              <Tooltip label={STAGE_TIP[s]} openDelay={500} position="bottom" offset={8} events={{ hover: true, focus: true, touch: false }}
                classNames={{ tooltip: 'stage-tip' }} disabled={s === hint}>
                <button className={`step ${s === stage ? 'on' : ''} ${lit ? 'next' : ''}`} aria-current={s === stage ? 'step' : undefined}
                  onClick={() => onStage(s)}><span className="num">{i + 1}</span>{STAGE_NAME[s]}{lit && <Icon name="arrow" small />}</button>
              </Tooltip>
            </Fragment>
          );
        })}
      </nav>
    </MantineProvider>
  );
}
