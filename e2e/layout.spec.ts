import { expect, type Page, test } from '@playwright/test';
import { failPuzzle, openApp, playMove, solvePuzzle } from './helpers';

/**
 * One layout for every exercise (ADR-051): the board is the first thing under the bar and
 * never moves, what is asked and the verdict share the place under it, and the main button is
 * pinned to the bottom in one spot.
 */

async function boardBox(page: Page) {
  const b = (await page.locator('.puzzle .board').first().boundingBox())!;
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) };
}

async function bottomGap(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  const h = page.viewportSize()!.height;
  return Math.round(h - (b.y + b.height));
}

test('the board stays in one place through every phase of a puzzle and on to the next one; the main button too', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const asked = await boardBox(page);
  // The board uses the width of the screen (or all the height there is on a wide one).
  const view = page.viewportSize()!;
  if (view.width < 500) expect(asked.w).toBeGreaterThanOrEqual(view.width - 34);
  // Nothing to scroll while the position is being looked at.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);

  // A wrong move: the verdict takes the place of the question, the board does not move,
  // and what the move leads to plays on the board by itself.
  await failPuzzle(page);
  expect(await boardBox(page)).toEqual(asked);
  await expect(page.getByTestId('engine-reply')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('line-steps')).toHaveAttribute('data-playing', 'false');
  expect(Number(await page.getByTestId('line-steps').getAttribute('data-step'))).toBeGreaterThanOrEqual(2);
  expect(await boardBox(page)).toEqual(asked);
  const tryGap = await bottomGap(page, 'try-again');

  // The solution, shown: still the same board, and "Next" sits where "Try again" was.
  await page.getByRole('button', { name: 'Show solution' }).click();
  await expect(page.getByTestId('verdict-revealed')).toBeVisible();
  expect(await boardBox(page)).toEqual(asked);
  expect(await bottomGap(page, 'next')).toBe(tryGap);

  // The next position appears where the last one was, and solving it changes nothing either.
  await page.getByTestId('next').click();
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  expect(await boardBox(page)).toEqual(asked);
  await solvePuzzle(page);
  expect(await boardBox(page)).toEqual(asked);
  expect(await bottomGap(page, 'next')).toBe(tryGap);
});

test('the flip control is in the bar and turns the board on screen; the pawn ending uses the same layout', async ({ page }) => {
  await openApp(page, '#/practice/run?mode=kpk');
  const drill = page.getByTestId('kpk-drill');
  await expect(drill).toHaveAttribute('data-keeping', /.+/);
  const asked = await boardBox(page);
  const board = drill.locator('.board');
  const way = await board.getAttribute('data-orientation');
  await page.getByTestId('flip-board').click();
  await expect(board).not.toHaveAttribute('data-orientation', way!);
  await page.getByTestId('flip-board').click();
  await expect(board).toHaveAttribute('data-orientation', way!);
  // No second flip control under the board on a run page.
  await expect(drill.getByRole('button', { name: 'Flip board' })).toBeHidden();

  // A move that keeps the result, then the reply: the board has not moved.
  await playMove(page, (await drill.getAttribute('data-keeping'))!.split(' ')[0]!);
  await expect(drill).toHaveAttribute('data-keeping', /.+/);
  expect(await boardBox(page)).toEqual(asked);
});

test('a solved position can be stepped back through, and the one before can be gone back to exactly as it was left (ADR-052)', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const asked = await boardBox(page);
  const first = (await puzzle.getAttribute('data-puzzle-id'))!;
  const board = puzzle.locator('.board');
  const start = await board.getAttribute('data-fen');
  // Nothing to go back to on the first position.
  await expect(page.getByTestId('last-item')).toHaveCount(0);
  await solvePuzzle(page);
  // The moves just played are under the verdict: one step back is the position before the last move.
  const steps = page.getByTestId('line-steps');
  await expect(steps).toHaveAttribute('data-step', (await steps.getAttribute('data-length'))!);
  const solved = await board.getAttribute('data-fen');
  await page.getByTestId('line-prev').click();
  await expect(board).toHaveAttribute('data-fen', start!);
  expect(await boardBox(page)).toEqual(asked);
  await page.getByTestId('line-next').click();
  await expect(board).toHaveAttribute('data-fen', solved!);

  // On to the next position, then back to the last one from the bar.
  await page.getByTestId('next').click();
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const second = (await puzzle.getAttribute('data-puzzle-id'))!;
  expect(second).not.toBe(first);
  expect(await boardBox(page)).toEqual(asked); // the control in the bar does not push the board down
  await page.getByTestId('last-item').click();
  // Exactly as it was left: the same position, solved, on its last move; and only one exercise is on the page.
  await expect(page.getByTestId('puzzle')).toHaveCount(1);
  await expect(puzzle).toHaveAttribute('data-puzzle-id', first);
  await expect(puzzle).toHaveAttribute('data-phase', 'solved');
  await expect(board).toHaveAttribute('data-fen', solved!);
  expect(await boardBox(page)).toEqual(asked);
  await page.getByTestId('line-prev').click();
  await expect(board).toHaveAttribute('data-fen', start!);
  // Its main button does not move the run on a second time: it returns to where he was.
  await expect(page.getByTestId('next')).toHaveText('Back to where you were');
  await page.getByTestId('next').click();
  await expect(puzzle).toHaveAttribute('data-puzzle-id', second);
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  expect(await boardBox(page)).toEqual(asked);
  // The position gone back to can be reached again, and the one on screen was not answered meanwhile.
  await page.getByTestId('last-item').click();
  await expect(puzzle).toHaveAttribute('data-puzzle-id', first);
  await page.getByTestId('last-item').click();
  await expect(puzzle).toHaveAttribute('data-puzzle-id', second);
  await solvePuzzle(page);
  await page.getByTestId('next').click();
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  // "Last" is now the second position.
  await page.getByTestId('last-item').click();
  await expect(puzzle).toHaveAttribute('data-puzzle-id', second);
});
