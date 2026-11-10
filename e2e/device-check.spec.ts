import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('device check passes online and again after going offline, and leaves no test data behind', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'desktop-chromium', 'service-worker offline is exercised in Chromium');
  await openApp(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.goto('./#/progress');
  await page.getByTestId('open-device-check').click();
  const check = page.getByTestId('device-check');
  await expect(check).toHaveAttribute('data-state', 'passed', { timeout: 30_000 });
  for (const id of ['secure', 'service-worker', 'offline-cache', 'pack', 'storage', 'rules', 'endgame-table']) {
    await expect(page.getByTestId(`check-${id}`)).toHaveAttribute('data-status', 'pass');
  }
  await expect(page.getByTestId('check-pack')).toContainText('File checksum verified');
  await expect(page.getByTestId('check-history')).toContainText('0 attempts');

  await context.setOffline(true);
  await page.reload();
  await expect(check).toHaveAttribute('data-state', 'passed', { timeout: 30_000 });
  await expect(check).toContainText('You are offline');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('device-check')))).toEqual([]);
});

test('device check runs in an iPhone-size browser tab and says it is not installed', async ({ page }) => {
  await openApp(page, '#/progress/device-check');
  const check = page.getByTestId('device-check');
  await expect(check).not.toHaveAttribute('data-state', 'running', { timeout: 30_000 });
  await expect(page.getByTestId('check-storage')).toHaveAttribute('data-status', 'pass');
  await expect(page.getByTestId('check-rules')).toHaveAttribute('data-status', 'pass');
  await expect(page.getByTestId('check-installed')).toContainText('running in a browser tab');
});
