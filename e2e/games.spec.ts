import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, playMove } from './helpers';

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
