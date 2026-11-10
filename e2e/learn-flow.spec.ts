import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, playMove, playUntilAccepted, solvePuzzle } from './helpers';

test('daily session: linked lesson -> apply -> mixed test (no check on the lesson day) -> summary -> progress, surviving a restart', async ({ page, context }) => {
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

  // Test: no check on the day of the lesson. The mixed test starts at once; miss one on
  // purpose: it must be recorded as a miss and queued for review.
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'test');
  await expect(page.getByTestId('puzzle')).toContainText('Mixed test, no hints');
  await failPuzzle(page);
  // The wrong move can be followed up: the built-in engine's reply is shown as evidence.
  await page.getByTestId('show-reply').click();
  await expect(page.getByTestId('engine-reply')).toContainText('the built-in engine continues', { timeout: 30_000 });

  // Ending the day asks once.
  await page.getByTestId('end-block').click();
  await page.getByTestId('end-confirm-no').click();
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'test');
  await page.getByTestId('end-block').click();
  await page.getByTestId('end-confirm-yes').click();

  // Summary derives from the recorded attempts; the concept is studied, not yet demonstrated.
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('summary-unseen')).toHaveText('1 of 2 solved first try');
  await expect(page.getByTestId('summary')).toContainText('its check comes on a later day');

  // The learner may still take the check at any time from the concept's own page
  // (5 unseen, no hints, not skippable, and it does not name its theme while running).
  await page.goto('./#/learn/safety.hanging-pieces');
  await page.getByTestId('start-check').click();
  await expect(page.getByTestId('puzzle')).toContainText('Check: 5 unseen positions, no hints');
  await expect(page.getByTestId('skip')).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await page.getByTestId('check-done').click();
  await page.getByTestId('tab-progress').click();
  await expect(page.getByTestId('card-unseen')).toContainText('6 of 7');
  await expect(page.getByTestId('card-unseen')).toContainText('provisional');
  await expect(page.getByTestId('card-coverage')).toContainText('1 of 29');
  // 1 apply + 5 check positions carry the hanging-piece tag; the mixed-test position may carry it too.
  expect(Number(await page.getByTestId('row-safety.hanging-pieces').getAttribute('data-n'))).toBeGreaterThanOrEqual(6);
  // Concepts with no observations say "untested", never 0%.
  expect(await page.locator('[data-testid^="row-"][data-n="0"]').count()).toBeGreaterThanOrEqual(5);
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
  await page.goto('./#/progress');
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

test('a tap lands on the right square after something appears above the board without a scroll', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  const board = page.locator('.board').first();
  await expect(board).not.toHaveAttribute('data-movable', 'none');
  const expected = (await puzzle.getAttribute('data-expected'))!;
  // Touch the board once so the board library has measured where it is ...
  await board.click({ position: { x: 2, y: 2 } });
  // ... then push it down the way a notice appearing above it does: no scroll, no resize.
  await page.evaluate(() => {
    const note = document.createElement('p');
    note.textContent = 'This block’s minutes are used.';
    note.style.cssText = 'height:73px;margin:0';
    const main = document.querySelector('main')!;
    main.insertBefore(note, main.firstChild);
  });
  const box = (await board.boundingBox())!;
  const orientation = (await board.getAttribute('data-orientation'))!;
  const at = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const col = orientation === 'white' ? file : 7 - file;
    const row = orientation === 'white' ? 7 - rank : rank;
    return { x: box.x + ((col + 0.5) * box.width) / 8, y: box.y + ((row + 0.5) * box.height) / 8 };
  };
  // Raw taps at the squares' real screen positions (the usual helper scrolls first, which would hide the fault).
  for (const sq of [expected.slice(0, 2), expected.slice(2, 4)]) {
    const p = at(sq);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByTestId('verdict-wrong')).toHaveCount(0);
  await expect(puzzle).toHaveAttribute('data-phase', 'solved');
  await expect(puzzle).toHaveAttribute('data-outcome', 'success');
});

test('the check for a studied concept comes in a later day’s session, unannounced, and passing it demonstrates the concept', async ({ page, context }) => {
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/learn/safety.hanging-pieces');
  const popup = context.waitForEvent('page');
  await page.getByTestId('open-link').first().click();
  await (await popup).close();
  await page.getByTestId('mark-done').click();
  await expect(page.getByTestId('concept-stage')).toHaveText('Marked done by you, not yet checked');

  // Next morning: the session's test block opens with the check.
  await page.clock.setSystemTime(new Date(2026, 10, 11, 9, 0, 0));
  await page.goto('./#/today');
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('start-session').click();
  for (const blockName of ['learn', 'apply']) {
    await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', blockName);
    await page.getByTestId('end-block').click();
  }
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'test');
  await expect(page.getByTestId('puzzle')).toContainText('Check: 5 unseen positions, no hints');
  await expect(page.getByTestId('puzzle')).not.toContainText('Hanging pieces');
  for (let i = 0; i < 5; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await expect(page.getByTestId('check-result')).toContainText('Hanging pieces');
  await page.getByTestId('check-done').click();
  await page.goto('./#/learn');
  await expect(page.getByTestId('concept-safety.hanging-pieces')).toHaveAttribute('data-stage', 'demonstrated');
});

