import { expect, type Page, test } from '@playwright/test';
import { legalDests, positionFromFen } from '../src/chess/rules';
import { openApp, playMove } from './helpers';

/** Plays the drill on screen with table-perfect moves until it ends. */
async function playPerfectly(page: Page) {
  const drill = page.getByTestId('kpk-drill');
  for (let i = 0; i < 45; i++) {
    if ((await drill.getAttribute('data-done')) === 'true') return;
    await expect(drill).not.toHaveAttribute('data-keeping', '');
    const goal = await drill.getAttribute('data-goal');
    const move = goal === 'win' ? (await drill.getAttribute('data-fastest'))! : (await drill.getAttribute('data-keeping'))!.split(' ')[0]!;
    const before = await drill.getAttribute('data-fen');
    await playMove(page, move);
    await expect(drill).not.toHaveAttribute('data-fen', before!);
    // wait for the reply (or the end)
    await expect(async () => {
      const done = (await drill.getAttribute('data-done')) === 'true';
      const keeping = await drill.getAttribute('data-keeping');
      expect(done || keeping !== '').toBeTruthy();
    }).toPass();
  }
  throw new Error('play-out did not end');
}

test('king and pawn ending: win against best defence, hold a draw, and a result-changing move is named exactly', async ({ page }) => {
  await openApp(page, '#/practice/run?mode=kpk');
  const drill = page.getByTestId('kpk-drill');

  // 1. Win it: best play queens the pawn; the verdict comes from the table.
  await expect(drill).toHaveAttribute('data-goal', 'win');
  await expect(drill).toContainText('Best play queens in');
  await playPerfectly(page);
  await expect(page.getByTestId('kpk-verdict')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('kpk-verdict')).toContainText('queened safely');
  await page.getByTestId('kpk-next').click();

  // 2. Hold it: ten correct defensive moves (or the pawn falls, or stalemate).
  await expect(drill).toHaveAttribute('data-goal', 'hold');
  await playPerfectly(page);
  await expect(page.getByTestId('kpk-verdict')).toHaveAttribute('data-ok', 'true');
  await page.getByTestId('kpk-next').click();

  // 3. Win it, but play a legal move that is not the one winning move: the table says so at once.
  await expect(drill).toHaveAttribute('data-goal', 'win');
  const fen = (await drill.getAttribute('data-fen'))!;
  const keeping = (await drill.getAttribute('data-keeping'))!.split(' ');
  expect(keeping).toHaveLength(1);
  const pos = positionFromFen(fen);
  const wrong = [...legalDests(pos)].flatMap(([from, tos]) => tos.map((to) => `${from}${to}`)).find((u) => !keeping.includes(u) && !/[18]$/.test(u))!;
  await playMove(page, wrong);
  const verdict = page.getByTestId('kpk-verdict');
  await expect(verdict).toHaveAttribute('data-ok', 'false');
  await expect(verdict).toContainText('theoretical draw');
  await expect(verdict).toContainText('The only move that kept the win was');
  await expect(verdict).toContainText('Exact result from the table, not an opinion');

  // Progress reports the three play-outs with their split, separately from puzzles.
  await page.goto('./#/progress');
  const card = page.getByTestId('card-endgame');
  await expect(card).toContainText('2 of 3');
  await expect(card).toContainText('Winning: 1 of 2. Holding the draw: 1 of 1.');
  await expect(page.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();
  // All three are scheduled for a later retention check.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-review')).toContainText('3 in the queue');
});

test('the opposition is demonstrated by playing five unseen endings correctly, not by tagged puzzles', async ({ page }) => {
  await openApp(page, '#/learn/endgame.opposition');
  await expect(page.getByTestId('concept-evidence')).toHaveText('Untested');
  await page.getByTestId('start-check').click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId('kpk-drill')).toContainText(`${i + 1} of 5`);
    await expect(page.getByRole('button', { name: 'Show a move that keeps it' })).toHaveCount(0);
    await playPerfectly(page);
    await page.getByTestId('kpk-next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await page.getByTestId('check-done').click();
  await expect(page.getByTestId('concept-stage')).toHaveText('Demonstrated by pre-test');
  await expect(page.getByTestId('concept-evidence')).toContainText('5 of 5 endings played out correctly first time');
});
