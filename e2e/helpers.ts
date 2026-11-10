import { expect, type Locator, type Page } from '@playwright/test';

/** Waits until the first-run pack install has finished and the app is usable. */
export async function openApp(page: Page, path = '#/today') {
  await page.goto(`/${path}`);
  await expect(page.getByTestId('app')).toHaveAttribute('data-pack', 'installed', { timeout: 30_000 });
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
}

function squareOffset(size: { width: number; height: number }, square: string, orientation: string) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: ((col + 0.5) * size.width) / 8, y: ((row + 0.5) * size.height) / 8 };
}

/**
 * Plays a move on the real board by tapping the origin and destination squares. Positions
 * are relative to the board element, so Playwright scrolls it into view, waits for the
 * layout to settle and refuses to click through anything covering it.
 */
export async function playMove(scope: Page | Locator, uci: string) {
  const board = scope.locator('.board').first();
  await expect(board).not.toHaveAttribute('data-movable', 'none');
  // Centre the board, then let the page deliver its scroll event before tapping: the board
  // library refreshes its cached position on scroll, as it does for a real finger.
  await board.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const box = (await board.boundingBox())!;
  const orientation = (await board.getAttribute('data-orientation'))!;
  await board.click({ position: squareOffset(box, uci.slice(0, 2), orientation) });
  await board.click({ position: squareOffset(box, uci.slice(2, 4), orientation) });
  if (uci.length === 5) {
    const name = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[uci[4] as 'q']!;
    const page = 'page' in scope ? scope.page() : scope;
    await page.getByRole('button', { name: `Promote to ${name}` }).click();
  }
}

/**
 * Plays `expected` and waits until the app has moved on (the expected-move attribute changes
 * or `done()` is true). If a tap was lost (slow machine, animation in progress) it taps again,
 * but only after re-checking that the app is still waiting for the same move.
 */
export async function playUntilAccepted(page: Page, holder: Locator, expected: string, done: () => Promise<boolean>) {
  let first = true;
  await expect(async () => {
    if (await done()) return;
    if ((await holder.getAttribute('data-expected')) !== expected) return;
    if (first || (await holder.locator('.board').getAttribute('data-movable')) !== 'none') {
      first = false;
      await playMove(page, expected);
    }
    await page.waitForTimeout(250);
    expect((await done()) || (await holder.getAttribute('data-expected')) !== expected).toBeTruthy();
  }).toPass({ timeout: 30_000 });
}

/** Solves the puzzle on screen by playing each expected move the app is waiting for. */
export async function solvePuzzle(page: Page) {
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const done = async () => (await puzzle.getAttribute('data-phase')) !== 'solving';
  for (let i = 0; i < 8; i++) {
    if (await done()) break;
    const expected = await puzzle.getAttribute('data-expected');
    if (!expected) break;
    await playUntilAccepted(page, puzzle, expected, done);
  }
  await expect(puzzle).toHaveAttribute('data-phase', 'solved');
}

/** Plays a legal move that is not the solution (a king step if nothing else is found). */
export async function failPuzzle(page: Page) {
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const wrong = await page.evaluate(() => (window as unknown as { __wrongMove: () => string }).__wrongMove());
  await playMove(page, wrong);
  await expect(page.getByTestId('verdict-wrong')).toBeVisible();
}