test('a lesson example does not fault a sound move that is not the text’s: no miss is recorded and the text’s move is still asked', async ({ page }) => {
  await openApp(page, '#/learn/mate.in-two');
  await page.getByTestId('start-lesson').click();
  const example = page.getByTestId('lesson-try');
  // Walk to the first asked move that has a recorded sound alternative, playing the text's moves until then.
  const evidence = JSON.parse(readFileSync('content/verification/lessons.json', 'utf8')) as { lessons: { lesson: string; tries: { fen: string; move: string; alternatives: { uci: string; san: string }[] }[] }[] };
  const tries = evidence.lessons.find((l) => l.lesson === 'lasker-mate-in-two')!.tries;
  const target = tries.find((t) => t.alternatives.length > 0)!;
  const board = (fen: string) => fen.split(' ').slice(0, 2).join(' ');
  for (let guard = 0; guard < 30; guard++) {
    if (await example.count()) {
      const fen = (await example.locator('.board').getAttribute('data-fen'))!;
      if ((await example.getAttribute('data-finished')) === 'false' && board(fen) === board(target.fen)) break;
      if ((await example.getAttribute('data-finished')) === 'false') {
        const expected = (await example.getAttribute('data-expected'))!;
        await playUntilAccepted(page, example, expected, async () => (await example.getAttribute('data-finished')) === 'true');
        continue;
      }
    }
    // Move on one step and wait until the next step is really on screen before looking again.
    const part = await page.getByText(/^Lesson, part \d+ of \d+$/).textContent();
    await page.getByTestId('lesson-next').click();
    await expect(page.getByText(/^Lesson, part \d+ of \d+$/)).not.toHaveText(part!);
  }
  const alt = target.alternatives[0]!;
  await playMove(page, alt.uci);
  const other = page.getByTestId('lesson-other');
  await expect(other).toContainText(`does not fault ${alt.san}`);
  await expect(other).toContainText('Nothing is recorded as missed');
  await expect(example.locator('.verdict.wrong')).toHaveCount(0);
  // A move that throws the position away is still told apart (checked by the engine on the device).
  await playMove(page, 'h6f8');
  await expect(example.locator('.verdict.wrong')).toContainText('is not the move the text plays', { timeout: 30_000 });
  await expect(other).toHaveCount(0);
  // The example is not over: the text's move is still wanted, and playing it finishes the step.
  await expect(example).toHaveAttribute('data-finished', 'false');
  await expect(example).toHaveAttribute('data-expected', target.move);
  await playUntilAccepted(page, example, target.move, async () => (await example.getAttribute('data-expected')) !== target.move);
  await expect(other).toHaveCount(0);
});

test('a check interrupted by a reload goes on with the answers already given', async ({ page }) => {
  await openApp(page, '#/learn/mate.in-one');
  await page.getByTestId('start-check').click();
  // Two positions missed before the interruption.
  for (let i = 0; i < 2; i++) {
    await failPuzzle(page);
    await page.getByRole('button', { name: 'Show solution' }).click();
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  await page.reload(); // what iOS does to an app that sat in the background
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('start-check').click();
  await expect(page.getByTestId('puzzle')).toContainText('2 already answered');
  for (let i = 0; i < 3; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  // Three more, not five fresh ones: the two misses still count.
  const result = page.getByTestId('check-result');
  await expect(result).toHaveAttribute('data-passed', 'false');
  await expect(result).toContainText('3 of 5 solved first try');
});

test('a double tap on "Next position" does not act on the position that follows', async ({ page }) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await solvePuzzle(page);
  const puzzle = page.getByTestId('puzzle');
  const first = await puzzle.getAttribute('data-puzzle-id');
  const next = page.getByTestId('next');
  await expect(next).toBeEnabled();
  const box = (await next.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Two taps on the same spot, 150 ms apart, then a third for good measure.
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await expect(puzzle).not.toHaveAttribute('data-puzzle-id', first!);
  const second = await puzzle.getAttribute('data-puzzle-id');
  await page.waitForTimeout(900);
  // Still the second position, untouched: no hint taken, nothing skipped or revealed.
  await expect(puzzle).toHaveAttribute('data-puzzle-id', second!);
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await expect(puzzle).toHaveAttribute('data-outcome', '');
});

