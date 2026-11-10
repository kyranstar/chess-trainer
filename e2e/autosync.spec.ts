import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

const archive = JSON.parse(readFileSync('src/games/fixtures/chesscom-archive.fixture.json', 'utf8'));
const API = 'https://api.chess.com/pub/player/fixture_learner';

// Without a service worker every request of the page can be answered by the test. (WebKit
// does not let a test intercept requests of a page a service worker controls: after the
// reload the real Chess.com would be asked about a made-up player.)
test.use({ serviceWorkers: 'block' });

test('with a username the app fetches ratings and games by itself and analyses them on the device', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const calls: string[] = [];
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('https://api.chess.com/')) foreign.push(u);
  });
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url.replace(API, ''));
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } }, chess_blitz: { last: { rating: 431, date: 1793900000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });

  await openApp(page, '#/progress');
  const card = page.getByTestId('card-games-import');
  await expect(page.getByTestId('games-count')).toHaveText('0 games on this device, 0 analysed.');
  expect(calls).toEqual([]); // nothing is requested until a username exists

  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();

  // Games and ratings arrive without any file; the coach game is left out.
  await expect(card).toHaveAttribute('data-sync', 'ok', { timeout: 30_000 });
  await expect(page.getByTestId('games-count')).toContainText('6 games on this device');
  await expect(page.getByTestId('live-ratings')).toContainText('Rapid 455, Blitz 431');
  await expect(page.getByTestId('rating-rapid')).toHaveAttribute('data-current', '455');

  // The built-in engine analyses them in the background; the dashboard fills in.
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });
  const errors = page.getByTestId('card-errors');
  await expect(errors).toContainText('in 27 decisions');
  await expect(errors).toContainText('6 of 6 imported games analysed');
  await expect(errors).toContainText('Lite WASM'); // labelled with the in-app engine, not the Mac's
  expect(calls).toEqual(['/stats', '/games/archives', '/games/2026/11']);

  // Reopening soon afterwards does not ask Chess.com again, and the username is remembered.
  await page.reload();
  await expect(page.getByTestId('chesscom-username')).toHaveValue('fixture_learner');
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');
  expect(calls).toHaveLength(3);

  // "Check now" forces a pass: stats, list, and only the current month again.
  await page.getByTestId('sync-now').click();
  await expect.poll(() => calls.length).toBe(6);
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');
  expect(foreign).toEqual([]);
});
