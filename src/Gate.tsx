import { useEffect, useState } from 'react';
import { SignIn, useAuth, UserButton } from '@clerk/react';
import { App } from './App.tsx';
import { billing } from './api.ts';

type Me = {
  hosted: true; unlimited: boolean; billing: boolean;
  account: {
    email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null;
    balanceMicros: number; subscribed: boolean; hasBilling: boolean; hasReadwise: boolean;
  };
  pricing: { freeParses: number; markup: number; minCents: number; maxCents: number; fee: { percent: number; cents: number }; donationCents: number };
};

const dollars = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
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
  const [rw, setRw] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const a = me.account;
  const { pricing } = me;
  const freeLeft = Math.max(0, pricing.freeParses - a.freeParsesUsed);
  const paid = new URLSearchParams(location.search).get('paid');
  const [waiting, setWaiting] = useState(!!paid && paid !== 'donation');

  const cents = amount.trim() ? Math.round(Number(amount) * 100) : NaN;
  const valid = Number.isFinite(cents) && cents >= pricing.minCents && cents <= pricing.maxCents;
  const net = valid ? Math.max(0, cents * (1 - pricing.fee.percent / 100) - pricing.fee.cents) * 10_000 : 0;
  // A typical parse is about 8 cents at Anthropic's price.
  const parses = Math.floor(net / (80_000 * pricing.markup));

  // Back from Stripe: the webhook can land a moment after the redirect, so look again until the money shows.
  useEffect(() => {
    if (!paid || paid === 'donation') return;
    const before = a.balanceMicros;
    let tries = 0;
    const t = setInterval(async () => {
      const res = await fetch('/api/me');
      if (!res.ok) return;
      const next: Me = await res.json();
      if (next.account.balanceMicros > before || ++tries > 10) { onChange(next); setWaiting(false); clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
  }, [paid]);

  const pay = (what: 'topup' | 'subscription') => billing.checkout(what, cents).catch((e) => setError(e.message));

  const save = async (remove = false, path = '/api/me/key', body: object = { key }) => {
    setError(null);
    const res = await fetch(path, remove
      ? { method: 'DELETE' }
      : { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const got = await res.json().catch(() => ({}));
    if (!res.ok) return setError(got.error ?? 'Could not save');
    setKey(''); setRw('');
    onChange({ ...me, account: got });
  };
  const saveReadwise = (remove = false) => save(remove, '/api/me/readwise', { token: rw });

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
        {me.unlimited && <p>Unlimited: you're an owner of this site, so your parses don't draw on the balance below.</p>}
        {(
          <>
            <p>
              {freeLeft > 0 && <>{freeLeft} free {freeLeft === 1 ? 'parse' : 'parses'} left · </>}
              Balance {dollars(Math.max(0, a.balanceMicros))}
              {a.subscribed && <> · subscribed monthly</>}
              {waiting && <span className="hint"> · payment received, adding it…</span>}
            </p>
            <p className="hint">
              Scratch runs at cost. A parse uses about 2 to 20 cents of model time, depending on its length, and that's
              all you're charged, plus Stripe's card fee when you add money. Add your own Anthropic key to pay Anthropic
              directly, or add any amount here, once or monthly, and get that much usage.
            </p>
            {me.billing && (
              <>
                <p className="buy">
                  <label>$<input className="amount" inputMode="decimal" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                  <button className="stage" disabled={!valid} onClick={() => pay('topup')}>add once</button>
                  {a.subscribed
                    ? <button className="stage" onClick={() => billing.portal().catch((e) => setError(e.message))}>manage monthly</button>
                    : <button className="stage" disabled={!valid} onClick={() => pay('subscription')}>add monthly</button>}
                </p>
                <p className="hint">
                  Stripe, the payment processor, keeps {pricing.fee.percent}% + {pricing.fee.cents}¢ of every payment, and the
                  rest becomes your balance. Because part of the fee is fixed, it's a bigger share of small payments.
                  {' '}{valid
                    ? <>Paying ${(cents / 100).toFixed(2)} adds {dollars(net)}, about {parses} {parses === 1 ? 'parse' : 'parses'}.</>
                    : amount.trim()
                      ? <>Enter ${pricing.minCents / 100} to ${pricing.maxCents / 100}.</>
                      : null}
                </p>
              </>
            )}
          </>
        )}

        {me.billing && (
          <>
            <h2>A ream of paper</h2>
            <p className="hint">If Scratch helps your writing, you can buy me a ream of paper. It's a donation, separate from your balance.</p>
            {paid === 'donation' && <p>Thank you for the paper.</p>}
            <p><button className="stage" onClick={() => billing.checkout('donation').catch((e) => setError(e.message))}>
              donate ${me.pricing.donationCents / 100}</button></p>
          </>
        )}

        <h2>Your Anthropic API key</h2>
        <p className="hint">
          Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          Once your free parses and balance are used, parses run on this key and Anthropic bills you directly.
          It's stored encrypted, used only to run your parses, and never shown again. Remove it anytime.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input type="password" autoComplete="off" placeholder={a.hasOwnKey ? `saved, ending ${a.keyHint}` : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="stage" type="submit" disabled={!key.trim()}>save</button>
          {a.hasOwnKey && <button className="link" type="button" onClick={() => save(true)}>remove key</button>}
        </form>

        <h2>Your Readwise token</h2>
        <p className="hint">
          To bring your highlights and notes into your writing. Get it at{' '}
          <a href="https://readwise.io/access_token" target="_blank" rel="noreferrer">readwise.io/access_token</a>.
          Stored encrypted, used only to search and fetch your own highlights, and never shown again.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); saveReadwise(); }}>
          <input type="password" autoComplete="off" placeholder={a.hasReadwise ? 'saved' : 'Readwise access token'} value={rw} onChange={(e) => setRw(e.target.value)} />
          <button className="stage" type="submit" disabled={!rw.trim()}>save</button>
          {a.hasReadwise && <button className="link" type="button" onClick={() => saveReadwise(true)}>remove token</button>}
        </form>
        {error && <p className="top-error">{error}</p>}
      </main>
    </div>
  );
}
