import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Unit } from '../shared/types.ts';
import { structureMap, type Board, type StructureDef } from '../shared/structures.ts';
import { replay, type LogEvent } from '../shared/replay.ts';
import { settle } from '../shared/clusters.ts';
import { api, archetypes, slug } from './api.ts';
import { DocList } from './DocList.tsx';
import { EmptyBoard } from './EmptyBoard.tsx';
import { Draft } from './Draft.tsx';
import { Graph } from './Graph.tsx';
import { History } from './History.tsx';
import { Loader, useLoaderHold } from './Loader.tsx';
import { Icon } from './icons.tsx';
import { NoteSheet } from './NoteSheet.tsx';
import { Structure } from './Structure.tsx';
import { Talk } from './Talk.tsx';
import { posthog } from './posthog.ts';

type Stage = 'talk' | 'structure' | 'draft';
const STAGES: Stage[] = ['talk', 'structure', 'draft'];
/** What the writer sees; the stage ids stay as they are in code, saved preferences and the event log. */
const STAGE_NAME: Record<Stage, string> = { talk: 'Spill', structure: 'Shape', draft: 'Draft' };
const STAGE_PURPOSE: Record<Stage, string> = { talk: 'Get it all out', structure: 'Give it an order', draft: 'Write it' };

/** Hosted only: credit packs for the out-of-credits notice, and what buying one does. */
export type Billing = { packs: { cents: number; credits: number }[]; buy: (cents: number, blurtId: string) => void; keyHref: string };

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

/**
 * Hosted only: `account` is the writer's credits and menu, `billing` buys credits from the out-of-credits notice, and
 * `onSpent` tells the page a cut was attempted so the credit count can refresh. All absent locally.
 */
