import { expect, test } from '@playwright/test';
import { openApp, solvePuzzle } from './helpers';

// Every request of the page must be answerable by the test (see autosync.spec.ts).
test.use({ serviceWorkers: 'block' });

test('private copy: off by default; with a repository and a token the backup is sent there, again when practice changes; stopping forgets the token', async ({ page }) => {
  const TOKEN = 'e2e-token-not-a-real-one';
  const puts: { url: string; auth: string | undefined; body: { message: string; content: string; sha?: string } }[] = [];
  let sha: string | null = null;
  let github = 0;
  await page.route('https://api.github.com/**', async (route) => {
    github++;
    const req = route.request();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT' } });
    if (req.method() === 'GET') return sha ? route.fulfill({ headers, json: { sha } }) : route.fulfill({ status: 404, headers, json: { message: 'Not Found' } });
    puts.push({ url: req.url(), auth: req.headers().authorization, body: req.postDataJSON() });
    sha = `sha-${puts.length}`;
    return route.fulfill({ status: puts.length === 1 ? 201 : 200, headers, json: { content: { sha } } });
  });

  // One attempt, so there is something to send.
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await solvePuzzle(page);
  await page.goto('./#/progress');
  const card = page.getByTestId('card-remote');
  await expect(card).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('card-data')).toContainText('Nothing is uploaded.');
  // Not set up: GitHub has not been contacted at all.
  expect(github).toBe(0);

  await page.getByTestId('remote-repo').fill('tester/chess-trainer-data');
  await page.getByTestId('remote-token').fill(TOKEN);
  await page.getByTestId('remote-start').click();
  await expect(page.getByTestId('remote-note')).toContainText('Sent ');
  await expect(card).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('remote-status')).toContainText('tester/chess-trainer-data');
  await expect(page.getByTestId('remote-status')).toContainText('Last sent');
  await expect(page.getByTestId('card-data')).toContainText('A copy of the backup is sent to your private repository tester/chess-trainer-data');
  expect(puts).toHaveLength(1);
  expect(puts[0]!.url).toBe('https://api.github.com/repos/tester/chess-trainer-data/contents/backup.json.gz');
  expect(puts[0]!.auth).toBe(`Bearer ${TOKEN}`);
  expect(puts[0]!.body.content.length).toBeGreaterThan(100);
  // The token is not shown anywhere on the page once saved.
  await expect(page.locator('body')).not.toContainText(TOKEN);

  // A manual send replaces the file (it carries the version it replaces).
  await page.getByTestId('remote-send').click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]!.body.sha).toBe('sha-1');

  // Stopping removes the token from the device.
  await page.getByTestId('remote-stop').click();
  await expect(card).toHaveAttribute('data-on', 'false');
  const left = await page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('chess-trainer');
    open.onsuccess = () => {
      const all = open.result.transaction('meta').objectStore('meta').getAll();
      all.onsuccess = () => { open.result.close(); resolve(JSON.stringify(all.result)); };
    };
  }));
  expect(left).not.toContain(TOKEN);
  expect(left).not.toContain('remote.');
});
