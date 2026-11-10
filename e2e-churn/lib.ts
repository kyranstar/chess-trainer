import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** Fixture games in the shape Chess.com's public API returns (the tests run from the repository root). */
export const archive = JSON.parse(readFileSync('src/games/fixtures/chesscom-archive.fixture.json', 'utf8')) as { games: any[] };
export const API = 'https://api.chess.com/pub/player/fixture_learner';

/** Clones of the fixture games with distinct links and end times (the game id is a hash of the link). */
export function clones(n: number, from = 0, date?: string): any[] {
  const base = archive.games.filter((g) => g.time_class === 'rapid' || g.time_class === 'blitz');
  const out: any[] = [];
  for (let i = from; i < from + n; i++) {
    const g = base[i % base.length];
    const url = `https://www.chess.com/game/live/9100${String(i).padStart(5, '0')}`;
    // One date and a distinct end time each, so that analysis (newest first) cycles through the
    // different fixture games instead of doing all copies of one game first.
    const d = date ?? '2026.11.05';
    const t = `${String(Math.floor(i / 3600) % 24).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
    const pgn = String(g.pgn).replace(/\[Link "[^"]*"\]/, `[Link "${url}"]`)
      .replace(/\[EndDate "[^"]*"\]/, `[EndDate "${d}"]`).replace(/\[UTCDate "[^"]*"\]/, `[UTCDate "${d}"]`).replace(/\[Date "[^"]*"\]/, `[Date "${d}"]`)
      .replace(/\[EndTime "[^"]*"\]/, `[EndTime "${t}"]`);
    out.push({ ...g, url, end_time: (g.end_time ?? 0) + 60 * (i + 1), pgn });
  }
  return out;
}

export interface Mock { games: any[]; calls: string[]; fail: boolean; delayMs?: number }

/** Mocks every Chess.com request. `mock.games` can be changed at any time; the next sync sees it. */
export async function mockChessCom(page: Page, games: any[]): Promise<Mock> {
  const mock: Mock = { games, calls: [], fail: false };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    mock.calls.push(url.replace(API, ''));
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (mock.fail) return route.abort();
    if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs));
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: mock.games } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  return mock;
}

export async function openApp(page: Page, path = '#/today') {
  await page.goto(`./${path}`);
  await expect(page.getByTestId('app')).toHaveAttribute('data-pack', 'installed', { timeout: 30_000 });
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
}

/** Reads a whole object store straight from IndexedDB (no app code involved). */
export function store<T = any>(page: Page, name: string): Promise<T[]> {
  return page.evaluate((n) => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction(n).objectStore(n).getAll();
      all.onsuccess = () => { open.result.close(); resolve(all.result); };
      all.onerror = () => { open.result.close(); reject(all.error); };
    };
  }), name);
}

export async function put(page: Page, name: string, rows: any[]): Promise<void> {
  await page.evaluate(([n, rs]) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(n as string, 'readwrite');
      for (const r of rs as any[]) tx.objectStore(n as string).put(r);
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  }), [name, rows] as const);
}

export async function measured(page: Page): Promise<{ total: number; measured: number }> {
  const games = await store<{ measure?: unknown }>(page, 'games');
  return { total: games.length, measured: games.filter((g) => g.measure).length };
}

/** Sets the username from the Progress screen; fetching and analysis then run by themselves. */
export async function setUsername(page: Page) {
  if (!page.url().includes('#/progress')) await page.goto('./#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
}

/** Waits until at least `n` games have their measurement record. */
export async function waitMeasured(page: Page, n: number, timeout = 180_000) {
  await expect.poll(async () => (await measured(page)).measured, { timeout, intervals: [500] }).toBeGreaterThanOrEqual(n);
}

/** What the learner is looking at: enough to notice any swap, reset or jump. */
export async function snapshot(page: Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s);
    const attr = (s: string, a: string) => q(s)?.getAttribute(a) ?? null;
    const holder = q('[data-testid=sense-drill],[data-testid=puzzle],[data-testid=own-drill],[data-testid=kpk-drill],[data-testid=opening-drill],[data-testid=lesson-try],[data-testid=gap-builder]');
    return {
      holder: holder?.getAttribute('data-testid') ?? null,
      kicker: q('.puzzle-head .kicker')?.textContent ?? null,
      h2: q('.puzzle h2, .lesson h2, .concept h1')?.textContent ?? null,
      sub: q('.puzzle-head .muted')?.textContent ?? null,
      fen: attr('.board', 'data-fen'),
      orientation: attr('.board', 'data-orientation'),
      expected: holder?.getAttribute('data-expected') ?? null,
      phase: holder?.getAttribute('data-phase') ?? null,
      puzzleId: attr('[data-testid=puzzle]', 'data-puzzle-id'),
      lessonStep: attr('[data-testid=lesson]', 'data-step'),
      block: attr('[data-testid=session-run]', 'data-block'),
      hash: location.hash,
    };
  });
}

/** Fires a sync as if the phone came back online hours later. */
export async function comeBackOnline(page: Page, at: Date) {
  await page.clock.setSystemTime(at);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

export async function flipOffOn(page: Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(300);
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(300);
}

/**
 * Records every distinct state of the task on screen from now on (a MutationObserver, so a
 * swap that lasts one frame is caught too). `watched(page)` returns the states seen, in order.
 */
export async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__states?.obs?.disconnect();
    const snap = () => {
      const q = (s: string) => document.querySelector(s);
      const holder = q('[data-testid=sense-drill],[data-testid=puzzle],[data-testid=own-drill],[data-testid=kpk-drill],[data-testid=opening-drill],[data-testid=lesson-try],[data-testid=gap-builder],[data-testid=check-result],[data-testid=reflect-block],[data-testid=play-block],.empty');
      return JSON.stringify({
        holder: holder?.getAttribute('data-testid') ?? (holder ? 'empty:' + holder.textContent : null),
        kicker: q('.puzzle-head .kicker')?.textContent ?? null,
        h2: q('.puzzle h2')?.textContent ?? null,
        fen: q('.board')?.getAttribute('data-fen') ?? null,
        expected: holder?.getAttribute('data-expected') ?? null,
        phase: holder?.getAttribute('data-phase') ?? holder?.getAttribute('data-done') ?? holder?.getAttribute('data-finished') ?? null,
        puzzleId: q('[data-testid=puzzle]')?.getAttribute('data-puzzle-id') ?? null,
        lessonStep: q('[data-testid=lesson]')?.getAttribute('data-step') ?? null,
        block: q('[data-testid=session-run]')?.getAttribute('data-block') ?? null,
        loading: !!Array.from(document.querySelectorAll('main p.muted')).find((p) => /^Loading/.test(p.textContent ?? '')),
        hash: location.hash,
      });
    };
    const list: string[] = [snap()];
    const obs = new MutationObserver(() => {
      const s = snap();
      if (s !== list[list.length - 1]) list.push(s);
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    w.__states = { list, obs };
  });
}

export async function watched(page: Page): Promise<any[]> {
  return (await page.evaluate(() => (window as any).__states.list as string[])).map((s) => JSON.parse(s));
}

/** Lets `ms` of real time pass and reports how many games were analysed meanwhile. */
export async function churnFor(page: Page, ms: number): Promise<{ before: number; after: number; total: number }> {
  const b = await measured(page);
  await page.waitForTimeout(ms);
  const a = await measured(page);
  return { before: b.measured, after: a.measured, total: a.total };
}

export async function hideShow(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
}
