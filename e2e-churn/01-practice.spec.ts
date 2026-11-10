import { expect, test, type Page } from '@playwright/test';
import { failPuzzle, playMove, solvePuzzle } from '../e2e/helpers';
import { churnFor, clones, flipOffOn, hideShow, measured, mockChessCom, openApp, setUsername, store, waitMeasured, watch, watched } from './lib';

const START = new Date(2026, 10, 10, 9, 0, 0);

/** Username set, hundreds of games fetched, analysis running for a couple of minutes. */
async function background(page: Page, n = 400, firstMeasured = 12) {
  const mock = await mockChessCom(page, clones(n));
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, firstMeasured);
  return mock;
}

/** Everything a phone does while a question is on screen. Returns the analysis progress seen. */
async function everything(page: Page, ms = 6000) {
  const c1 = await churnFor(page, ms);
  await page.clock.fastForward(61_000); // the once-a-minute clock
  await hideShow(page); // app switched away and back
  await flipOffOn(page); // tunnel
  await page.clock.fastForward(61_000);
  const c2 = await churnFor(page, 2000);
  return { before: c1.before, after: c2.after, total: c2.total };
}

test('practice / game-sense question holds under continuous analysis, clock ticks, offline and app switches', async ({ page }) => {
  await background(page);
  await page.goto('./#/practice/run?mode=sense');
  const drill = page.getByTestId('sense-drill');
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  await watch(page);
  const c = await everything(page);
  console.log('sense churn', c);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total); // still churning when we looked
  const states = await watched(page);
  expect(states, JSON.stringify(states, null, 1)).toHaveLength(1);
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
  await expect.poll(async () => (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'sense').length).toBe(1);
  // The verdict also has to stay while the learner reads it.
  await watch(page);
  await everything(page, 3000);
  expect(await watched(page)).toHaveLength(1);
  const first = await drill.locator('.muted').first().textContent();
  await page.getByTestId('sense-next').click();
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  expect((await store(page, 'attempts')).filter((a) => a.exerciseKind === 'sense')).toHaveLength(1);
  console.log('first/second', first, await drill.locator('.muted').first().textContent());
});

test('practice / own-game drill holds under churn and records once', async ({ page }) => {
  await background(page, 400, 20);
  await page.goto('./#/practice/run?mode=own');
  const drill = page.getByTestId('own-drill');
  await expect(drill).toHaveAttribute('data-expected', /.+/);
  const heading = await page.locator('.puzzle-head .kicker').textContent();
  await watch(page);
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  const states = await watched(page);
  expect(states, JSON.stringify(states, null, 1)).toHaveLength(1);
  expect(await page.locator('.puzzle-head .kicker').textContent()).toBe(heading);
  await playMove(page, (await drill.getAttribute('data-expected'))!);
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'true');
  await watch(page);
  await everything(page, 3000);
  expect(await watched(page)).toHaveLength(1);
  await expect.poll(async () => (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'own-game').length).toBe(1);
});

test('practice / concept puzzle holds under churn and records once', async ({ page }) => {
  await background(page);
  await page.goto('./#/practice/run?concept=mate.in-one');
  const puzzle = page.getByTestId('puzzle');
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  await watch(page);
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  expect(c.after).toBeLessThan(c.total);
  const states = await watched(page);
  expect(states, JSON.stringify(states, null, 1)).toHaveLength(1);
  await solvePuzzle(page);
  await watch(page);
  await everything(page, 3000);
  expect(await watched(page)).toHaveLength(1);
  const attempts = (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'puzzle');
  expect(attempts).toHaveLength(1);
  expect(attempts[0].outcome).toBe('success');
  // Next one is a different puzzle, and stays too.
  const id = await puzzle.getAttribute('data-puzzle-id');
  await page.getByTestId('next').click();
  await expect(puzzle).toHaveAttribute('data-phase', 'solving');
  expect(await puzzle.getAttribute('data-puzzle-id')).not.toBe(id);
});

