import { defineConfig } from 'vitest/config';

/** The practice audit (tools/audit). Run on demand; never part of `npm test`. */
export default defineConfig({
  test: {
    include: ['tools/audit/run.audit.ts'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 3_600_000,
  },
});
