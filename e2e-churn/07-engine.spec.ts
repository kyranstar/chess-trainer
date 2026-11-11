import { expect, test } from '@playwright/test';
import { failPuzzle, playMove } from '../e2e/helpers';
import { clones, measured, mockChessCom, openApp, setUsername, store, waitMeasured } from './lib';

test('the engine check of the learner\'s own move still answers while background analysis is running', async ({ page }) => {
  await mockChessCom(page, clones(600));
  await page.clock.install({ time: new Date(2026, 10, 10, 9, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 20);

  // A wrong puzzle move: the engine's answer to it is asked for at once.
  await page.goto('./#/practice/run?concept=mate.in-one');
  await failPuzzle(page);
  let t0 = Date.now();
  await expect(page.getByTestId('engine-reply')).toBeVisible({ timeout: 30_000 });
  console.log(`puzzle engine reply after ${Date.now() - t0} ms:`, (await page.getByTestId('engine-reply').textContent())!.slice(0, 80));
  await expect(page.getByTestId('engine-reply')).toHaveAttribute('data-line', /\S+/);

  // An unsafe move from an own game, answered with a reply other than the stored one.
  await page.goto('./#/practice/run?mode=sense');
  const drill = page.getByTestId('sense-drill');
  let response: string | null = null;
  for (let i = 0; i < 12 && !response; i++) {
    await expect(drill).toHaveAttribute('data-phase', 'ask');
    if ((await drill.getAttribute('data-truth')) === 'true' && (await drill.getAttribute('data-kind')) === 'safe-or-not') {
      await page.getByTestId('sense-yes').click();
      await expect(drill).toHaveAttribute('data-phase', 'play');
      if ((await drill.getAttribute('data-expected')) === 'c6e5') {
        t0 = Date.now();
        await playMove(page, 'f8e7');
        await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
        response = await drill.getAttribute('data-response');
        console.log(`own-game reply checked after ${Date.now() - t0} ms: ${response}`);
        break;
      }
      await playMove(page, (await drill.getAttribute('data-expected'))!);
    } else {
      await page.getByTestId('sense-no').click();
    }
    await expect(page.getByTestId('sense-verdict')).toBeVisible();
    await page.getByTestId('sense-next').click();
  }
  const m = await measured(page);
  console.log('analysis at the end:', m);
  expect(m.measured).toBeLessThan(m.total);
  expect(response).not.toBeNull();
  expect(response, 'the reply must be judged, not left unverified').not.toBe('unverified-reply');
  const last = (await store(page, 'attempts')).filter((a) => a.exerciseKind === 'sense').pop();
  expect(last.outcome).not.toBe('skipped');
});
