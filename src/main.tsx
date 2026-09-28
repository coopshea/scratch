import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import './styles.css';
import { App } from './App.tsx';
import { Gate } from './Gate.tsx';

// Hosted when a Clerk key is built in; otherwise the local app, no sign-in.
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

createRoot(document.getElementById('root')!).render(clerkKey
  ? <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/"><Gate /></ClerkProvider>
  : <App />);
