import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, playMove, solvePuzzle } from './helpers';

const archive = JSON.parse(readFileSync('src/games/fixtures/chesscom-archive.fixture.json', 'utf8'));
const API = 'https://api.chess.com/pub/player/fixture_learner';

// Every request of the page must be answerable by the test (see autosync.spec.ts).
test.use({ serviceWorkers: 'block' });

test('own games: fetched and analysed on the device, ratings and error metrics with their positions, drill a missed move', async ({ page }) => {
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } }, chess_blitz: { last: { rating: 431, date: 1793900000 } }, chess_daily: { last: { rating: 772, date: 1793800000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');

  // Before any game the dashboard says so and shows only the ratings that were typed in.
  await expect(page.getByTestId('card-ratings')).toContainText('No games are on this device yet');
  await expect(page.getByTestId('card-errors')).toHaveCount(0);
  await expect(page.getByTestId('games-count')).toHaveText('0 games on this device, 0 analysed.');
  // There is no file import: games come only from the public API.
  await expect(page.getByTestId('games-input')).toHaveCount(0);

  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  // Ratings are per time control and never blended.
  await expect(page.getByTestId('rating-rapid')).toHaveAttribute('data-current', '455');
  await expect(page.getByTestId('rating-blitz')).toHaveAttribute('data-current', '431');
  await expect(page.getByTestId('rating-daily')).toHaveAttribute('data-current', '772');
  await expect(page.getByTestId('rating-bullet')).toHaveCount(0);

  // Major errors: numerator, denominator, coverage, engine settings, and no causal claim.
  const errors = page.getByTestId('card-errors');
  await expect(errors).toContainText('3 in 27 decisions');
  await expect(errors).toContainText('provisional');
  await expect(errors).toContainText('6 of 6 imported games analysed');
  await expect(errors).toContainText('not an explanation of why they were played');
  await expect(page.getByTestId('errors-blitz')).toContainText('1/5');
  await expect(page.getByTestId('card-missed')).toContainText('2 of 5');
  await expect(page.getByTestId('clock-insufficient')).toContainText('at least 30 are needed in each group');

  // Drill-down reaches the actual position with what is and is not established.
  await page.getByTestId('view-errors').click();
  await expect(page.getByTestId('event-row')).toHaveCount(3);
  await page.getByTestId('event-row').filter({ hasText: 'Qxe5+' }).click();
  const ev = page.getByTestId('game-event');
  await expect(ev).toContainText('Qxf7#');
  await expect(ev).toContainText('loses material in a short line');
  await expect(ev).toContainText('Why the move was played. The app does not guess.');

  // The missed mate has one clearly best move, so it becomes a personal drill.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-own')).toContainText('1 position where one move was clearly best and you played another');
  await page.getByTestId('practice-own').click();
  const drill = page.getByTestId('own-drill');
  await expect(drill).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  await expect(page.getByTestId('own-verdict')).toContainText('nothing is claimed about it');
  await page.getByTestId('own-next').click();
  await expect(page.getByTestId('own-done')).toBeVisible();

  // It is now in the review queue, and it never counts as an unseen puzzle.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-review')).toContainText('1 in the queue');
  await page.goto('./#/progress');
  await expect(page.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();

  // Asking Chess.com again changes nothing.
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('card-games-import')).toHaveAttribute('data-sync', 'ok');
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');
  await expect(errors).toContainText('3 in 27 decisions');
});

test('a question from your own games stays put while new games arrive and are analysed in the background', async ({ page }) => {
  // What the phone does all the time: a game is fetched and analysed while a question is on screen.
  let extraGame = false;
  const later = { ...archive.games[1], url: 'https://www.chess.com/game/live/900000099', end_time: archive.games[1].end_time + 3600 };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: extraGame ? { games: [...archive.games, later] } : archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  const start = new Date(2026, 10, 10, 9, 0, 0);
  await page.clock.install({ time: start });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  await page.goto('./#/practice/run?mode=sense');
  const drill = page.getByTestId('sense-drill');
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  const question = await drill.locator('h2').textContent();
  const fen = await drill.locator('.board').getAttribute('data-fen');

  // Hours later the app comes back online: it fetches by itself, finds a new game and analyses it.
  extraGame = true;
  await page.clock.setSystemTime(new Date(start.getTime() + 4 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const measured = () => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('games').objectStore('games').getAll();
      all.onsuccess = () => { open.result.close(); resolve((all.result as { measure?: unknown }[]).filter((g) => g.measure).length); };
    };
  }));
  await expect.poll(measured, { timeout: 90_000 }).toBe(7);

  // The same question is still on screen, still waiting for an answer.
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  expect(await drill.locator('h2').textContent()).toBe(question);
  expect(await drill.locator('.board').getAttribute('data-fen')).toBe(fen);
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
});

test('one button: "Just practise" mixes own-game questions, missed moves and new positions without saying which is coming', async ({ page }) => {
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  await page.goto('./#/today');
  await page.getByTestId('start-mix').click();
  const mix = page.getByTestId('mix-run');
  const kinds: string[] = [];
  for (let turn = 0; turn < 9; turn++) {
    await expect(mix).toHaveAttribute('data-turn', String(turn));
    const kind = (await mix.getAttribute('data-kind'))!;
    kinds.push(kind);
    // The same plain heading whatever the item is; no concept or exercise type is announced.
    await expect(mix.locator('.kicker').first()).toHaveText(turn === 0 ? 'Practice' : `Practice, ${turn} done`);
    if (kind === 'puzzle') {
      await solvePuzzle(page);
      await page.getByTestId('next').click();
    } else if (kind === 'safe' || kind === 'chance') {
      await page.getByTestId('sense-no').click();
      await expect(page.getByTestId('sense-verdict')).toBeVisible();
      await page.getByTestId('sense-next').click();
    } else if (kind === 'missed') {
      const drill = page.getByTestId('own-drill');
      await playMove(page, (await drill.getAttribute('data-expected'))!);
      await page.getByTestId('own-next').click();
    } else {
      // Something answered wrongly earlier in this run can come back as a review only on a later day.
      throw new Error(`unexpected kind on a first day: ${kind}`);
    }
  }
  expect(new Set(kinds).size).toBeGreaterThanOrEqual(2);
  // Everything was recorded as ordinary practice.
  await page.goto('./#/progress');
  await expect(page.getByTestId('card-unseen')).toBeVisible();
});

