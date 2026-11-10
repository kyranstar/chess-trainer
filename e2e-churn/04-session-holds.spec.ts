import { expect, test, type Page } from '@playwright/test';
import { playMove, playUntilAccepted, solvePuzzle } from '../e2e/helpers';
import { churnFor, clones, flipOffOn, hideShow, measured, mockChessCom, openApp, setUsername, store, waitMeasured, watch, watched } from './lib';

async function everything(page: Page, ms = 5000) {
  const c1 = await churnFor(page, ms);
  await page.clock.fastForward(61_000);
  await hideShow(page);
  await flipOffOn(page);
  await page.clock.fastForward(61_000);
  const c2 = await churnFor(page, 1500);
  return { before: c1.before, after: c2.after, total: c2.total };
}

async function still(page: Page, what: string) {
  const states = await watched(page);
  expect(states, `${what}: ${JSON.stringify(states, null, 1)}`).toHaveLength(1);
}

test('a whole study session under churn: apply (own-game question, puzzle), test (check, mixed); clocks run out; nothing moves, everything is recorded once', async ({ page, context }) => {
  test.setTimeout(420_000);
  // The evening before: a linked lesson is marked as finished, so its check is due in today's test.
  await page.clock.install({ time: new Date(2026, 10, 9, 20, 0, 0) });
  await mockChessCom(page, clones(900));
  await openApp(page, '#/learn/safety.hanging-pieces');
  const popup = context.waitForEvent('page');
  await page.getByTestId('open-link').first().click();
  await (await popup).close();
  await page.getByTestId('mark-done').click();
  await expect(page.getByTestId('concept-stage')).toHaveText('Marked done by you, not yet checked');

  await page.clock.setSystemTime(new Date(2026, 10, 10, 9, 0, 0));
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 20);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  console.log('learn block concept:', await page.locator('.concept h1').textContent());
  await page.getByTestId('end-block').click();

  // Practice: a question from the learner's own games.
  await expect(run).toHaveAttribute('data-block', 'apply');
  const sense = page.getByTestId('sense-drill');
  await expect(sense).toHaveAttribute('data-phase', 'ask');
  await watch(page);
  let c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await still(page, 'apply sense question');
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
  await watch(page);
  await everything(page, 2000);
  await still(page, 'apply sense verdict');
  await page.getByTestId('sense-next').click();

  // Practice: a puzzle on the concept; the block's minutes run out while it is on screen.
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await page.clock.runFor(20 * 60_000);
  await expect(page.getByTestId('time-up')).toBeVisible();
  await still(page, 'apply puzzle, time up');
  await solvePuzzle(page);
  await page.getByTestId('next').click();

  // Test: the check for yesterday's lesson comes first.
  await expect(run).toHaveAttribute('data-block', 'test');
  await expect(puzzle).toContainText('Check: 5 unseen positions, no hints');
  for (let i = 0; i < 2; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await page.clock.runFor(8 * 60_000); // the test block's minutes run out mid-check
  await expect(page.getByTestId('time-up')).toBeVisible();
  await still(page, 'third check position, time up');
  for (let i = 0; i < 3; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await watch(page);
  await everything(page, 2000);
  await still(page, 'check result');
  await page.getByTestId('check-done').click();

  // Then the mixed test: whatever comes up stays.
  const holder = page.locator('[data-testid=puzzle][data-phase=solving],[data-testid=sense-drill][data-phase=ask]');
  await expect(holder).toBeVisible();
  await watch(page);
  c = await everything(page);
  console.log('mixed churn', c, await holder.getAttribute('data-testid'));
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  await still(page, 'mixed test item');
  if ((await holder.getAttribute('data-testid')) === 'puzzle') { await solvePuzzle(page); await page.getByTestId('next').click(); }
  else { await page.getByTestId('sense-no').click(); await expect(page.getByTestId('sense-verdict')).toBeVisible(); await page.getByTestId('sense-next').click(); }
  await expect(page.getByTestId('summary')).toBeVisible();

  const attempts = await store(page, 'attempts');
  const events = await store(page, 'lessonEvents');
  console.log(attempts.map((a) => `${a.context}/${a.exerciseKind}/${a.outcome}`).join(', '));
  expect(attempts.filter((a) => a.outcome === 'skipped'), 'nothing was swapped out').toHaveLength(0);
  expect(new Set(attempts.map((a) => a.exerciseId)).size).toBe(attempts.length);
  expect(attempts.filter((a) => a.context === 'check')).toHaveLength(5);
  expect(events.filter((e) => e.type === 'check-passed')).toHaveLength(1);
  expect(attempts).toHaveLength(8);
});

test('midnight passes while a session question is on screen', async ({ page }) => {
  await mockChessCom(page, clones(300));
  await page.clock.install({ time: new Date(2026, 10, 10, 23, 56, 30) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 20);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  await page.getByTestId('end-block').click();
  await expect(run).toHaveAttribute('data-block', 'apply');
  await expect(page.getByTestId('sense-drill')).toHaveAttribute('data-phase', 'ask');
  await watch(page);
  await page.clock.runFor(6 * 60_000);
  const c = await churnFor(page, 3000);
  expect(c.after).toBeGreaterThan(c.before);
  expect(new Date(await page.evaluate(() => Date.now())).getDate()).toBe(11);
  await still(page, 'apply sense question across midnight');
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
  await page.getByTestId('sense-next').click();
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  const sessions = await store(page, 'sessions');
  expect(sessions).toHaveLength(1);
  expect((await store(page, 'attempts')).filter((a) => a.sessionId === sessions[0].id && a.exerciseKind === 'sense')).toHaveLength(1);
  // Today still knows the session.
  await page.goto('./#/today');
  await expect(page.getByTestId('resume-session')).toBeVisible();
});

test('play day: the reflection being typed survives churn, clock ticks, midnight, offline and app switches', async ({ page }) => {
  await mockChessCom(page, clones(300));
  await page.clock.install({ time: new Date(2026, 10, 10, 23, 57, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 10);
  await page.goto('./#/today');
  await page.getByTestId('start-play').click();
  await page.getByTestId('game-finished').click();
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'reflect');
  await page.getByTestId('result-loss').click();
  await page.getByTestId('color-black').click();
  await page.getByTestId('turning-point').fill('Move 14: I took the pawn and lost the knight');
  await page.getByTestId('next-time').pressSequentially('Look at what the move');
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await page.clock.runFor(5 * 60_000);
  await page.getByTestId('next-time').pressSequentially(' leaves undefended');
  await expect(page.getByTestId('turning-point')).toHaveValue('Move 14: I took the pawn and lost the knight');
  await expect(page.getByTestId('next-time')).toHaveValue('Look at what the move leaves undefended');
  await expect(page.getByTestId('result-loss')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('color-black')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('save-reflection').click();
  // (What the screen shows after saving past midnight is a separate finding: 02-session-bugs.spec.ts.)
  await expect.poll(async () => (await store(page, 'gameJournal')).length).toBe(1);
  const journal = await store(page, 'gameJournal');
  expect(journal[0].nextTime).toBe('Look at what the move leaves undefended');
});

test('lesson step with a move to find, and the check started from the concept page, hold under churn', async ({ page }) => {
  await mockChessCom(page, clones(500));
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 10);
  await page.goto('./#/learn/tactics.double-attack');
  await page.getByTestId('start-lesson').click();
  const lesson = page.getByTestId('lesson');
  const steps = Number(await lesson.getAttribute('data-steps'));
  const tryBox = page.getByTestId('lesson-try');
  let tried = false;
  for (let s = 1; s <= steps && !tried; s++) {
    await expect(lesson).toHaveAttribute('data-step', String(s));
    if (await tryBox.count()) {
      tried = true;
      // Make one wrong move first, so there is in-progress state (a mistake counted, a message shown).
      await watch(page);
      const c = await everything(page);
      expect(c.after).toBeGreaterThan(c.before + 3);
      await still(page, `lesson step ${s}`);
      const finished = async () => (await tryBox.getAttribute('data-finished')) === 'true';
      for (let i = 0; i < 6; i++) {
        if (await finished()) break;
        await playUntilAccepted(page, tryBox, (await tryBox.getAttribute('data-expected'))!, finished);
      }
      await expect(tryBox).toHaveAttribute('data-finished', 'true');
      await watch(page);
      await everything(page, 2000);
      await still(page, `lesson step ${s} finished`);
      expect((await store(page, 'attempts')).filter((a) => a.exerciseKind === 'lesson-try')).toHaveLength(1);
    }
    await page.getByTestId('lesson-next').click();
  }
  expect(tried).toBe(true);
  const stepNow = await lesson.getAttribute('data-step');
  await everything(page, 2000);
  expect(await lesson.getAttribute('data-step')).toBe(stepNow);

  // The check from the concept page.
  await page.goto('./#/learn/mate.in-one');
  await page.getByTestId('start-check').click();
  const puzzle = page.getByTestId('puzzle');
  for (let i = 0; i < 2; i++) { await solvePuzzle(page); await page.getByTestId('next').click(); }
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  await still(page, 'check position 3');
  for (let i = 0; i < 3; i++) { await solvePuzzle(page); await page.getByTestId('next').click(); }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  await watch(page);
  await everything(page, 2000);
  await still(page, 'check result');
  expect((await store(page, 'lessonEvents')).filter((e) => e.type === 'check-passed')).toHaveLength(1);
  expect((await store(page, 'attempts')).filter((a) => a.context === 'check')).toHaveLength(5);
});

test('baseline, opening gap builder with a pending choice, opening recall, and "practise this again" hold under churn', async ({ page }) => {
  test.setTimeout(300_000);
  await mockChessCom(page, clones(700));
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 10);

  await page.goto('./#/today/baseline');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  let c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await still(page, 'baseline position');
  await solvePuzzle(page);
  expect((await store(page, 'attempts')).filter((a) => a.context === 'diagnostic')).toHaveLength(1);

  await page.goto('./#/practice/openings');
  const builder = page.getByTestId('gap-builder');
  await expect(builder).toHaveAttribute('data-path', '');
  await playMove(page, 'e2e4');
  await expect(page.getByTestId('save-move')).toBeVisible();
  await watch(page);
  c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await still(page, 'gap builder with a pending choice');
  await expect(page.getByTestId('save-move')).toBeVisible();
  await page.getByTestId('save-move').click();
  await expect(page.getByTestId('repertoire-row')).toHaveCount(1);
  await page.getByTestId('start-recall').click();
  const drill = page.getByTestId('opening-drill');
  await expect(drill).toHaveAttribute('data-expected', 'e2e4');
  await watch(page);
  c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  await still(page, 'opening recall');
  await playMove(page, 'e2e4');
  await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-ok', 'true');
  expect((await store(page, 'attempts')).filter((a) => a.exerciseKind === 'opening')).toHaveLength(1);

  await page.goto('./#/progress');
  await page.getByTestId('view-unseen').click();
  await page.getByTestId('attempt-row').first().click();
  await page.getByRole('button', { name: 'Practise this again' }).click();
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  c = await everything(page);
  console.log('again churn', c);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  await still(page, 'practise this again');
  await solvePuzzle(page);
});

test('session learn block: a lesson step with a move to find holds under churn and when the block clock runs out; the endgame check holds mid play-out', async ({ page }) => {
  test.setTimeout(300_000);
  await mockChessCom(page, clones(700));
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 10);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  await page.getByTestId('start-lesson').click();
  const lesson = page.getByTestId('lesson');
  const steps = Number(await lesson.getAttribute('data-steps'));
  const tryBox = page.getByTestId('lesson-try');
  let watchedOne = false;
  for (let s = 1; s <= steps; s++) {
    await expect(lesson).toHaveAttribute('data-step', String(s));
    if (await tryBox.count()) {
      if (!watchedOne) {
        watchedOne = true;
        await watch(page);
        const c = await everything(page);
        expect(c.after).toBeGreaterThan(c.before + 3);
        await page.clock.runFor(10 * 60_000); // the learn block's eight minutes run out
        await expect(page.getByTestId('time-up')).toBeVisible();
        await still(page, `session lesson step ${s}`);
      }
      const finished = async () => (await tryBox.getAttribute('data-finished')) === 'true';
      for (let i = 0; i < 6; i++) {
        if (await finished()) break;
        await playUntilAccepted(page, tryBox, (await tryBox.getAttribute('data-expected'))!, finished);
      }
      await expect(tryBox).toHaveAttribute('data-finished', 'true');
    }
    await page.getByTestId('lesson-next').click();
  }
  expect(watchedOne).toBe(true);
  await expect(page.getByTestId('learn-complete')).toBeVisible();
  const events = await store(page, 'lessonEvents');
  expect(events.filter((e) => e.type === 'local-completed')).toHaveLength(1);
  const tries = (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'lesson-try');
  expect(new Set(tries.map((a) => a.exerciseId)).size).toBe(tries.length);
  await page.getByTestId('learn-continue').click();
  await expect(run).toHaveAttribute('data-block', 'apply');

  // The endgame check (exact play-outs) from the concept page, mid play-out.
  await page.goto('./#/learn/endgame.opposition');
  await page.getByTestId('start-check').click();
  const kpk = page.getByTestId('kpk-drill');
  await expect(kpk).toHaveAttribute('data-keeping', /.+/);
  await playMove(page, (await kpk.getAttribute('data-keeping'))!.split(' ')[0]!);
  await expect(kpk).toHaveAttribute('data-keeping', /.+/);
  const kicker = await page.locator('.puzzle-head .kicker').textContent();
  await watch(page);
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  await still(page, 'endgame check mid play-out');
  expect(await page.locator('.puzzle-head .kicker').textContent()).toBe(kicker);
});
