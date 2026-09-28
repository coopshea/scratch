import { useEffect, useState } from 'react';
import { SignIn, useAuth, UserButton } from '@clerk/react';
import { App } from './App.tsx';
import { billing } from './api.ts';

type Me = {
  hosted: true; unlimited: boolean;
  offers: { pack: boolean; subscription: boolean };
  account: {
    email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null;
    pro: boolean; proParsesThisMonth: number; credits: number; hasBilling: boolean;
  };
  limits: { freeParses: number; packParses: number; monthlyParses: number };
};

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
  const { limits, offers } = me;
  const freeLeft = Math.max(0, limits.freeParses - a.freeParsesUsed);
  const monthLeft = a.pro ? Math.max(0, limits.monthlyParses - a.proParsesThisMonth) : 0;
  const paid = new URLSearchParams(location.search).get('paid');
  const [waiting, setWaiting] = useState(!!paid);

  // Back from Stripe: the webhook can land a moment after the redirect, so look again until the purchase shows.
  useEffect(() => {
    if (!paid) return;
    const before = a.credits;
    let tries = 0;
    const t = setInterval(async () => {
      const res = await fetch('/api/me');
      if (!res.ok) return;
      const next: Me = await res.json();
      const arrived = paid === 'subscription' ? next.account.pro : next.account.credits > before;
      if (arrived || ++tries > 10) { onChange(next); setWaiting(false); clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
  }, [paid]);

  const buy = (what: 'pack' | 'subscription') => billing.checkout(what).catch((e) => setError(e.message));

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

  const left = [
    freeLeft > 0 && `${freeLeft} free`,
    a.pro && `${monthLeft} of ${limits.monthlyParses} this month`,
    a.credits > 0 && `${a.credits} bought`,
  ].filter(Boolean);

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

        <h2>Parses</h2>
        {me.unlimited ? (
          <p>Unlimited. You're an owner of this site.</p>
        ) : (
          <>
            <p>
              {left.length ? <>Left: {left.join(' · ')}.</> : a.hasOwnKey ? <>Parses run on your own key.</> : <>None left.</>}
              {waiting && <span className="hint"> Payment received, adding it…</span>}
            </p>
            <p className="hint">
              Each parse costs about 2 to 20 cents of model time, depending on its length. Add your own Anthropic key and
              pay as you go, or buy parses here: what's left over buys me a coffee.
            </p>
            {(offers.pack || offers.subscription) && (
              <p className="buy">
                {offers.pack && <button className="stage" onClick={() => buy('pack')}>buy {limits.packParses} parses</button>}
                {offers.subscription && (a.pro
                  ? <button className="stage" onClick={() => billing.portal().catch((e) => setError(e.message))}>manage subscription</button>
                  : <button className="stage" onClick={() => buy('subscription')}>subscribe · {limits.monthlyParses} a month</button>)}
              </p>
            )}
          </>
        )}

        <h2>Your Anthropic API key</h2>
        <p className="hint">
          Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          Once your free and bought parses are used, parses run on this key and Anthropic bills you directly.
          It's stored encrypted, used only to run your parses, and never shown again. Remove it anytime.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input type="password" autoComplete="off" placeholder={a.hasOwnKey ? `saved, ending ${a.keyHint}` : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="stage" type="submit" disabled={!key.trim()}>save</button>
          {a.hasOwnKey && <button className="link" type="button" onClick={() => save(true)}>remove key</button>}
        </form>
        {error && <p className="top-error">{error}</p>}
      </main>
    </div>
  );
}
