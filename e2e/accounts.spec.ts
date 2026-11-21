import { expect, type Page, test } from '@playwright/test';
import { failPuzzle, openApp } from './helpers';

/**
 * Accounts (ADR-063) on the stand-in account service (src/account/fake.ts): the build under
 * test has no Firebase config, and the fake is switched on by writing `ct.fake`.
 */
const ADMIN = 'owner@example.com';
const SAM = 'sam@example.com';
function state(extra: Record<string, unknown> = {}) {
  return { signedIn: null, invites: [{ email: SAM, name: 'Sam', invitedAt: 1 }], admins: [ADMIN], profiles: [], copies: {}, ...extra };
}
/** Sets the fake "server" once per browser (a reload keeps what the app wrote) and who signs in. */
async function fakeAccounts(page: Page, as: string, opts: { browserOk?: boolean; state?: Record<string, unknown> } = {}) {
  await page.addInitScript(([s, a, ok]) => {
    if (!localStorage.getItem('ct.fake')) localStorage.setItem('ct.fake', s as string);
    localStorage.setItem('ct.fake.as', a as string);
    if (ok) localStorage.setItem('ct.browserOk', '1');
  }, [JSON.stringify(opts.state ?? state()), as, opts.browserOk ?? true] as const);
}
async function mockChessCom(page: Page) {
  await page.route('**/api.chess.com/pub/player/samplays', (r) => r.fulfill({ json: { username: 'samplays', name: 'Sam P', avatar: undefined } }));
  await page.route('**/api.chess.com/pub/player/samplays/stats', (r) => r.fulfill({ json: { chess_rapid: { last: { rating: 900 } }, chess_blitz: { last: { rating: 850 } } } }));
  await page.route('**/api.chess.com/pub/player/nobody-here', (r) => r.fulfill({ status: 404, json: { code: 0, message: 'not found' } }));
  await page.route('**/api.chess.com/pub/player/samplays/games/archives', (r) => r.fulfill({ json: { archives: [] } }));
}
async function signIn(page: Page) {
  await page.goto('./#/today');
  await page.getByTestId('sign-in').click();
}

test('not invited sees only the list message', async ({ page }) => {
  await fakeAccounts(page, 'eve@example.com');
  await signIn(page);
  await expect(page.getByTestId('not-invited')).toContainText('eve@example.com');
  await expect(page.getByTestId('tab-today')).toHaveCount(0);
});

test('an invited friend: hello, Chess.com, greeting', async ({ page }) => {
  await mockChessCom(page);
  await fakeAccounts(page, SAM);
  await signIn(page);
  await expect(page.getByTestId('hello')).toContainText('Sam');
  await page.getByTestId('hello-continue').click();
  await page.getByTestId('chesscom-input').fill('nobody-here');
  await page.getByTestId('chesscom-check').click();
  await expect(page.getByTestId('chesscom-error')).toBeVisible();
  await page.getByTestId('chesscom-input').fill('samplays');
  await page.getByTestId('chesscom-check').click();
  await expect(page.getByTestId('chesscom-found')).toContainText('Sam P');
  await expect(page.getByTestId('chesscom-found')).toContainText('900');
  await page.getByTestId('chesscom-confirm').click();
  await openApp(page, '#/today');
  await expect(page.getByTestId('greeting')).toHaveText(/^Good (morning|afternoon|evening), Sam$/);
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('hello')).toHaveCount(0);
});

test('skipping Chess.com still reaches Today', async ({ page }) => {
  await fakeAccounts(page, SAM);
  await signIn(page);
  await page.getByTestId('hello-continue').click();
  await page.getByTestId('chesscom-skip').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
});

