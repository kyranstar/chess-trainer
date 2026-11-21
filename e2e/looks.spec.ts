import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/** The look is painted before anything renders (ADR-064): no flash of another look. */
test('the chosen look is on the first paint', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ct.look', 'night');
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { bgAtStart: string }).bgAtStart = getComputedStyle(document.body).backgroundColor;
    });
  });
  await openApp(page, '#/today');
  expect(await page.evaluate(() => (window as unknown as { bgAtStart: string }).bgAtStart)).toBe('rgb(17, 19, 21)');
  await expect(page.locator('html')).toHaveAttribute('data-look', 'night');
});

test('with nothing chosen the app is in Clubroom', async ({ page }) => {
  await openApp(page, '#/today');
  await expect(page.locator('html')).toHaveAttribute('data-look', 'clubroom');
});
