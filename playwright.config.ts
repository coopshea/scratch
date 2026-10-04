import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the real app in Chromium, on its own port, with the offline parser and a throwaway data folder.
 * No API calls, no sign-in, and never the writer's own projects/.
 */
const PORT = 5193; // not 5178–5180, which are Cooper's own servers

// One temporary folder per run. Set once here; the test workers inherit it, so they all see the same one.
process.env.SCRATCH_E2E_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  globalTeardown: './e2e/teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npx tsx server/index.ts',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      PARSER: 'offline',
      SCRATCH_DATA: process.env.SCRATCH_E2E_DATA,
      // Empty values win over a local .env (dotenv and Vite never override what is already set): the local app,
      // no sign-in, no keys, no analytics.
      CLERK_SECRET_KEY: '',
      VITE_CLERK_PUBLISHABLE_KEY: '',
      ANTHROPIC_API_KEY: '',
      READWISE_TOKEN: '',
      VITE_POSTHOG_KEY: '',
      VITE_POSTHOG_HOST: '',
      DATABASE_URL: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    },
  },
});
