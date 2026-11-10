import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, playUntilAccepted, solvePuzzle } from './helpers';

test('daily session: linked lesson -> apply -> check -> mixed test -> summary -> progress, surviving a restart', async ({ page, context }) => {
  await openApp(page);
  await expect(page.getByTestId('today')).toHaveAttribute('data-state', 'unplanned');

  // The plan is honest before anything is recorded.
  await expect(page.getByTestId('block-review')).toHaveAttribute('data-status', 'skipped');
  await expect(page.getByTestId('block-learn')).toContainText('Hanging pieces');
  await page.getByTestId('start-session').click();

  // Learn: a linked course. Opening the link is not completion.
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'learn');
  await expect(page.getByTestId('concept-stage')).toHaveText('Not started');
  await expect(page.getByTestId('return-card')).toHaveCount(0);
  const popup = context.waitForEvent('page');
  await page.getByTestId('open-link').first().click();
  await (await popup).close();
  await expect(page.getByTestId('concept-stage')).toHaveText('Started');
  await page.getByTestId('mark-done').click();
  await expect(page.getByTestId('concept-stage')).toHaveText('Marked done by you, not yet checked');
  await page.getByTestId('learn-continue').click();

  // Apply: new positions on the concept, solved on the real board.
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'apply');
  await solvePuzzle(page);
  await expect(page.getByTestId('verdict-solved')).toContainText('Solved first try');
  await page.getByTestId('end-block').click();

  // Test: the independent check for the concept just studied (5 unseen, no hints).
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'test');
  for (let i = 0; i < 5; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await page.getByTestId('check-done').click();

  // Mixed test: miss one on purpose; it must be recorded as a miss and queued for review.
  await failPuzzle(page);
  await page.getByTestId('end-block').click();

  // Summary and dashboard derive from the recorded attempts.
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('summary-unseen')).toHaveText('6 of 7 solved first try');
  await page.getByTestId('tab-progress').click();
  await expect(page.getByTestId('card-unseen')).toContainText('6 of 7');
  await expect(page.getByTestId('card-unseen')).toContainText('provisional');
  await expect(page.getByTestId('card-coverage')).toContainText('1 of 29');
  // 1 apply + 5 check positions carry the hanging-piece tag; the mixed-test position may carry it too.
  expect(Number(await page.getByTestId('row-safety.hanging-pieces').getAttribute('data-n'))).toBeGreaterThanOrEqual(6);
  // Concepts with no observations say "untested", never 0%.
  expect(await page.locator('[data-testid^="row-"][data-n="0"]').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('[data-testid^="row-"][data-n="0"]').first()).toContainText('untested');

  // Drill-down shows exactly the attempts behind the number, and each opens its position.
  await page.getByTestId('view-unseen').click();
  await expect(page.getByTestId('attempt-row')).toHaveCount(7);
  await page.locator('[data-testid=attempt-row][data-outcome=fail]').click();
  await expect(page.getByTestId('position-view')).toContainText('missed, first time seen');

  // Restart: everything is still there.
  await page.reload();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await page.getByTestId('tab-learn').click();
  await expect(page.getByTestId('concept-safety.hanging-pieces')).toHaveAttribute('data-stage', 'demonstrated');
  await page.getByTestId('tab-practice').click();
  await expect(page.getByTestId('practice-review')).toContainText('1 in the queue');
});

test('local lesson: read the public-domain text, play its moves, and it is recorded as studied', async ({ page }) => {
  await openApp(page, '#/learn/tactics.double-attack');
  await expect(page.getByTestId('concept-stage')).toHaveText('Not started');
  await page.getByTestId('start-lesson').click();
  const lesson = page.getByTestId('lesson');
  await expect(lesson).toContainText('Edward Lasker');
  await expect(lesson).toContainText('There are two kinds of elementary attack.');

  const steps = Number(await lesson.getAttribute('data-steps'));
  for (let s = 1; s <= steps; s++) {
    await expect(lesson).toHaveAttribute('data-step', String(s));
    const tryBox = page.getByTestId('lesson-try');
    if (await tryBox.count()) {
      const finished = async () => (await tryBox.getAttribute('data-finished')) === 'true';
      for (let i = 0; i < 6; i++) {
        if (await finished()) break;
        const expected = (await tryBox.getAttribute('data-expected'))!;
        await playUntilAccepted(page, tryBox, expected, finished);
      }
      await expect(tryBox).toHaveAttribute('data-finished', 'true');
    }
    await page.getByTestId('lesson-next').click();
  }
  await expect(page.getByTestId('concept-stage')).toHaveText('Studied, not yet checked');
  await expect(page.getByTestId('start-check')).toHaveText('Check understanding');

  // A lesson can be left and resumed part-way.
  await page.getByTestId('start-lesson').click();
  await page.getByTestId('lesson-next').click();
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-step', '2');
  await page.reload();
  await page.getByTestId('start-lesson').click();
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-step', '2');
});

test('a hint makes the attempt assisted and keeps it out of first-try successes', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  await page.getByRole('button', { name: 'Show which piece' }).click();
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-outcome', 'assisted');
  await solvePuzzle(page);
  await expect(page.getByTestId('verdict-solved')).toContainText('assisted');
  await page.goto('/#/progress');
  await expect(page.getByTestId('card-unseen')).toContainText('0 of 1');
});

test('fits an iPhone-size screen: board fully visible and tabs reachable', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=tactics.double-attack');
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  const viewport = page.viewportSize()!;
  const board = (await page.locator('.board').boundingBox())!;
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(board.y + board.height).toBeLessThanOrEqual(viewport.height);
  expect(board.width).toBeGreaterThanOrEqual(Math.min(viewport.width, 320) - 40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Tabs are hidden while a position is on screen and return on every home screen.
  await expect(page.getByTestId('tab-today')).toBeHidden();
  await page.getByRole('link', { name: 'Practice' }).click();
  await expect(page.getByTestId('tab-today')).toBeVisible();
  for (const t of ['today', 'learn', 'practice', 'progress']) {
    const box = (await page.getByTestId(`tab-${t}`).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
