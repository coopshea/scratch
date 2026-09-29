import { useCallback, useEffect, useRef, useState } from 'react';
import { SignIn, useAuth, useUser, UserButton } from '@clerk/react';
import { App, type Billing } from './App.tsx';
import { billing as billingApi, slug } from './api.ts';
import { Icon } from './icons.tsx';
import { openFeedback, posthog } from './posthog.ts';
import { Welcome } from './Welcome.tsx';

export type Me = {
  hosted: true; unlimited: boolean; billing: boolean;
  account: {
    email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null;
    balanceMicros: number; subscribed: boolean; hasBilling: boolean; hasReadwise: boolean;
  };
  pricing: {
    freeParses: number; markup: number; creditMicros: number; minCents: number; maxCents: number;
    fee: { percent: number; cents: number }; donationCents: number;
  };
};

/** Clerk's sign-in, in the design system's type and ink. */
const CLERK_LOOK = {
  variables: {
    colorPrimary: '#1e1c19', colorText: '#1e1c19', colorTextSecondary: '#57524a', colorBackground: '#ffffff', colorInputBackground: '#ffffff',
    colorInputText: '#1e1c19', fontFamily: "'Hanken Grotesk', 'Helvetica Neue', Arial, sans-serif", borderRadius: '8px',
  },
};

const PACKS = [500, 1000, 2000];
const onAccountPage = () => new URLSearchParams(location.search).has('account');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Credits a payment buys: what's left after Stripe's fee, in credits. The balance itself stays in micro-dollars. */
const creditsFor = (cents: number, p: Me['pricing']) =>
  Math.floor((Math.max(0, cents * (1 - p.fee.percent / 100) - p.fee.cents) * 10_000) / p.creditMicros);
const freeLeft = (me: Me) => Math.max(0, me.pricing.freeParses - me.account.freeParsesUsed);
const creditsLeft = (me: Me) => freeLeft(me) + Math.floor(Math.max(0, me.account.balanceMicros) / me.pricing.creditMicros);

/** The hosted site: the welcome page and sign-in, then the app, or the account page at ?account. */
export function Gate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const identifiedUserId = useRef<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isUserLoaded) return;
    if (!isSignedIn || !user) {
      if (identifiedUserId.current) {
        posthog?.reset();
        identifiedUserId.current = null;
      }
      return;
    }
    if (identifiedUserId.current === user.id) return;
    if (identifiedUserId.current) posthog?.reset();
    posthog?.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName,
    });
    identifiedUserId.current = user.id;
  }, [isLoaded, isSignedIn, isUserLoaded, user]);

  const load = useCallback(() => fetch('/api/me').then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (res.ok) setMe(body); else setProblem(body.error ?? `Could not load your account (${res.status})`);
  }).catch(() => setProblem('Could not reach the server')), []);
  useEffect(() => { if (isSignedIn) load(); }, [isSignedIn, load]);
  // Account facts for analytics; never the key or the balance amount.
  useEffect(() => {
    if (!me) return;
    posthog?.setPersonProperties({
      free_parses_used: me.account.freeParsesUsed, subscribed: me.account.subscribed,
      own_key: me.account.hasOwnKey, has_balance: me.account.balanceMicros > 0,
    });
  }, [me]);

  if (!isLoaded) return <div className="loading" />;
  if (!isSignedIn) return <Welcome signIn={<SignIn routing="hash" appearance={CLERK_LOOK} />} />;
  if (problem) return <div className="gate"><h1>Scratch</h1><p>{problem}</p><UserButton /></div>;
  if (!me) return <div className="loading" />;

  const menu = (
    <span className="account-menu">
      <Meter me={me} />
      <UserButton>
        {openFeedback && (
          <UserButton.MenuItems>
            <UserButton.Action label="Feedback" labelIcon={<Icon name="chat" small />} onClick={openFeedback} />
          </UserButton.MenuItems>
        )}
      </UserButton>
    </span>
  );
  if (onAccountPage()) return <Account me={me} onChange={setMe} menu={menu} />;
  const billing: Billing | undefined = me.billing ? {
    packs: PACKS.map((cents) => ({ cents, credits: creditsFor(cents, me.pricing) })),
    buy: (cents, blurt) => { billingApi.checkout('topup', cents, { slug, blurt }).catch(checkoutFailed); },
    keyHref: '?account',
  } : undefined;
  return <App account={menu} billing={billing} onSpent={load} />;
}

