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
