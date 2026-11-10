import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, solvePuzzle } from './helpers';

test('after one online visit the app runs with no network: launch, practise, persist, restart', async ({ page, context }) => {
  await openApp(page);
  // Wait until the service worker is active, which means the app shell is cached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const requests: string[] = [];
  await context.setOffline(true);
  page.on('requestfailed', (r) => requests.push(r.url()));

  // Cold reload with no network.
  await page.reload();
  await expect(page.getByTestId('today')).toBeVisible();
  await expect(page.getByTestId('offline-strip')).toBeVisible();
  await expect(page.getByTestId('pack-error')).toHaveCount(0);

  // The plan is honest offline: the first concept is link-only, so learning is deferred, not faked.
  await expect(page.getByTestId('notice-learn')).toContainText('need a connection');
  await expect(page.getByTestId('block-learn')).toHaveAttribute('data-status', 'skipped');

  // Practice works and is stored.
  await page.goto('/#/practice/run?concept=tactics.double-attack');
  await solvePuzzle(page);
  await page.getByTestId('next').click();
  await failPuzzle(page);

  // The local lesson opens offline; linked lessons say they need a connection.
  await page.goto('/#/learn/tactics.double-attack');
  await expect(page.getByTestId('offline-links')).toBeVisible();
  await page.getByTestId('start-lesson').click();
  await expect(page.getByTestId('lesson')).toContainText('There are two kinds of elementary attack.');

  // Restart while still offline: attempts survived.
  await page.goto('/#/progress');
  await page.reload();
  await expect(page.getByTestId('card-unseen')).toContainText('1 of 2');
  await expect(page.getByTestId('pack-info')).toContainText('practice positions');

  // No request to a third party was attempted during the offline session.
  expect(requests.filter((u) => !u.startsWith('http://localhost:4173'))).toEqual([]);
});

test('no personal data leaves the device: only same-origin GET requests are made', async ({ page }) => {
  const foreign: string[] = [];
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:4173') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url());
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await solvePuzzle(page);
  await page.goto('/#/progress');
  await expect(page.getByTestId('card-unseen')).toContainText('1 of 1');
  await page.getByTestId('tab-learn').click();
  await page.getByTestId('tab-today').click();
  expect(foreign).toEqual([]);
  expect(writes).toEqual([]);
});
