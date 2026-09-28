import { useEffect, useState } from 'react';
import { SignIn, useAuth, UserButton } from '@clerk/react';
import { App } from './App.tsx';
import { billing } from './api.ts';

type Me = {
  hosted: true; unlimited: boolean; billing: boolean;
  account: { email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null; pro: boolean; proParsesThisMonth: number; hasBilling: boolean };
  limits: { freeParses: number; proMonthlyParses: number; freeBlurt: number; proBlurt: number };
};
const pages = (chars: number) => Math.round(chars / 2800);

const onAccountPage = () => new URLSearchParams(location.search).has('account');

/** The hosted site: sign in, then the app, or the account page at ?account. */
export function Gate() {
  const { isLoaded, isSignedIn } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch('/api/me').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMe(body); else setProblem(body.error ?? `Could not load your account (${res.status})`);
    }).catch(() => setProblem('Could not reach the server'));
  }, [isSignedIn]);

  if (!isLoaded) return <div className="loading" />;
  if (!isSignedIn) {
    return (
      <div className="gate">
        <h1>Scratch</h1>
        <p>Blurt, structure, draft. The model cuts and labels; it never writes your prose.</p>
        <SignIn routing="hash" />
      </div>
    );
  }
  if (problem) return <div className="gate"><h1>Scratch</h1><p>{problem}</p><UserButton /></div>;
  if (!me) return <div className="loading" />;

  const menu = (
    <span className="account-menu">
      <a className="stage" href="?account" title="Free parses and your API key">account</a>
      <UserButton />
    </span>
  );
  return onAccountPage() ? <Account me={me} onChange={setMe} menu={menu} /> : <App account={menu} />;
}

function Account({ me, onChange, menu }: { me: Me; onChange: (m: Me) => void; menu: React.ReactNode }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const a = me.account;
  const { limits } = me;
  const left = Math.max(0, limits.freeParses - a.freeParsesUsed);
  const upgraded = new URLSearchParams(location.search).has('upgraded');

  // Back from Stripe: the webhook may land a moment after the redirect, so look again until Pro shows.
  useEffect(() => {
    if (!upgraded || a.pro) return;
    let tries = 0;
    const t = setInterval(async () => {
      const res = await fetch('/api/me');
      if (res.ok) { const next = await res.json(); if (next.account.pro || ++tries > 10) { onChange(next); clearInterval(t); } }
    }, 2000);
    return () => clearInterval(t);
  }, [upgraded, a.pro]);

  const save = async (remove = false) => {
    setError(null);
    const res = await fetch('/api/me/key', remove
      ? { method: 'DELETE' }
      : { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Could not save');
    setKey('');
    onChange({ ...me, account: body });
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="link" href="/">‹ back to writing</a>
        <span className="spacer" />
        {menu}
      </header>
      <main className="account">
        <h1>Account</h1>
        <p>{a.email}</p>
        <h2>Plan</h2>
        {me.unlimited ? (
          <p>Unlimited: you're an owner of this site, so parses use the site's key with no limits.</p>
        ) : a.pro ? (
          <>
            <p>Pro. Blurts up to {pages(limits.proBlurt)} pages; {a.proParsesThisMonth} of {limits.proMonthlyParses} parses used this month.
              {a.hasOwnKey && <> After that, parses use your own key.</>}</p>
            <button className="stage" onClick={() => billing.portal().catch((e) => setError(e.message))}>manage billing</button>
          </>
        ) : (
          <>
            <p>
              Free. Blurts up to {pages(limits.freeBlurt)} pages.{' '}
              {a.hasOwnKey
                ? <>Parses use your own Anthropic key, ending <code>{a.keyHint}</code>.</>
                : <>{left} of {limits.freeParses} free parses left; after that, add your own Anthropic key below.</>}
            </p>
            {upgraded && <p className="hint">Payment received. Switching you to Pro…</p>}
            {me.billing && !upgraded && (
              <p>
                <button className="stage" onClick={() => billing.checkout().catch((e) => setError(e.message))}>upgrade to Pro</button>
                <span className="hint"> · blurts up to {pages(limits.proBlurt)} pages, {limits.proMonthlyParses} parses a month on our key, monthly, cancel anytime</span>
              </p>
            )}
          </>
        )}
        <h2>Your Anthropic API key</h2>
        <p className="hint">
          Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          It's stored encrypted and never sent back to your browser; parses are billed to your Anthropic account.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="stage" type="submit" disabled={!key.trim()}>save</button>
          {a.hasOwnKey && <button className="link" type="button" onClick={() => save(true)}>remove key</button>}
        </form>
        {error && <p className="top-error">{error}</p>}
      </main>
    </div>
  );
}
