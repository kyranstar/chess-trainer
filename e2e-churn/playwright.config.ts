import { defineConfig, devices } from '@playwright/test';

/**
 * Screens under changing data: every flow is driven while games are fetched and analysed in
 * the background, the clock ticks, a block's time runs out, midnight passes. Written by an
 * independent review on 2026-11-10 after the owner found a question that changed before he
 * could answer; kept as a permanent suite. Slower than the main browser tests (about seven
 * minutes), so it has its own command: `npm run e2e:churn`. Chess.com is always mocked.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results/churn',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/', trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
  webServer: { command: 'npm run preview', cwd: '..', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 14'] } }],
});
