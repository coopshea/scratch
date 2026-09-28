import 'dotenv/config';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.ts';
import { projectDir } from './store.ts';

const PORT = Number(process.env.PORT ?? 5178);
const app = createApp();

// Hot reload shares the app's own server, so any PORT works.
const server = http.createServer(app);
const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
app.use(vite.middlewares);

projectDir('scratch');
server.listen(PORT, () => console.log(`scratch on http://localhost:${PORT}`));
