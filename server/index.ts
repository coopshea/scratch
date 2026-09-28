import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createApp, type Hosted } from './app.ts';
import { projectDir } from './store.ts';

const production = process.env.NODE_ENV === 'production';
// Local keys come from .env. Production reads only the host's variables, so a stray .env can never supply personal keys.
if (!production) await import('dotenv/config');
const PORT = Number(process.env.PORT ?? 5178);

/** Hosted when Clerk is configured: sign-in, one folder per writer, accounts in Postgres. Otherwise the local app. */
async function hosting(): Promise<Hosted | undefined> {
  if (!process.env.CLERK_SECRET_KEY) {
    if (production) throw new Error('Refusing to start in production without CLERK_SECRET_KEY: the site would be open to anyone.');
    return undefined;
  }
  const { clerkClient, clerkMiddleware, getAuth } = await import('@clerk/express');
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (production && !publicUrl) console.warn('PUBLIC_URL is not set: sessions are accepted from any origin Clerk issued them to.');
  const { PgAccounts, MemoryAccounts } = await import('./accounts.ts');
  let accounts;
  if (process.env.DATABASE_URL) {
    const pg = new PgAccounts(process.env.DATABASE_URL);
    await pg.migrate();
    accounts = pg;
  } else {
    if (production) throw new Error('DATABASE_URL is required in production');
    console.warn('No DATABASE_URL: accounts are kept in memory and reset on restart.');
    accounts = new MemoryAccounts();
  }
  // Paying in through Stripe needs only the secret key and the webhook's signing secret; amounts are set per checkout.
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
  let billing;
  if (STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET) {
    const { StripeBilling } = await import('./billing.ts');
    billing = new StripeBilling(accounts, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET);
  } else console.warn('Stripe is not configured: writers bring their own key after the free parses.');
  return {
    billing,
    // Only sessions made for this site's own pages (PUBLIC_URL) are accepted.
    session: clerkMiddleware({ publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY, ...(publicUrl ? { authorizedParties: [publicUrl] } : {}) }),
    userId: (req) => getAuth(req).userId,
    email: async (id) => {
      const u = await clerkClient.users.getUser(id);
      // Only a verified address counts: it decides who is an owner (ADMIN_EMAILS).
      const e = u.primaryEmailAddress;
      return e?.verification?.status === 'verified' ? e.emailAddress : null;
    },
    accounts,
  };
}

const hosted = await hosting();
const app = createApp(hosted);
const server = http.createServer(app);

if (production) {
  // The built frontend (npm run build). Unknown paths fall back to the app shell.
  const dist = path.resolve('dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(path.join(dist, 'index.html')) : next()));
} else {
  // Hot reload shares the app's own server, so any PORT works.
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}

if (!hosted) projectDir('scratch');
server.listen(PORT, () => console.log(`scratch on http://localhost:${PORT}${hosted ? ' (hosted: sign-in required)' : ''}`));
