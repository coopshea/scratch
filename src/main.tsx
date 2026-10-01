import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import './styles.css';
import { App } from './App.tsx';
import { Gate } from './Gate.tsx';
import { Preview } from './Preview.tsx';
import { recordReplay } from './posthog.ts';

// Hosted when a Clerk key is built in; otherwise the local app, no sign-in.
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!clerkKey) recordReplay(false); // the hosted site starts it once it knows who is signed in (Gate)

// Local development only: ?preview=welcome, ?preview=account, ?preview=admin or ?preview=keys shows a hosted page without signing in.
const preview = import.meta.env.DEV && !clerkKey ? new URLSearchParams(location.search).get('preview') : null;

createRoot(document.getElementById('root')!).render(clerkKey
  ? <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/"><Gate /></ClerkProvider>
  : preview ? <Preview page={preview} /> : <App />);