/** A checkout that can't open sends the writer to the account page, where the money controls are. */
function checkoutFailed(e: unknown) {
  console.error(e);
  location.href = '/?account';
}

/** Credits left, always in the top bar; a link to the account page. */
function Meter({ me }: { me: Me }) {
  if (me.unlimited) return null;
  const free = freeLeft(me), credits = creditsLeft(me);
  const text = credits > 0 ? (free === credits ? `${plural(free, 'free credit')}` : plural(credits, 'credit'))
    : me.account.hasOwnKey ? 'Your key' : 'Out of credits';
  const tone = credits > 0 ? (credits <= 5 && !me.account.hasOwnKey ? ' is-low' : '') : me.account.hasOwnKey ? '' : ' is-out';
  return <a className={`meter${tone}`} href="?account" title="Credits and your account">{text}</a>;
}

type Where = 'credits' | 'key' | 'readwise' | 'donate';

export function Account({ me, onChange, menu }: { me: Me; onChange: (m: Me) => void; menu: React.ReactNode }) {
  const [key, setKey] = useState('');
  const [rw, setRw] = useState('');
  const [replacingRw, setReplacingRw] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<{ where: Where; message: string } | null>(null);
  const a = me.account, { pricing } = me;
  const paid = new URLSearchParams(location.search).get('paid');
  const [waiting, setWaiting] = useState(!!paid && paid !== 'donation');

  const cents = amount.trim() ? Math.round(Number(amount) * 100) : NaN;
  const valid = Number.isFinite(cents) && cents >= pricing.minCents && cents <= pricing.maxCents;

  // Back from Stripe: the webhook can land a moment after the redirect, so look again until the credits show.
  useEffect(() => {
    if (!paid || paid === 'donation') return;
    const before = a.balanceMicros;
    let tries = 0;
    const t = setInterval(async () => {
      const res = await fetch('/api/me');
      if (!res.ok) return;
      const next: Me = await res.json();
      if (next.account.balanceMicros > before || ++tries > 15) { onChange(next); setWaiting(false); clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  const fail = (where: Where) => (e: Error) => setError({ where, message: e.message });
  const pay = (what: 'topup' | 'subscription') => billingApi.checkout(what, cents).catch(fail('credits'));

  const save = async (where: 'key' | 'readwise', remove = false) => {
    setError(null);
    const path = where === 'key' ? '/api/me/key' : '/api/me/readwise';
    const body = where === 'key' ? { key } : { token: rw };
    const res = await fetch(path, remove
      ? { method: 'DELETE' }
      : { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const got = await res.json().catch(() => ({}));
    if (!res.ok) return setError({ where, message: got.error ?? 'Could not save' });
    setKey(''); setRw(''); setReplacingRw(false);
    onChange({ ...me, account: got });
  };
  const errorAt = (where: Where) => error?.where === where && <p className="help bad" role="alert">{error.message}</p>;

  return (
    <div className="app">
      <header className="account-bar">
        <a className="btn btn-quiet btn-sm" href="/"><Icon name="back" small />Back to writing</a>
        <span className="spacer" />
        {menu}
      </header>
      <main className="account">
        <div>
          <h1>Your account</h1>
          <span className="email">{a.email}</span>
        </div>

        <section>
          <span className="field-label">Credits</span>
          <span className="credits">{me.unlimited ? 'Unlimited' : plural(creditsLeft(me), 'credit')}</span>
          <p className="say">
            Each run of Spill uses about 1 credit; a long spill can use 2 or 3. Scratch runs at cost: credits are priced at what
            the model charges, plus Stripe's card fee ({pricing.fee.percent}% + {pricing.fee.cents}¢ a payment).
          </p>
          {me.billing && (
            <>
              <div className="row">
                <label className="input-money"><span>$</span>
                  <input className="input" inputMode="decimal" placeholder="10" aria-label="Amount in dollars" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <button className="btn btn-primary" disabled={!valid} onClick={() => pay('topup')}>Add once</button>
                {a.subscribed
                  ? <button className="btn btn-secondary" onClick={() => billingApi.portal().catch(fail('credits'))}>Manage monthly</button>
                  : <button className="btn btn-secondary" disabled={!valid} onClick={() => pay('subscription')}>Add monthly</button>}
              </div>
              {waiting
                ? <p className="help">Payment received. Adding your credits…</p>
                : <p className="help">{valid
                    ? `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)} buys ${plural(creditsFor(cents, pricing), 'credit')}.`
                    : amount.trim() ? `Enter $${pricing.minCents / 100} to $${pricing.maxCents / 100}.` : `$10 buys ${plural(creditsFor(1000, pricing), 'credit')}.`}</p>}
              {paid === 'donation' && <p className="say">Thank you for the paper.</p>}
            </>
          )}
          {errorAt('credits')}
        </section>

        <div className="divider" />

        <section>
          <span className="field-label">Or use your own Anthropic key</span>
          {a.hasOwnKey && (
            <div className="row">
              <span className="status"><Icon name="check" small />Saved, ending {a.keyHint}</span>
              <span className="spacer" />
              <button className="btn btn-quiet btn-sm" onClick={() => save('key', true)}>Remove</button>
            </div>
          )}
          <form className="row" onSubmit={(e) => { e.preventDefault(); save('key'); }}>
            <input className="input" type="password" autoComplete="off" placeholder={a.hasOwnKey ? 'Replace with a new key' : 'sk-ant-…'}
              aria-label="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn btn-secondary" type="submit" disabled={!key.trim()}>Save key</button>
          </form>
          <p className="help">
            When your credits run out, Spill runs on your key and Anthropic bills you. Get one at{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. Stored encrypted, never shown again.
          </p>
          {errorAt('key')}
        </section>

        <div className="divider" />

        <section>
          <span className="field-label">Readwise</span>
          {a.hasReadwise && !replacingRw
            ? (
              <div className="row">
                <span className="status"><Icon name="check" small />Connected</span>
                <span className="spacer" />
                <button className="btn btn-quiet btn-sm" onClick={() => setReplacingRw(true)}>Replace</button>
                <button className="btn btn-quiet btn-sm" onClick={() => save('readwise', true)}>Remove</button>
              </div>
            )
            : (
              <form className="row" onSubmit={(e) => { e.preventDefault(); save('readwise'); }}>
                <input className="input" type="password" autoComplete="off" placeholder="Readwise access token" aria-label="Readwise access token"
                  value={rw} onChange={(e) => setRw(e.target.value)} />
                <button className="btn btn-secondary" type="submit" disabled={!rw.trim()}>Connect</button>
              </form>
            )}
          <p className="help">
            Brings your highlights and notes into your writing. Get a token at{' '}
            <a href="https://readwise.io/access_token" target="_blank" rel="noreferrer">readwise.io/access_token</a>.
          </p>
          {errorAt('readwise')}
        </section>

        {me.billing && (
          <div className="donate">
            <div style={{ flex: 1 }}>
              <p>I don't drink coffee. But if you liked using this, please consider donating me a ream of paper.</p>
              <span className="help">This is not for usage.</span>
              {errorAt('donate')}
            </div>
            <button className="btn btn-secondary" onClick={() => billingApi.checkout('donation').catch(fail('donate'))}>Donate ${pricing.donationCents / 100}</button>
          </div>
        )}
      </main>
    </div>
  );
}
