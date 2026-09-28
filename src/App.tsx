import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Unit } from '../shared/types.ts';
import { structureMap, type Board, type StructureDef } from '../shared/structures.ts';
import { replay, type LogEvent } from '../shared/replay.ts';
import { settle } from '../shared/clusters.ts';
import { api, archetypes, slug } from './api.ts';
import { DocList } from './DocList.tsx';
import { Draft } from './Draft.tsx';
import { Graph } from './Graph.tsx';
import { History } from './History.tsx';
import { NoteSheet } from './NoteSheet.tsx';
import { Structure } from './Structure.tsx';
import { Talk } from './Talk.tsx';

type Stage = 'talk' | 'structure' | 'draft';
const STAGES: Stage[] = ['talk', 'structure', 'draft'];

const readPref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

function Title({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input className="title" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck
      onBlur={() => { const t = draft.trim(); if (t && t !== value) onSave(t); else setDraft(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); } }} />
  );
}

/** `account` is the signed-in writer's menu on the hosted site; absent locally. */
export function App({ account }: { account?: React.ReactNode } = {}) {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedBlurtId, setFailedBlurtId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ events: LogEvent[]; count: number } | null>(null);
  const [stage, setStageState] = useState<Stage>(() => (readPref(`stage:${slug}`, 'talk') as Stage));
  const [docsOpen, setDocsOpen] = useState(() => readPref('docs-open', 'false') === 'true');
  const boardSeq = useRef(0);
  const [custom, setCustom] = useState<StructureDef[]>([]);
  const structures = useMemo(() => structureMap(custom), [custom]);
  useEffect(() => { archetypes.list().then(setCustom).catch(() => undefined); }, []);
  const [copied, setCopied] = useState(false);

  const copyExport = async () => {
    try {
      const md = await (await fetch(`/api/p/${slug}/export.md?copy=1`)).text();
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) { setError((e as Error).message); }
  };

  const setStage = (s: Stage) => { setStageState(s); setSelectedId(null); writePref(`stage:${slug}`, s); };
  const toggleDocs = () => setDocsOpen((o) => { writePref('docs-open', String(!o)); return !o; });

  const setUnits = useCallback((fn: (u: Unit[]) => Unit[]) => setProject((p) => (p ? { ...p, units: fn(p.units) } : p)), []);

  useEffect(() => { api.load().then(setProject).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (project) document.title = project.meta.title; }, [project?.meta.title]);

  const handleParsed = async (res: Awaited<ReturnType<typeof api.blurt>>) => {
    setProject((p) => (p ? { ...p, blurts: p.blurts.some((b) => b.id === res.blurt.id) ? p.blurts : [...p.blurts, res.blurt] } : p));
    if (res.error) {
      setError(res.error); setFailedBlurtId(res.blurt.id);
      // Hosted, out of parses. The blurt is already saved, so leaving for the account page loses nothing.
      if (res.buy && confirm(`${res.error}\n\nOpen your account page?`)) location.href = '/?account';
      return false;
    }
    setError(null); setFailedBlurtId(null);
    setProject(await api.load());
    return true;
  };

  const onBlurt = async (text: string) => {
    setBusy(true);
    try { return await handleParsed(await api.blurt(text)); }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const onReparse = async (id: string) => {
    setBusy(true);
    try { await handleParsed(await api.reparse(id)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const onPatch = async (id: string, patch: Partial<Unit>) => {
    if (history) return;
    const prev = project?.units;
    setUnits((us) => us.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    try {
      const saved = await api.patch(id, patch);
      setUnits((us) => {
        const next = us.map((u) => (u.id === id ? saved : { ...u }));
        settle(next, saved);
        return next;
      });
      if (patch.status === 'cut' && selectedId === id) setSelectedId(null);
    } catch (e) {
      if (prev) setUnits(() => prev);
      setError((e as Error).message);
    }
  };

  const onBoard = (board: Board, auto = false) => {
    if (history) return;
    setProject((p) => (p ? { ...p, board } : p));
    const seq = ++boardSeq.current;
    api.saveBoard(board, auto).catch((e) => { if (seq === boardSeq.current) setError(e.message); });
  };

  const onRename = async (title: string) => {
    try { const meta = await api.rename(title); setProject((p) => (p ? { ...p, meta } : p)); }
    catch (e) { setError((e as Error).message); }
  };

  const toggleHistory = async () => {
    setSelectedId(null);
    if (history) { setHistory(null); setProject(await api.load()); return; }
    const events = await api.events();
    setHistory({ events, count: events.length });
  };

  const past = useMemo(() => (history ? replay(history.events, history.count) : null), [history]);

  if (!project) return <div className="loading">{error ?? ''}</div>;
  const units = past ? past.units : project.units;
  const blurts = past ? past.blurts : project.blurts;
  const board = past ? past.board : project.board;
  const draft = past ? past.draft : project.draft;
  const selected = units.find((u) => u.id === selectedId && (past || u.status !== 'cut')) ?? null;

  const sheet = selected && (
    <NoteSheet unit={selected} units={units} blurts={blurts} onPatch={onPatch} readOnly={!!history} takeFocus={stage !== 'draft'}
      version={history ? String(history.count) : ''} onClose={() => setSelectedId(null)} onFocus={setSelectedId} />
  );

  let body: React.ReactNode;
  if (stage === 'talk') {
    body = (
      <main className={`body talk-stage ${selected ? 'has-sheet' : ''}`}>
        {past && history
          ? <History events={history.events} count={history.count} onCount={(count) => setHistory({ ...history, count })}
              units={past.units} selectedId={selectedId} onSelect={setSelectedId} />
          : <Talk units={units} blurts={blurts} busy={busy} error={error} failedBlurtId={failedBlurtId}
              onBlurt={onBlurt} onReparse={onReparse} sheetOpen={!!selected} />}
        <section className="canvas">
          {units.some((u) => u.status !== 'cut')
            ? <Graph units={units} selectedId={selectedId} onSelect={setSelectedId} />
            : <div className="empty" />}
        </section>
        {sheet}
      </main>
    );
  } else if (stage === 'structure') {
    body = (
      <main className={`body structure-stage ${selected ? 'has-sheet' : ''}`}>
        {history && <History events={history.events} count={history.count} onCount={(count) => setHistory({ ...history, count })}
          units={units} selectedId={selectedId} onSelect={setSelectedId} />}
        <Structure units={units} board={board} onBoard={onBoard} structures={structures} onCustom={setCustom} onSelect={setSelectedId} selectedId={selectedId} readOnly={!!history} />
        {sheet}
      </main>
    );
  } else {
    body = (
      <main className={`body draft-stage ${selected ? 'has-sheet' : ''}`}>
        {history
          ? <>
              <History events={history.events} count={history.count} onCount={(count) => setHistory({ ...history, count })}
                units={units} selectedId={selectedId} onSelect={setSelectedId} />
              <div className="page past">{draft}</div>
            </>
          : <Draft key={slug} units={units} board={board} draft={draft} structures={structures} onSelect={setSelectedId} onBoard={onBoard}
              onDraft={(t) => setProject((p) => (p ? { ...p, draft: t } : p))} />}
        {sheet}
      </main>
    );
  }

  return (
    <div className={`shell ${docsOpen ? 'docs-open' : ''}`}>
      {docsOpen && <DocList />}
      <div className="app">
        <header className="topbar">
          <button className="link docs-toggle" onClick={toggleDocs} aria-label="Documents" title="Documents">{docsOpen ? '‹' : '≡'}</button>
          <Title value={project.meta.title} onSave={onRename} />
          <nav className="stages" aria-label="Stages">
            {STAGES.map((s, i) => (
              <span key={s} className="step">
                {i > 0 && <span className="sep" aria-hidden>›</span>}
                <button className={`stage ${s === stage ? 'on' : i < STAGES.indexOf(stage) ? 'past' : 'ahead'}`}
                  aria-current={s === stage ? 'step' : undefined} onClick={() => setStage(s)}>{s}</button>
              </span>
            ))}
          </nav>
          {!history && stage !== 'draft' && (stage !== 'talk' || units.some((u) => u.status !== 'cut')) && (
            <button className="link next" onClick={() => setStage(STAGES[STAGES.indexOf(stage) + 1])}>{STAGES[STAGES.indexOf(stage) + 1]} →</button>
          )}
          <span className="spacer" />
          {error && stage !== 'talk' && <span className="top-error" onClick={() => setError(null)}>{error}</span>}
          <a className="stage" href={`/api/p/${slug}/export.md`} download title="Download clean markdown">export</a>
          <button className="stage" onClick={copyExport} title="Copy clean markdown">{copied ? 'copied' : 'copy'}</button>
          <button className={`stage ${history ? 'on' : ''}`} onClick={toggleHistory}>history</button>
          {account}
        </header>
        {body}
      </div>
    </div>
  );
}
