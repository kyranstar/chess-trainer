import { expect, test, type Page } from '@playwright/test';
import { solvePuzzle } from '../e2e/helpers';
import { clones, mockChessCom, openApp, setUsername, store, waitMeasured } from './lib';

const DAY = 86_400_000;

async function senseIdentity(page: Page) {
  const d = page.getByTestId('sense-drill');
  return { h2: await d.locator('h2').textContent(), sub: await d.locator('.puzzle-head .muted').textContent(), fen: await d.locator('.board').getAttribute('data-fen'), kind: await d.getAttribute('data-kind') };
}

test('a re-check that falls due while the mixed test is on screen replaces the position in progress', async ({ page }) => {
  // Three weeks ago: the learner passes the check for a concept during the morning commute.
  const t0 = new Date(2026, 9, 20, 8, 25, 0);
  await page.clock.install({ time: t0 });
  await openApp(page, '#/learn/safety.hanging-pieces');
  await page.getByTestId('start-check').click();
  for (let i = 0; i < 5; i++) {
    await solvePuzzle(page);
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('check-result')).toHaveAttribute('data-passed', 'true');
  const passed = (await store(page, 'lessonEvents')).find((e) => e.type === 'check-passed');
  console.log('check passed at', new Date(passed.ts).toString());

  // Exactly 21 days later, same commute, two minutes earlier in the session than last time.
  await page.clock.setSystemTime(new Date(passed.ts + 21 * DAY - 120_000));
  await openApp(page, '#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  for (const b of ['learn', 'apply']) {
    await expect(run).toHaveAttribute('data-block', b);
    await page.getByTestId('end-block').click();
  }
  await expect(run).toHaveAttribute('data-block', 'test');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await expect(puzzle).toContainText('Mixed test, no hints');
  const id = await puzzle.getAttribute('data-puzzle-id');
  const fen = await puzzle.locator('.board').getAttribute('data-fen');
  const attemptsBefore = (await store(page, 'attempts')).length;

  // The learner thinks for three minutes. Nothing is touched.
  await page.clock.fastForward(180_000);
  await page.waitForTimeout(1500);

  const after = { heading: await page.locator('.puzzle-head .kicker').textContent(), id: await puzzle.getAttribute('data-puzzle-id'), fen: await puzzle.locator('.board').getAttribute('data-fen') };
  const attempts = await store(page, 'attempts');
  const lost = attempts.find((a) => a.exerciseId === `lichess:${id}`);
  console.log('before:', { id, fen }, 'after:', after, 'attempt for the replaced position:', lost && { outcome: lost.outcome, context: lost.context }, 'attempts', attemptsBefore, '->', attempts.length);
  expect(after.heading, 'the mixed-test position should still be on screen').toBe('Mixed test, no hints');
  expect(after.id).toBe(id);
});

test('a session finished after midnight ends on "No session is running" with no summary', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 10, 23, 57, 0) });
  await openApp(page, '#/today');
  await page.getByTestId('start-play').click();
  await page.getByTestId('game-finished').click();
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'reflect');
  await page.getByTestId('result-win').click();
  await page.getByTestId('turning-point').fill('Move 20: won a rook with a fork');
  await page.clock.runFor(5 * 60_000); // it is now 00:02
  await page.getByTestId('save-reflection').click();
  await expect.poll(async () => (await store(page, 'gameJournal')).length).toBe(1);
  await page.waitForTimeout(1500);
  const main = await page.locator('main').innerText();
  const sessions = await store(page, 'sessions');
  console.log('after saving at 00:02 ->', JSON.stringify(main.slice(0, 200)), '| hash', await page.evaluate(() => location.hash), '| session', sessions.map((s) => `${s.date} ${s.status}`));
  await page.goto('./#/today');
  console.log('Today then shows state:', await page.getByTestId('today').getAttribute('data-state'));
  expect(main, 'the summary of the session just finished should be shown').toContain('Play day finished');
});

test('a game-sense question answered as practice time runs out is not asked again in the test', async ({ page }) => {
  await mockChessCom(page, clones(60));
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 60);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  await page.getByTestId('end-block').click();
  await expect(run).toHaveAttribute('data-block', 'apply');
  const drill = page.getByTestId('sense-drill');
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  const asked = await senseIdentity(page);
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
  await expect.poll(async () => (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'sense').length).toBe(1);

  // The practice block's minutes run out while the verdict is being read; "Continue" then ends the block.
  await page.clock.runFor(17 * 60_000);
  await expect(page.getByTestId('time-up')).toBeVisible();
  await page.getByTestId('sense-next').click();
  await expect(run).toHaveAttribute('data-block', 'test');
  // The test block opens on something new (a puzzle here), not on the question just answered.
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  await expect(page.getByTestId('sense-drill')).toHaveCount(0);
  const sense = (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'sense');
  expect(sense.map((a) => a.outcome)).toHaveLength(1); // answered once, recorded once, nothing logged as left
  void asked;
  void senseIdentity;
});
