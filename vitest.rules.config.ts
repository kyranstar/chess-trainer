import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/** Rules and account-service tests against the local Firebase emulators (`npm run test:rules`). */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { environment: 'node', include: ['firebase/**/*.test.ts'], fileParallelism: false, testTimeout: 20_000, hookTimeout: 30_000 },
});
