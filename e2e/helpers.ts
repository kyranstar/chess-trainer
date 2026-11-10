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

/** Solves the puzzle on screen by playing each expected move the app is waiting for. */
export async function solvePuzzle(page: Page) {
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  for (let i = 0; i < 8; i++) {
    const phase = await puzzle.getAttribute('data-phase');
    if (phase !== 'solving') break;
    const expected = await puzzle.getAttribute('data-expected');
    if (!expected) break;
    await playMove(page, expected);
    await expect(async () => {
      const now = await puzzle.getAttribute('data-expected');
      const ph = await puzzle.getAttribute('data-phase');
      expect(ph !== 'solving' || now !== expected).toBeTruthy();
    }).toPass();
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
