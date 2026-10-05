import { useEffect } from 'react';
import { demoSeen } from './demoScript.ts';

/**
 * The Spill board before anything is cut: one line saying what gathers here. On a writer's first visit, it plays the
 * demo instead (Demo.tsx), once; it's there again from the ? menu.
 */
export function EmptyBoard({ onDemo }: { onDemo?: () => void }) {
  useEffect(() => {
    if (!onDemo || demoSeen() || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    onDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="empty">
      <p className="hint">Ideas gather here in loose groups. Let's get those ducks in a row.</p>
    </div>
  );
}
