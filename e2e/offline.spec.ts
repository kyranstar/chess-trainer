import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, solvePuzzle } from './helpers';

test('after one online visit the app runs with no network: launch, practise, persist, restart', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await openApp(page);
  // Wait until the service worker is active, which means the app shell is cached.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The app says so itself, so the learner knows when it is safe to go underground.
  await expect(page.getByTestId('offline-ready')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('offline-ready')).toContainText('work with no connection');

  const requests: string[] = [];
  await context.setOffline(true);
  page.on('requestfailed', (r) => requests.push(r.url()));

  // Cold reload with no network.
  await page.reload();
  await expect(page.getByTestId('today')).toBeVisible();
  await expect(page.getByTestId('offline-strip')).toBeVisible();
  await expect(page.getByTestId('pack-error')).toHaveCount(0);

  // The first concept of the curriculum has a lesson stored on the device, so nothing has to
  // be put off for lack of a connection.
  await expect(page.getByTestId('block-learn')).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('block-learn')).toContainText('Hanging pieces');
  await expect(page.getByTestId('notice-learn')).toHaveCount(0);

  // Practice works and is stored.
  await page.goto('./#/practice/run?concept=tactics.double-attack');
  await solvePuzzle(page);
  await page.getByTestId('next').click();
  await failPuzzle(page);

  // The local lesson opens offline; linked lessons say they need a connection.
  await page.goto('./#/learn/tactics.double-attack');
  await expect(page.getByTestId('offline-links')).toBeVisible();
  await page.getByTestId('start-lesson').click();
  await expect(page.getByTestId('lesson')).toContainText('There are two kinds of elementary attack.');

  // Restart while still offline: attempts survived.
  await page.goto('./#/progress');
  await page.reload();
  await expect(page.getByTestId('card-unseen')).toContainText('1 of 2');
  await expect(page.getByTestId('pack-info')).toContainText('practice positions');

  // No request to a third party was attempted during the offline session.
  expect(requests.filter((u) => !u.startsWith(origin))).toEqual([]);
});

test('no personal data leaves the device: only same-origin GET requests are made', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url());
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await solvePuzzle(page);
  await page.goto('./#/progress');
  await expect(page.getByTestId('card-unseen')).toContainText('1 of 1');
  await page.getByTestId('tab-learn').click();
  await page.getByTestId('tab-today').click();
  expect(foreign).toEqual([]);
  expect(writes).toEqual([]);
});

test('on the subway: games fetched earlier, the engine, own-game questions and a whole session work with no network', async ({ page, context }) => {
  const archive = JSON.parse(readFileSync('src/games/fixtures/chesscom-archive.fixture.json', 'utf8'));
  const API = 'https://api.chess.com/pub/player/fixture_learner';
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  // At home, online: games arrive and are analysed.
  await openApp(page, '#/progress');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  // Underground: no network (the test's stand-in for Chess.com is gone too), app started cold.
  await page.unroute('https://api.chess.com/**');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-strip')).toBeVisible();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');
  await expect(page.getByTestId('headline-rating')).toContainText('455');
  // Asking for a refresh says plainly that it could not be done, and nothing is lost.
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-status')).toContainText('offline');
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');

  // A whole session: a lesson stored on the device, then practice that starts from the learner's own games.
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'learn');
  // Starting the session opens the lesson itself, not a page of ways to study.
  await expect(page.getByTestId('lesson')).toBeVisible();
  await page.getByTestId('end-block').click();
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'apply');
  const sense = page.getByTestId('sense-drill');
  await expect(sense).toContainText('Practice: from your own games');
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible(); // the answer is followed by the engine's stored line
  await page.getByTestId('sense-next').click();

  // Then a puzzle on a concept; the built-in engine answers a wrong move without any network.
  await expect(page.getByTestId('puzzle')).toContainText('Practice:');
  await failPuzzle(page);
  await page.getByTestId('show-reply').click();
  await expect(page.getByTestId('engine-reply')).toContainText(/^After \S+: \S+/, { timeout: 30_000 });
});

