import { useState } from 'react';
import { Account, type Me } from './Gate.tsx';
import { Welcome } from './Welcome.tsx';

/** Local development only: the hosted pages with a stand-in sign-in box and a sample account. */
const SAMPLE: Me = {
  hosted: true, unlimited: false, billing: true,
  account: { email: 'writer@example.com', freeParsesUsed: 2, hasOwnKey: false, keyHint: null, balanceMicros: 3_120_000, subscribed: false, hasBilling: true, hasReadwise: true },
  pricing: { freeParses: 2, markup: 1, creditMicros: 80_000, minCents: 100, maxCents: 10_000, fee: { percent: 2.9, cents: 30 }, donationCents: 700 },
};

export function Preview({ page }: { page: string }) {
  const [me, setMe] = useState(SAMPLE);
  if (page === 'account') return <Account me={me} onChange={setMe} menu={<a className="meter" href="#">39 credits</a>} />;
  return <Welcome signIn={<div className="preview-signin">Clerk sign-in appears here</div>} />;
}
