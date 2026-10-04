import fs from 'node:fs';

/** Remove the run's throwaway data folder (see playwright.config.ts). */
export default function teardown() {
  const dir = process.env.SCRATCH_E2E_DATA;
  if (dir?.includes('scratch-e2e-')) fs.rmSync(dir, { recursive: true, force: true });
}
