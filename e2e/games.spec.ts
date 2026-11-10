import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, playMove } from './helpers';

const FIXTURE = 'src/games/fixtures/my-games.fixture.json';

test('own games: import the analysed file, see ratings and error metrics with their positions, drill a missed move', async ({ page }, testInfo) => {
  await openApp(page, '#/progress');

  // Before any import the dashboard says so and shows only the ratings that were typed in.
  await expect(page.getByTestId('card-ratings')).toContainText('No games are imported yet');
  await expect(page.getByTestId('card-errors')).toHaveCount(0);

  // A wrong file is rejected and nothing is stored.
  const bad = testInfo.outputPath('bad.json');
  writeFileSync(bad, JSON.stringify({ manifest: { format: 'chess-trainer-backup' }, games: [] }));
  await page.getByTestId('games-input').setInputFiles(bad);
  await expect(page.getByTestId('games-message')).toContainText('not an analysed-games file');
  await expect(page.getByTestId('card-games-import')).toContainText('0 imported');

  await page.getByTestId('games-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('games-message')).toContainText('6 new, 0 re-analysed, 0 unchanged');
  await expect(page.getByTestId('games-message')).toContainText('game-analysis-v2/Stockfish 19/200000');

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
  await page.goto('/#/practice');
  await expect(page.getByTestId('practice-own')).toContainText('1 position where you missed a move');
  await page.getByTestId('practice-own').click();
  const drill = page.getByTestId('own-drill');
  await expect(drill).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  await expect(page.getByTestId('own-verdict')).toContainText('nothing is claimed about it');
  await page.getByTestId('own-next').click();
  await expect(page.getByTestId('own-done')).toBeVisible();

  // It is now in the review queue, and it never counts as an unseen puzzle.
  await page.goto('/#/practice');
  await expect(page.getByTestId('practice-review')).toContainText('1 in the queue');
  await page.goto('/#/progress');
  await expect(page.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();

  // Re-importing the same file changes nothing.
  await page.getByTestId('games-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('games-message')).toContainText('0 new, 0 re-analysed, 6 unchanged');
  await expect(errors).toContainText('3 in 27 decisions');
});
