import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { failPuzzle, openApp, solvePuzzle } from './helpers';

test('backup on one device restores on a clean one; a damaged file changes nothing', async ({ page, browser }, testInfo) => {
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await solvePuzzle(page);
  await page.getByTestId('next').click();
  await failPuzzle(page);
  await page.goto('/#/progress');
  await expect(page.getByTestId('card-unseen')).toContainText('1 of 2');
  await expect(page.getByTestId('last-backup')).toContainText('No backup has been made');

  const download = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const file = testInfo.outputPath('backup.json');
  await (await download).saveAs(file);
  await expect(page.getByTestId('data-message')).toContainText('2 attempts');
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.manifest.format).toBe('chess-trainer-backup');
  expect(backup.manifest.itemCounts.attempts).toBe(2);

  // A second, clean browser profile stands in for the other device.
  const other = await browser.newContext({ ...testInfo.project.use });
  const page2 = await other.newPage();
  await openApp(page2, '#/progress');
  await expect(page2.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();

  const damaged = testInfo.outputPath('damaged.json');
  writeFileSync(damaged, readFileSync(file, 'utf8').replace('"outcome":"fail"', '"outcome":"success"'));
  await page2.getByTestId('restore-input').setInputFiles(damaged);
  await expect(page2.getByTestId('data-message')).toContainText('does not match its checksum');
  await expect(page2.getByTestId('data-message')).toContainText('Nothing on this device was changed');
  await expect(page2.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();

  await page2.getByTestId('restore-input').setInputFiles(file);
  await expect(page2.getByTestId('data-message')).toContainText('added 2 attempts');
  await expect(page2.getByTestId('card-unseen')).toContainText('1 of 2');
  await page2.getByTestId('tab-practice').click();
  await expect(page2.getByTestId('practice-review')).toContainText('1 in the queue');

  // Restoring again is harmless.
  await page2.getByTestId('tab-progress').click();
  await page2.getByTestId('restore-input').setInputFiles(file);
  await expect(page2.getByTestId('data-message')).toContainText('added 0 attempts');
  await other.close();
});
