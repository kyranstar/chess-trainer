import { expect, test, type Page } from '@playwright/test';
import { clones, mockChessCom, openApp, setUsername, store } from './lib';

async function studyDay(page: Page) {
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  for (const b of ['learn', 'apply']) {
    await expect(run).toHaveAttribute('data-block', b);
    await page.waitForTimeout(1200); // a second on the block clock, so the day counts as used
    await page.getByTestId('end-block').click();
  }
  await expect(run).toHaveAttribute('data-block', 'test');
  await page.waitForTimeout(1200);
  await page.getByTestId('end-block').click();
  await page.getByTestId('end-confirm-yes').click();
  await expect(page.getByTestId('summary')).toBeVisible();
}

const topButton = (page: Page) => page.evaluate(() => {
  const b = document.querySelector('[data-testid=today] .actions button')!;
  const r = b.getBoundingClientRect();
  return { testid: b.getAttribute('data-testid'), text: b.textContent, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});

test('the start buttons on Today keep their places when the launch sync brings in yesterday\'s game and changes the suggestion', async ({ page }) => {
  const mock = await mockChessCom(page, []);
  await page.clock.install({ time: new Date(2026, 10, 10, 8, 0, 0) });
  await openApp(page, '#/progress');
  await setUsername(page);
  await expect(page.getByTestId('card-games-import')).toHaveAttribute('data-sync', 'ok');

  // Two study days.
  await page.goto('./#/today');
  await studyDay(page);
  await page.clock.setSystemTime(new Date(2026, 10, 11, 8, 0, 0));
  await openApp(page, '#/today');
  await studyDay(page);

  // That evening a rapid game is played on Chess.com. Next morning the app is opened.
  mock.games = clones(1, 0, '2026.11.11');
  mock.delayMs = 700; // a phone network: each of the three requests takes a moment
  await page.clock.setSystemTime(new Date(2026, 10, 12, 8, 0, 0));
  await openApp(page, '#/today');
  await expect(page.getByTestId('suggestion')).toHaveAttribute('data-kind', 'play');
  const before = await topButton(page);
  const at = (p: { x: number; y: number }) => page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.getAttribute('data-testid') ?? null, [p.x, p.y]);
  expect(await at(before)).toBe('start-session'); // study is always the upper button; only the emphasis follows the suggestion

  // The learner reads the suggestion and reaches for the big button. Meanwhile the sync finishes.
  await expect.poll(async () => (await store(page, 'games')).length, { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(500);
  const after = await topButton(page);
  const under = await at(before);
  console.log('before:', before, '\nafter:', after, '\nunder the same point now:', under, '\nsuggestion now:', await page.getByTestId('suggestion').textContent());
  // The tap lands where it was aimed.
  await page.touchscreen.tap(before.x, before.y);
  await expect(page.getByTestId('session-run')).toBeVisible();
  const sessions = (await store(page, 'sessions')).filter((s) => s.date === '2026-11-12');
  await page.goto('./#/today');
  await expect(page.getByTestId('resume-session')).toBeVisible();
  console.log('session created by the tap:', sessions.map((s) => s.kind), '| Today now offers: start buttons', await page.getByTestId('start-play').count() + await page.getByTestId('start-session').count(), ', resume', await page.getByTestId('resume-session').count());
  expect(under, 'the button under the finger must not change meaning').toBe('start-session');
  expect(after.testid).toBe(before.testid);
  expect(sessions.map((s) => s.kind)).toEqual(['study']);
});
