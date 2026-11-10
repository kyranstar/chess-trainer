import { expect, test } from '@playwright/test';
import { openApp, playMove } from './helpers';

test('repertoire: record own moves by frequency, see engine evidence and coverage, recall on schedule, keep in backup', async ({ page }) => {
  await openApp(page, '#/practice/openings');
  await expect(page.getByTestId('coverage')).toContainText('rated blitz, rapid and classical games');

  // With nothing recorded the first gap is the starting position, reached in every game.
  const builder = page.getByTestId('gap-builder');
  await expect(builder).toHaveAttribute('data-path', '');
  await expect(builder).toHaveAttribute('data-reach', '1.0000');
  await expect(page.getByTestId('level-1')).toHaveAttribute('data-answered', '0.0000');

  await playMove(page, 'e2e4');
  await expect(page.getByTestId('move-evidence')).toContainText('Played here by');
  await expect(page.getByTestId('move-evidence')).toHaveAttribute('data-verdict', 'sound');
  await page.getByTestId('save-move').click();
  await expect(page.getByTestId('level-1')).toHaveAttribute('data-answered', '1.0000');

  // The next gap is the most common reply to 1.e4 at this level, not an arbitrary one.
  await expect(builder).toHaveAttribute('data-path', /^e4 \S+$/);
  const reply = (await builder.getAttribute('data-path'))!.split(' ')[1];
  const reach = Number(await builder.getAttribute('data-reach'));
  expect(reach).toBeGreaterThan(0.2);
  expect(reach).toBeLessThan(1);
  expect(reply).toBe('e5');

  // A clearly weaker move is flagged with numbers, but the choice stays the learner's.
  await playMove(page, 'd1h5');
  await expect(page.getByTestId('move-evidence')).toContainText('Engine evidence');
  await page.getByRole('button', { name: 'Choose another' }).click();
  await playMove(page, 'g1f3');
  await page.getByTestId('save-move').click();
  await expect(page.getByTestId('repertoire-row')).toHaveCount(2);
  const second = Number(await page.getByTestId('level-2').getAttribute('data-answered'));
  expect(second).toBeCloseTo(reach, 3);

  // Recall: a different move is named for what it is; the chosen move is what counts.
  await page.getByTestId('start-recall').click();
  const drill = page.getByTestId('opening-drill');
  await expect(drill).toHaveAttribute('data-expected', 'e2e4');
  await playMove(page, 'd2d4');
  await expect(page.getByTestId('drill-verdict')).toContainText('Your repertoire move is e4');
  await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-alt', 'sound');
  await page.getByTestId('drill-next').click();
  await expect(drill).toHaveAttribute('data-expected', 'g1f3');
  await playMove(page, 'g1f3');
  await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-ok', 'true');
  await page.getByTestId('drill-next').click();
  await expect(page.getByTestId('recall-done')).toBeVisible();

  // Both positions are now in the spaced-review queue; nothing is due again today.
  await page.goto('/#/practice/openings');
  await expect(page.getByTestId('recall-card')).toContainText('0 to recall now');
  await page.goto('/#/progress');
  const card = page.getByTestId('card-openings');
  await expect(card).toContainText('1 of 2 recalled');
  await expect(card).toContainText('1 sound by engine evidence');

  const download = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  let text = '';
  for await (const chunk of await (await download).createReadStream()) text += chunk;
  const backup = JSON.parse(text);
  expect(backup.manifest.schemaVersion).toBeGreaterThanOrEqual(3);
  expect(backup.data.repertoire.map((e: { san: string }) => e.san).sort()).toEqual(['Nf3', 'e4']);
});

test('repertoire: the learner’s own PGN can be imported, conflicts are reported, earlier choices are kept', async ({ page }, testInfo) => {
  await openApp(page, '#/practice/openings');
  const pgn = testInfo.outputPath('mine.pgn');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(pgn, '1. e4 e5 (1... c6 2. d4 d5 3. e5) 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *\n\n1. e4 e5 2. Bc4 *\n');
  await page.getByTestId('pgn-input').setInputFiles(pgn);
  await expect(page.getByTestId('pgn-message')).toContainText('Read 2 games: added 6 positions');
  await expect(page.getByTestId('pgn-message')).toContainText('1 appeared with two different moves in the file');
  await expect(page.getByTestId('repertoire-row')).toHaveCount(6);
  await expect(page.getByTestId('level-1')).toHaveAttribute('data-answered', '1.0000');
  // The Caro-Kann and 1...e5 are answered, so move 2 coverage is the sum of their real shares.
  expect(Number(await page.getByTestId('level-2').getAttribute('data-answered'))).toBeGreaterThan(0.5);

  const bad = testInfo.outputPath('bad.pgn');
  writeFileSync(bad, '1. e4 e5 2. Ke3 *');
  await page.getByTestId('pgn-input').setInputFiles(bad);
  await expect(page.getByTestId('pgn-message')).toContainText('Illegal or unreadable move Ke3');
  await expect(page.getByTestId('repertoire-row')).toHaveCount(6);

  const download = page.waitForEvent('download');
  await page.getByTestId('pgn-export').click();
  let text = '';
  for await (const chunk of await (await download).createReadStream()) text += chunk;
  expect(text).toContain('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *');
});

test('repertoire works offline once the app has been opened online', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'desktop-chromium', 'service-worker offline is exercised in Chromium');
  await openApp(page, '#/practice/openings');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('gap-builder')).toBeVisible();
  await expect(page.getByTestId('book-missing')).toHaveCount(0);
});