test('iPhone and iPad: install first, then sign in', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'an iPhone browser only');
  await fakeAccounts(page, SAM, { browserOk: false });
  await page.goto('./#/today');
  await expect(page.getByTestId('install-first')).toContainText('Add to Home Screen');
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await page.getByTestId('install-browser').click();
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('opens offline once allowed', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'offline is driven in Chromium only');
  await fakeAccounts(page, SAM, { state: state({ profiles: [{ uid: `fake-${SAM}`, email: SAM, name: 'Sam', chesscom: null, createdAt: 1, lastSeenAt: 1, appVersion: 't', onboarded: true, copyAt: null }] }) });
  await signIn(page);
  await openApp(page, '#/today');
  await expect(page.getByTestId('greeting')).toBeVisible();
  // The app must be stored first: offline, only the service worker can serve it.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(page.getByTestId('offline-ready')).toHaveAttribute('data-ready', 'true');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});

/** Makes the page report itself hidden, as when the app is sent to the background: the copy is sent then. */
async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('a second device gets the progress', async ({ browser }, info) => {
  const onboarded = { uid: `fake-${SAM}`, email: SAM, name: 'Sam', chesscom: null, createdAt: 1, lastSeenAt: 1, appVersion: 't', onboarded: true, copyAt: null };
  const a = await browser.newContext(info.project.use);
  const pa = await a.newPage();
  await fakeAccounts(pa, SAM, { state: state({ profiles: [onboarded] }) });
  await signIn(pa);
  await openApp(pa, '#/learn/safety.hanging-pieces');
  await pa.getByTestId('start-lesson').first().click();
  await expect(pa.getByTestId('lesson')).toBeVisible();
  await hide(pa);
  await expect.poll(async () => pa.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ct.fake')!).copies).length), { timeout: 20_000 }).toBe(1);
  const server = await pa.evaluate(() => localStorage.getItem('ct.fake')!);
  await a.close();

  const b = await browser.newContext(info.project.use);
  const pb = await b.newPage();
  await fakeAccounts(pb, SAM, { state: { ...JSON.parse(server), signedIn: null } });
  await signIn(pb);
  await openApp(pb, '#/learn');
  await expect(pb.getByTestId('concept-safety.hanging-pieces')).toHaveAttribute('data-stage', 'started');
  await b.close();
});

const profileOf = (email: string, name: string) => ({ uid: `fake-${email}`, email, name, chesscom: null, createdAt: 1, lastSeenAt: Date.UTC(2026, 10, 19), appVersion: 't', onboarded: true, copyAt: null });

test('the admin invites and removes', async ({ page }) => {
  const manifest = { rev: 1, chunks: 1, bytes: 100, sha256: 'x', exportTime: '2026-11-20T10:00:00.000Z', deviceId: 'd', appVersion: 't', schemaVersion: 4 };
  await fakeAccounts(page, ADMIN, { state: state({ profiles: [profileOf(ADMIN, 'Kyran'), profileOf(SAM, 'Sam')], copies: { [`fake-${SAM}`]: { manifest, chunks: ['x'] } } }) });
  await signIn(page);
  await openApp(page, '#/today');
  await page.getByTestId('account-link').click();
  await page.getByTestId('manage-access').click();
  await page.getByTestId('invite-name').fill('Eve');
  await page.getByTestId('invite-email').fill('Eve@Example.com');
  await page.getByTestId('invite-add').click();
  const eve = page.getByTestId('invite-row').filter({ hasText: 'eve@example.com' });
  await expect(eve).toContainText('Invited, not signed in yet');
  const sam = page.getByTestId('invite-row').filter({ hasText: SAM });
  await expect(sam).toContainText('Last seen');
  await expect(page.getByTestId('invite-row').filter({ hasText: ADMIN }).getByTestId('invite-remove')).toHaveCount(0);
  await sam.getByTestId('invite-remove').click();
  await expect(sam).toContainText('Access removed');
  await sam.getByTestId('delete-copy').click();
  await sam.getByTestId('delete-copy-confirm').click();
  await expect(sam.getByTestId('delete-copy')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ct.fake')!).copies))).toEqual([]);
});

test('a friend sees none of the owner things', async ({ page }) => {
  await fakeAccounts(page, SAM, { state: state({ profiles: [profileOf(SAM, 'Sam')] }) });
  await signIn(page);
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await failPuzzle(page);
  await page.getByRole('button', { name: 'Show solution' }).click();
  await expect(page.getByTestId('verdict-revealed')).toBeVisible();
  await expect(page.getByTestId('flag-item')).toHaveCount(0);
  await openApp(page, '#/progress/more/data');
  await expect(page.getByTestId('card-data')).toBeVisible();
  await expect(page.getByTestId('card-remote')).toHaveCount(0);
  await openApp(page, '#/account');
  await expect(page.getByTestId('account')).toContainText(SAM);
  await expect(page.getByTestId('card-remote')).toHaveCount(0);
  await expect(page.getByTestId('manage-access')).toHaveCount(0);
  await openApp(page, '#/practice/openings');
  await page.getByTestId('openings-more').locator('summary').click();
  await expect(page.getByTestId('course-row')).toHaveCount(0);
  await page.goto('./#/admin');
  await expect(page.getByTestId('greeting')).toBeVisible();
});

test('the admin keeps the owner things', async ({ page }) => {
  await fakeAccounts(page, ADMIN, { state: state({ profiles: [profileOf(ADMIN, 'Kyran')] }) });
  await signIn(page);
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await failPuzzle(page);
  await page.getByRole('button', { name: 'Show solution' }).click();
  await expect(page.getByTestId('verdict-revealed')).toBeVisible();
  await expect(page.getByTestId('flag-item')).toBeVisible();
  await openApp(page, '#/account');
  await expect(page.getByTestId('card-remote')).toBeVisible();
  await openApp(page, '#/practice/openings');
  await page.getByTestId('openings-more').locator('summary').click();
  await expect(page.getByTestId('course-row').first()).toBeVisible();
});

test('unlinking Chess.com from the account page', async ({ page }) => {
  await mockChessCom(page);
  await fakeAccounts(page, SAM, { state: state({ profiles: [profileOf(SAM, 'Sam')] }) });
  await signIn(page);
  await openApp(page, '#/account');
  await page.getByTestId('chesscom-change').click();
  await page.getByTestId('chesscom-input').fill('samplays');
  await page.getByTestId('chesscom-check').click();
  await page.getByTestId('chesscom-confirm').click();
  await expect(page.getByTestId('account-chesscom')).toContainText('samplays');
  await page.getByTestId('chesscom-unlink').click();
  await expect(page.getByTestId('account-chesscom')).toContainText('Not linked');
});

test('the admin flags any screen with a note; a friend has no flag', async ({ page }) => {
  await fakeAccounts(page, ADMIN, { state: state({ profiles: [profileOf(ADMIN, 'Kyran')] }) });
  await signIn(page);
  await openApp(page, '#/learn');
  await page.getByTestId('screen-flag').click();
  await page.getByTestId('flag-note').fill('Too much text at the top');
  await page.getByTestId('flag-save').click();
  await expect(page.getByTestId('flag-sheet')).toHaveCount(0);
  // Before a puzzle is answered there is no position flag, but the screen can be flagged from the bar.
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  await expect(page.getByTestId('flag-item')).toHaveCount(0);
  // One flag in sight: the bar's (the corner one is hidden on exercise screens).
  await expect(page.getByTestId('screen-flag').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('.run-bar').getByTestId('screen-flag')).toBeVisible();
  await openApp(page, '#/progress/more/data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-download').click()]);
  const backup = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  const flags = backup.data.settings.filter((r: { key: string }) => r.key.startsWith('flag:')).map((r: { value: unknown }) => r.value);
  expect(flags).toContainEqual(expect.objectContaining({ kind: 'screen', route: '#/learn', heading: 'Learn', note: 'Too much text at the top' }));
});

test('a friend has no flag on any screen', async ({ page }) => {
  await fakeAccounts(page, SAM, { state: state({ profiles: [profileOf(SAM, 'Sam')] }) });
  await signIn(page);
  await openApp(page, '#/learn');
  await expect(page.getByTestId('learn-home')).toBeVisible();
  await expect(page.getByTestId('screen-flag')).toHaveCount(0);
  await openApp(page, '#/practice/run?concept=mate.in-one');
  await expect(page.getByTestId('puzzle')).toHaveAttribute('data-phase', 'solving');
  await expect(page.getByTestId('screen-flag')).toHaveCount(0);
});
