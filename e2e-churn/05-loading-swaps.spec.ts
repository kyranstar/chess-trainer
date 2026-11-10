import { expect, test, type Page } from '@playwright/test';
import { playMove } from '../e2e/helpers';
import { clones, mockChessCom, openApp, setUsername, store, waitMeasured, watch, watched } from './lib';

const START = new Date(2026, 10, 10, 9, 0, 0);

async function ready(page: Page, n: number) {
  await mockChessCom(page, clones(n));
  await page.clock.install({ time: START });
  await openApp(page, '#/progress');
  await setUsername(page);
  await waitMeasured(page, 40); // the rest keeps being analysed in the background, as on the phone
}

/**
 * The fixture games are 4 to 6 moves long, so their rows are tiny. A real analysed game of 40
 * moves stores its moves, clocks and two analysis records: roughly 10 to 20 KB. PAD_KB=15
 * adds that much inert data to every game row, straight in IndexedDB, so that reading the
 * games table takes as long as it would with real games. PAD_KB=0 leaves the rows as they are.
 */
const PAD = Number(process.env.PAD_KB ?? 0);
async function pad(page: Page, kb: number) {
  await page.evaluate((n) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('games', 'readwrite');
      const os = tx.objectStore('games');
      const all = os.getAll();
      all.onsuccess = () => {
        for (const g of all.result) os.put({ ...g, padding: Array.from({ length: n * 64 }, (_, i) => `pad-${i}-xxxxxxx`) });
      };
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  }), kb);
}

const short = (states: any[]) => states.map((s) => `${s.block ?? '-'}|${s.loading ? 'LOADING' : ''}|${s.holder ?? '-'}|${s.kicker ?? ''}|${s.puzzleId ?? ''}`);

test('resuming a session in the practice block from Today goes straight to the own-game question (no puzzle put up and taken away)', async ({ page }) => {
  await ready(page, 600);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  await page.getByTestId('end-block').click();
  await expect(run).toHaveAttribute('data-block', 'apply');
  await expect(page.getByTestId('sense-drill')).toHaveAttribute('data-phase', 'ask');

  // The learner looks at the plan and comes back (or iOS dropped the app and it was reopened).
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByTestId('block-apply')).toHaveClass(/is-current/);
  if (PAD) await pad(page, PAD);
  await watch(page);
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('sense-drill')).toHaveAttribute('data-phase', 'ask');
  await page.waitForTimeout(1000);
  const states = await watched(page);
  console.log('resume into practice:\n ' + short(states).join('\n '));
  const attempts = await store(page, 'attempts');
  console.log('attempts after resume:', attempts.map((a) => `${a.exerciseKind}/${a.outcome}`));
  expect(states.filter((s) => s.holder === 'puzzle'), 'no puzzle should be put up and taken away').toHaveLength(0);
});

test('cold start on the session screen in the practice block goes straight to the own-game question', async ({ page }) => {
  await ready(page, 600);
  await page.goto('./#/today');
  await page.getByTestId('start-session').click();
  const run = page.getByTestId('session-run');
  await expect(run).toHaveAttribute('data-block', 'learn');
  await page.getByTestId('end-block').click();
  await expect(run).toHaveAttribute('data-block', 'apply');
  await expect(page.getByTestId('sense-drill')).toHaveAttribute('data-phase', 'ask');
  if (PAD) await pad(page, PAD);

  // Everything the screen shows from the first moment of the new page, frame by frame.
  await page.addInitScript(() => {
    const w = window as any;
    w.__cold = [] as string[];
    const snap = () => {
      const q = (s: string) => document.querySelector(s);
      const holder = q('[data-testid=sense-drill],[data-testid=puzzle],[data-testid=practice-empty],.empty');
      return `${q('[data-testid=session-run]')?.getAttribute('data-block') ?? '-'}|${holder?.getAttribute('data-testid') ?? '-'}|${q('[data-testid=puzzle]')?.getAttribute('data-puzzle-id') ?? ''}|${q('[data-testid=puzzle]')?.getAttribute('data-phase') ?? ''}|${Math.round(performance.now())}`;
    };
    new MutationObserver(() => {
      const s = snap();
      const last = w.__cold[w.__cold.length - 1] as string | undefined;
      if (!last || last.split('|').slice(0, 4).join('|') !== s.split('|').slice(0, 4).join('|')) w.__cold.push(s);
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.reload();
  await expect(page.locator('[data-testid=sense-drill],[data-testid=puzzle][data-phase=solving]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  const cold = await page.evaluate(() => (window as any).__cold as string[]);
  console.log(`cold start in practice (pad ${PAD} KB/game), block|holder|puzzle|phase|ms:\n ` + cold.join('\n '));
  const attempts = await store(page, 'attempts');
  console.log('attempts after cold start:', attempts.map((a) => `${a.exerciseKind}/${a.outcome}/${a.exerciseId}`));
  expect(cold.filter((s) => s.split('|')[1] === 'puzzle'), 'no puzzle should be put up and then replaced by the own-game question').toHaveLength(0);
});

for (const kind of ['own', 'sense'] as const) {
  test(`review of a ${kind} item opens on the item, never on "no longer in the installed content pack"`, async ({ page }) => {
    await ready(page, 600);
    if (kind === 'own') {
      await page.goto('./#/practice/run?mode=own');
      await expect(page.getByTestId('own-drill')).toHaveAttribute('data-expected', 'h5f7');
      await playMove(page, 'h5e5');
      await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
    } else {
      await page.goto('./#/practice/run?mode=sense');
      const sense = page.getByTestId('sense-drill');
      await expect(sense).toHaveAttribute('data-phase', 'ask');
      await page.getByTestId((await sense.getAttribute('data-truth')) === 'true' ? 'sense-no' : 'sense-yes').click();
      await expect(page.getByTestId('sense-verdict')).toHaveAttribute('data-correct', 'false');
    }
    await expect.poll(async () => (await store(page, 'reviewStates')).length).toBe(1);
    await page.clock.setSystemTime(new Date(START.getTime() + 26 * 3_600_000));
    await page.goto('./#/practice');
    await expect(page.getByTestId('practice-review')).toContainText('1 due now');
    if (PAD) await pad(page, PAD);
    await watch(page);
    const t0 = Date.now();
    await page.getByTestId('practice-review').click();
    await expect(page.locator('[data-testid=own-drill],[data-testid=sense-drill]')).toBeVisible();
    const ms = Date.now() - t0;
    const states = await watched(page);
    console.log(`${kind} review opening (item visible after ~${ms} ms):\n ` + states.map((s) => `${s.loading ? 'LOADING ' : ''}${s.holder}`).join('\n '));
    expect(states.filter((s) => String(s.holder).includes('no longer in the installed content pack')), 'the item exists; it must not be announced as retired').toHaveLength(0);
  });
}