test('practice / king-and-pawn play-out holds mid-game under churn', async ({ page }) => {
  await background(page);
  await page.goto('./#/practice/run?mode=kpk');
  const drill = page.getByTestId('kpk-drill');
  await expect(drill).toHaveAttribute('data-keeping', /.+/);
  await playMove(page, (await drill.getAttribute('data-keeping'))!.split(' ')[0]!);
  await expect(drill).toHaveAttribute('data-keeping', /.+/); // opponent has replied
  await watch(page);
  const c = await everything(page);
  expect(c.after).toBeGreaterThan(c.before + 3);
  const states = await watched(page);
  expect(states, JSON.stringify(states, null, 1)).toHaveLength(1);
  await page.getByRole('button', { name: 'Show a move that keeps it' }).click();
  await expect(page.getByTestId('kpk-verdict')).toBeVisible();
  await expect.poll(async () => (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'endgame').length).toBe(1);
});

test('practice / review queue (puzzle, own-game, game-sense items) holds under churn and a sync that adds games', async ({ page }) => {
  const mock = await background(page, 500, 20);
  // Day 1: miss one of each kind so that all three are in the review queue.
  await page.goto('./#/practice/run?concept=mate.in-one');
  await failPuzzle(page);
  await page.getByRole('button', { name: 'Show solution' }).click();
  await page.goto('./#/practice/run?mode=own');
  await expect(page.getByTestId('own-drill')).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  await page.goto('./#/practice/run?mode=sense');
  const sense = page.getByTestId('sense-drill');
  await expect(sense).toHaveAttribute('data-phase', 'ask');
  await page.getByTestId((await sense.getAttribute('data-truth')) === 'true' ? 'sense-no' : 'sense-yes').click();
  await expect(page.getByTestId('sense-verdict')).toHaveAttribute('data-correct', 'false');
  await expect.poll(async () => (await store(page, 'reviewStates')).length).toBe(3);

  // Day 2, analysis still running.
  await page.clock.setSystemTime(new Date(START.getTime() + 26 * 3_600_000));
  await page.goto('./#/practice');
  await page.goto('./#/practice/run?mode=review');
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    const holder = page.locator('[data-testid=puzzle][data-phase=solving],[data-testid=own-drill][data-done=false],[data-testid=sense-drill][data-phase=ask]');
    await expect(holder).toBeVisible();
    const kind = (await holder.getAttribute('data-testid'))!;
    seen.push(kind);
    await expect(page.locator('.puzzle-head .kicker')).toHaveText(`Review, ${3 - i} due`);
    await watch(page);
    // A sync that brings new games while the review item is on screen.
    mock.games = [...mock.games, ...clones(3, 1000 + i * 3)];
    await page.clock.setSystemTime(new Date(START.getTime() + (30 + 4 * i) * 3_600_000));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const before = (await measured(page)).total;
    await expect.poll(async () => (await measured(page)).total).toBe(before + 3);
    const c = await churnFor(page, 4000);
    expect(c.after).toBeGreaterThan(c.before);
    await page.clock.fastForward(61_000);
    await hideShow(page);
    const states = await watched(page);
    expect(states, `${kind}: ${JSON.stringify(states, null, 1)}`).toHaveLength(1);
    if (kind === 'puzzle') { await solvePuzzle(page); await page.getByTestId('next').click(); }
    if (kind === 'own-drill') { await playMove(page, 'h5f7'); await page.getByTestId('own-next').click(); }
    if (kind === 'sense-drill') { await page.getByTestId('sense-no').click(); await expect(page.getByTestId('sense-verdict')).toBeVisible(); await page.getByTestId('sense-next').click(); }
  }
  expect(seen.sort()).toEqual(['own-drill', 'puzzle', 'sense-drill']);
  await expect(page.getByTestId('review-empty')).toContainText('Review queue cleared');
  const attempts = await store(page, 'attempts');
  expect(attempts.filter((a) => a.scheduledReview)).toHaveLength(3);
  expect(attempts).toHaveLength(6);
});
