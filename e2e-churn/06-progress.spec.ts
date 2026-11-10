import { expect, test, type Page } from '@playwright/test';
import { playMove } from '../e2e/helpers';
import { churnFor, clones, measured, mockChessCom, openApp, setUsername, store, waitMeasured, watch, watched } from './lib';

const START = new Date(2026, 10, 10, 9, 0, 0);

test('Progress: what is being read or typed under "Your games" while games are fetched and analysed', async ({ page }) => {
  const mock = await mockChessCom(page, clones(400));
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 5);
  // The learner is reading the status line under "Your games" and has it in view.
  const status = page.getByTestId('sync-status');
  await status.scrollIntoViewIfNeeded();
  const tops: number[] = [];
  const scrolls: number[] = [];
  for (let i = 0; i < 40; i++) {
    tops.push(Math.round((await status.boundingBox())!.y));
    scrolls.push(await page.evaluate(() => Math.round(window.scrollY)));
    await page.waitForTimeout(250);
  }
  const m = await measured(page);
  console.log(`status line top over 10 s of analysis (viewport px): min ${Math.min(...tops)}, max ${Math.max(...tops)}; distinct ${[...new Set(tops)].join(',')}; scrollY distinct ${[...new Set(scrolls)].join(',')}; measured ${m.measured}/${m.total}`);

  // Typing a different name while all this goes on: the field must keep what was typed.
  const field = page.getByTestId('chesscom-username');
  await field.fill('');
  await field.pressSequentially('fixture_lear', { delay: 150 });
  mock.games = [...mock.games, ...clones(2, 5000)];
  await page.clock.setSystemTime(new Date(START.getTime() + 4 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await measured(page)).total).toBe(402);
  await field.pressSequentially('ner_two', { delay: 150 });
  await expect(field).toHaveValue('fixture_learner_two');
  await expect(page.getByTestId('save-username')).toBeVisible();
  expect(Math.max(...tops) - Math.min(...tops), 'the line being read should not move by itself').toBeLessThan(40);
});

test('OBSERVATION: the list of error positions while analysis adds rows', async ({ page }) => {
  // Ten different days, so the list has an order to keep.
  const games = Array.from({ length: 10 }, (_, d) => clones(30, d * 30, `2026.10.${String(10 + d).padStart(2, '0')}`)).flat();
  await mockChessCom(page, games);
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 20);
  await page.goto('./#/progress/game-events?kind=errors&period=all');
  const rows = page.getByTestId('event-row');
  await expect(rows.first()).toBeVisible();
  const key = async (i: number) => (await rows.nth(i).getAttribute('href')) ?? '';
  const samples: string[] = [];
  let moved = 0;
  let prev = [await key(0), await key(1), await key(2)];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500);
    const now = [await key(0), await key(1), await key(2)];
    if (now.join() !== prev.join()) moved++;
    prev = now;
    samples.push(String(await rows.count()));
  }
  const m = await measured(page);
  console.log(`rows over 12 s: ${samples.join(',')}; the first three rows changed ${moved} times; measured ${m.measured}/${m.total}`);
});

test('own-game question: "See it in the game" after answering', async ({ page }) => {
  await mockChessCom(page, clones(40));
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 40);
  await page.goto('./#/practice/run?mode=sense');
  const drill = page.getByTestId('sense-drill');
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    await expect(drill).toHaveAttribute('data-phase', 'ask');
    const truth = await drill.getAttribute('data-truth');
    const kind = await drill.getAttribute('data-kind');
    await page.getByTestId('sense-no').click();
    await expect(page.getByTestId('sense-verdict')).toBeVisible();
    const link = page.getByRole('link', { name: 'See it in the game' });
    if (truth !== 'true') {
      // Nothing was there, so there is no position to show and no link that would lead nowhere.
      await expect(link).toHaveCount(0);
      seen.push(`${kind}/truth=${truth}: no link`);
      await page.getByTestId('sense-next').click();
      continue;
    }
    await link.click();
    await page.waitForTimeout(400);
    const found = (await page.getByTestId('game-event').count()) > 0;
    seen.push(`${kind}/truth=${truth}: ${found ? 'position shown' : JSON.stringify((await page.locator('main').innerText()).slice(0, 60))}`);
    await page.goBack();
    // Going back remounts the run; the answered question is not asked again.
    await expect(drill).toHaveAttribute('data-phase', 'ask');
  }
  console.log(seen.join('\n'));
  expect(seen.filter((s) => s.includes('not found')), seen.join('\n')).toHaveLength(0);
});

test('SYNTHETIC: a review item from an own game whose analysis changes while it is on screen', async ({ page }) => {
  // Simulates what a re-analysis does (new engine setting after an app update, or a deeper
  // analysis arriving): the stored analysis of the game behind the question on screen changes.
  const mock = await mockChessCom(page, clones(40));
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 40);
  await page.goto('./#/practice/run?mode=own');
  await expect(page.getByTestId('own-drill')).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  await expect.poll(async () => (await store(page, 'reviewStates')).length).toBe(1);
  const state = (await store(page, 'reviewStates'))[0];
  await page.clock.setSystemTime(new Date(START.getTime() + 26 * 3_600_000));
  await page.goto('./#/practice');
  await page.getByTestId('practice-review').click();
  await expect(page.getByTestId('own-drill')).toHaveAttribute('data-expected', 'h5f7');
  await watch(page);

  // The game's analysis is replaced by one that no longer singles out one clearly best move there.
  const [, gameId, ply] = String(state.itemId).split(':');
  await page.evaluate(([id, p]) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('games', 'readwrite');
      const os = tx.objectStore('games');
      const get = os.get(id as string);
      get.onsuccess = () => {
        const g = get.result;
        const strip = (a: any) => a && { ...a, events: a.events.map((e: any) => (e.ply === Number(p) ? { ...e, drill: false } : e)) };
        os.put({ ...g, analysis: strip(g.analysis), measure: strip(g.measure) });
      };
      tx.oncomplete = () => { open.result.close(); resolve(); };
    };
  }), [gameId, ply]);
  // Any later change to the games table (here: one new game arrives) makes screens read it again.
  mock.games = [...mock.games, ...clones(1, 7000)];
  await page.clock.setSystemTime(new Date(START.getTime() + 30 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await measured(page)).total).toBe(41);
  await churnFor(page, 2000);
  const states = await watched(page);
  console.log(states.map((s) => s.holder).join('\n -> '));
  expect(states, 'the question on screen should stay until it is answered').toHaveLength(1);
});
