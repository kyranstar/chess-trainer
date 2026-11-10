import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, solvePuzzle } from './helpers';

test('baseline: samples unseen positions, can be paused and resumed, and never calls two positions a weakness', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('baseline-card')).toContainText('0 of');
  await page.getByTestId('start-baseline').click();
  const left = Number((await page.getByTestId('baseline-left').textContent())!.split(' ')[0]);
  expect(left).toBeGreaterThanOrEqual(20);

  await solvePuzzle(page);
  await page.getByTestId('next').click();
  await failPuzzle(page);
  await page.getByTestId('baseline-stop').click();

  const result = page.getByTestId('baseline-result');
  await expect(result).toHaveAttribute('data-complete', 'false');
  await expect(result).toContainText('Two positions cannot show strength or weakness');
  await expect(result).toContainText('untested');
  // The only readings a sampled concept can get are "provisional" or an invitation to pre-test.
  const readings = await result.locator('tbody tr td:nth-child(3)').allTextContents();
  expect(readings.every((r) => ['', 'provisional', 'pre-test to skip'].includes(r))).toBe(true);

  // Progress is derived from attempts, so leaving and returning resumes where it stopped.
  await page.goto('./#/today');
  await expect(page.getByTestId('start-baseline')).toHaveText('Continue the baseline');
  await page.getByTestId('start-baseline').click();
  // A position can carry several concept tags, so two positions remove at least two from the count.
  const leftNow = Number((await page.getByTestId('baseline-left').textContent())!.split(' ')[0]);
  expect(leftNow).toBeLessThanOrEqual(left - 2);
  expect(leftNow).toBeGreaterThan(0);
});

test('play day: suggested after two study sessions, game logged by hand, shown on Progress and in the backup', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('suggestion')).toHaveAttribute('data-kind', 'study');
  await page.getByTestId('start-play').click();

  // Nothing is due on a fresh profile, so the warm-up is skipped and the game block opens.
  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'play');
  await expect(page.getByTestId('play-block')).toContainText('cannot see the result');
  await page.getByTestId('game-finished').click();

  await expect(page.getByTestId('session-run')).toHaveAttribute('data-block', 'reflect');
  await page.getByTestId('save-reflection').click();
  await expect(page.getByRole('alert')).toContainText('Choose the result first');
  await page.getByTestId('result-loss').click();
  await page.getByTestId('color-black').click();
  await page.getByTestId('turning-point').fill('Move 14: left the knight on f6 undefended.');
  await page.getByTestId('next-time').fill('Look at what the last move attacks.');
  await page.getByTestId('rating-after').fill('449');
  await page.getByTestId('save-reflection').click();

  await expect(page.getByTestId('summary-game')).toHaveText('10+5 rapid, lost as black');
  await page.getByTestId('tab-progress').click();
  const card = page.getByTestId('card-journal');
  await expect(card).toContainText('0 won, 0 drawn, 1 lost');
  await expect(card).toContainText('Latest rapid rating you entered: 449');
  await expect(card).toContainText('Move 14: left the knight on f6 undefended.');
  await expect(card).toContainText('none of this is engine analysis');

  const download = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const stream = await (await download).createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk;
  const backup = JSON.parse(text);
  expect(backup.manifest.schemaVersion).toBeGreaterThanOrEqual(2);
  expect(backup.data.gameJournal).toHaveLength(1);
  expect(backup.data.gameJournal[0].turningPoint).toContain('knight on f6');
});

test('the 30-day projection lists play days and marks which lessons need a connection', async ({ page }) => {
  await openApp(page, '#/learn');
  await page.getByTestId('plan-30').locator('summary').click();
  const rows = page.getByTestId('plan-30').locator('tbody tr');
  await expect(rows).toHaveCount(30);
  expect(await page.getByTestId('plan-30').locator('tr[data-kind=play]').count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId('plan-30')).toContainText('on device');
  await expect(page.getByTestId('plan-30')).toContainText('online');
});
