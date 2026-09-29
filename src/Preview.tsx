import { useState } from 'react';
import { Account, Meter, type Me } from './Gate.tsx';
import { Welcome } from './Welcome.tsx';

/** Local development only: the hosted pages with a stand-in sign-in box and a sample account. */
const SAMPLE: Me = {
  hosted: true, unlimited: false, billing: true,
  account: { email: 'writer@example.com', freeParsesUsed: 2, hasOwnKey: false, keyHint: null, balanceMicros: 3_120_000, subscribed: false, hasBilling: true, hasReadwise: true },
  pricing: { freeParses: 2, markup: 1, creditMicros: 80_000, minCents: 100, maxCents: 10_000, fee: { percent: 2.9, cents: 30 }, donationCents: 700 },
};

export function Preview({ page }: { page: string }) {
  // ?preview=admin: the same account as an admin, exempt from credits.
  const [me, setMe] = useState<Me>(page === 'admin' ? { ...SAMPLE, unlimited: true } : SAMPLE);
  if (page === 'account' || page === 'admin') return <Account me={me} onChange={setMe} menu={<Meter me={me} />} />;
  return <Welcome signIn={<div className="preview-signin">Clerk sign-in appears here</div>} />;
}
