import { expect, type Page, test } from '@playwright/test';
import { openApp } from './helpers';

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
