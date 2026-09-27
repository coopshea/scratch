import { useEffect, useState } from 'react';
import { labelProblem, LABEL_MAX_CHARS, LABEL_MAX_WORDS } from '../shared/types.ts';

/** Label field with the hard 6-word / 40-character limit. Invalid labels are never saved. */
export function LabelInput({ value, onSave, autoFocus }: { value: string; onSave: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const problem = labelProblem(draft);
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const commit = () => { if (!problem && draft.trim() !== value) onSave(draft.trim()); };
  return (
    <span className={`label-input ${problem ? 'bad' : ''}`}>
      <textarea
        rows={1}
        value={draft}
        maxLength={LABEL_MAX_CHARS}
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === 'Escape') setDraft(value); }}
        title={problem ?? ''}
      />
      {(problem || words >= LABEL_MAX_WORDS) && <span className="counter">{words}/{LABEL_MAX_WORDS}</span>}
    </span>
  );
}
