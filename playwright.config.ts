import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests run against the production build served by `vite preview` (service worker included). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] }, testIgnore: /offline/ },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
