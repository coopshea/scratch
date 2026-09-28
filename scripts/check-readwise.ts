/** Setup check: `npm run check:readwise`. Confirms the token works and Readwise search is reachable. */
import 'dotenv/config';
import { check, search } from '../server/readwise.ts';

const r = await check();
console.log(`token   ${r.token ? 'ok' : 'FAILED'}`);
console.log(`search  ${r.search ? 'ok' : 'FAILED'}`);
if (r.error) console.log(`\n${r.error}`);
if (r.search) {
  const hits = await search('what I have been reading lately', 3);
  console.log(`\nsample: ${hits.map((h) => h.title).filter(Boolean).join(' · ') || '(library is empty)'}`);
}
process.exit(r.token && r.search ? 0 : 1);
