import { expect, test } from '@playwright/test';

/** Before the app's script has even loaded, the page is already in the chosen look (ADR-064). */
test('the look is painted before the app script loads', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'request interception of the module script is driven in Chromium');
  await page.addInitScript(() => localStorage.setItem('ct.look', 'night'));
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/assets/*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('./#/today', { waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(17, 19, 21)');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-look'))).toBe('night');
  release();
});