export function App({ account, billing, onSpent }: { account?: React.ReactNode; billing?: Billing; onSpent?: () => void } = {}) {
  const [project, setProject] = useState<Project | null>(null);
  const hold = useLoaderHold();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedBlurtId, setFailedBlurtId] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [history, setHistory] = useState<{ events: LogEvent[]; count: number } | null>(null);
  const [stage, setStageState] = useState<Stage>(() => (readPref(`stage:${slug}`, 'talk') as Stage));
  const [docsOpen, setDocsOpen] = useState(() => readPref('docs-open', 'false') === 'true');
  const boardSeq = useRef(0);
  const [custom, setCustom] = useState<StructureDef[]>([]);
  const structures = useMemo(() => structureMap(custom), [custom]);
  // Draft waits for the writer's own outlines, so it never lays out sections for a stand-in outline first.
  const [outlinesLoaded, setOutlinesLoaded] = useState(false);
  useEffect(() => { archetypes.list().then(setCustom).catch(() => undefined).finally(() => setOutlinesLoaded(true)); }, []);
  const [copied, setCopied] = useState(false);

  const copyExport = async () => {
    try {
      const md = await (await fetch(`/api/p/${slug}/export.md?copy=1`)).text();
      await navigator.clipboard.writeText(md);
      posthog?.capture('markdown_copied');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) { setError((e as Error).message); }
  };

  const setStage = (s: Stage) => {
    if (s !== stage) posthog?.capture('stage_changed', { stage: s });
    setStageState(s); setSelectedId(null); writePref(`stage:${slug}`, s);
  };
  const toggleDocs = () => setDocsOpen((o) => { writePref('docs-open', String(!o)); return !o; });

  const setUnits = useCallback((fn: (u: Unit[]) => Unit[]) => setProject((p) => (p ? { ...p, units: fn(p.units) } : p)), []);

  useEffect(() => { api.load().then(setProject).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (project) document.title = project.meta.title; }, [project?.meta.title]);

  const handleParsed = async (res: Awaited<ReturnType<typeof api.blurt>>) => {
    onSpent?.();
    setProject((p) => (p ? { ...p, blurts: p.blurts.some((b) => b.id === res.blurt.id) ? p.blurts : [...p.blurts, res.blurt] } : p));
    if (res.error) {
      // Hosted and out of credits: the notice under the spill offers credits; the blurt is already saved.
      setError(res.error); setFailedBlurtId(res.blurt.id); setOutOfCredits(!!res.buy);
      return false;
    }
    setError(null); setFailedBlurtId(null); setOutOfCredits(false);
    setProject(await api.load());
    return true;
  };

  // Back from buying credits: cut the spill that ran out, once the payment has landed (the webhook can trail the redirect).
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const id = q.get('reparse');
    if (!id || q.get('paid') !== 'topup') return;
    q.delete('reparse'); q.delete('paid');
    window.history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
    let tries = 0, stop = false;
    const attempt = async () => {
      if (stop) return;
      setBusy(true);
      try {
        const res = await api.reparse(id);
        if (res.buy && ++tries < 10) { window.setTimeout(attempt, 2000); return; }
        await handleParsed(res);
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    };
    attempt();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBlurt = async (text: string) => {
    setBusy(true);
    try {
      const parsed = await handleParsed(await api.blurt(text));
      if (parsed) posthog?.capture('ideas_cut', { input_length: text.length });
      return parsed;
    }
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
      const updatedFields = Object.keys(patch).filter((field) => field !== 'note' && field !== 'priorArt');
      if (updatedFields.length) posthog?.capture('unit_updated', { updated_fields: updatedFields });
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
    try {
      const meta = await api.rename(title);
      setProject((p) => (p ? { ...p, meta } : p));
      posthog?.capture('project_renamed');
    }
    catch (e) { setError((e as Error).message); }
  };

  const toggleHistory = async () => {
    setSelectedId(null);
    if (history) { setHistory(null); setProject(await api.load()); return; }
    const events = await api.events();
    setHistory({ events, count: events.length });
  };

  const past = useMemo(() => (history ? replay(history.events, history.count) : null), [history]);

  if (!project || hold) return !project && error ? <div className="loading">{error}</div> : <Loader />;
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
              outOfCredits={outOfCredits} billing={billing} onBlurt={onBlurt} onReparse={onReparse} sheetOpen={!!selected} />}
        <section className="canvas">
          {units.some((u) => u.status !== 'cut')
            ? <>
                <Graph units={units} selectedId={selectedId} onSelect={setSelectedId} />
                {!history && <button className="btn btn-secondary btn-sm next-stage" onClick={() => setStage('structure')}>Shape these ideas <Icon name="arrow" small /></button>}
              </>
            : <EmptyBoard />}
        </section>
        {sheet}
      </main>
    );
  } else if (stage === 'structure') {
    body = (
      <main className={`body structure-stage ${selected ? 'has-sheet' : ''}`}>
        {history && <History events={history.events} count={history.count} onCount={(count) => setHistory({ ...history, count })}
          units={units} selectedId={selectedId} onSelect={setSelectedId} />}
        <Structure units={units} board={board} onBoard={onBoard} structures={structures} onCustom={setCustom} onSelect={setSelectedId} selectedId={selectedId} readOnly={!!history}
          next={!history && <button className="btn btn-secondary btn-sm" onClick={() => setStage('draft')}>Draft it <Icon name="arrow" small /></button>} />
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
          : !outlinesLoaded ? <div className="loading" />
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
          <div className="topbar-side">
            <button className="icon-btn" onClick={toggleDocs} aria-label="Documents" title="Documents"><Icon name="panel" /></button>
            <Title value={project.meta.title} onSave={onRename} />
          </div>
          <nav className="rail" aria-label="Stages">
            {STAGES.map((s, i) => (
              <Fragment key={s}>
                {i > 0 && <span className="sep" aria-hidden><Icon name="chevron" small /></span>}
                <button className={`step ${s === stage ? 'on' : ''}`} aria-current={s === stage ? 'step' : undefined}
                  title={STAGE_PURPOSE[s]} onClick={() => setStage(s)}><span className="num">{i + 1}</span>{STAGE_NAME[s]}</button>
              </Fragment>
            ))}
          </nav>
          <div className="topbar-side right">
            {error && stage !== 'talk' && <span className="top-error" onClick={() => setError(null)}>{error}</span>}
            <button className={`stage ${history ? 'on' : ''}`} onClick={toggleHistory}><Icon name="clock" small /><span className="label">History</span></button>
            <button className="stage" onClick={copyExport} title="Copy clean markdown"><Icon name="copy" small /><span className="label">{copied ? 'Copied' : 'Copy'}</span></button>
            <a className="stage" href={`/api/p/${slug}/export.md`} download title="Download clean markdown"><Icon name="download" small /><span className="label">Export</span></a>
            {account}
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}
