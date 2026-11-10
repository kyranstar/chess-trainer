import { afterEach, describe, expect, it } from 'vitest';
import { deleteDb, getMeta, openDb, type TrainerDB } from '../db/db';
import { convertChessComGame, gameIdFromUrl, syncChessCom, type SyncFetch } from './chesscom';
import archive from './fixtures/chesscom-archive.fixture.json';
import pipelineFile from './fixtures/my-games.fixture.json';
import { importGames } from './import';

const ME = 'fixture_learner';
const API = 'https://api.chess.com/pub/player/fixture_learner';
const names: string[] = [];
function fresh(): TrainerDB {
  const n = `cc-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(n);
  return openDb(n);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

const STATS = {
  chess_rapid: { last: { rating: 455, date: 1794000000 }, record: { win: 3, loss: 1, draw: 0 } },
  chess_blitz: { last: { rating: 431, date: 1793900000 }, record: { win: 0, loss: 0, draw: 1 } },
  chess_daily: { last: { rating: 772, date: 1793000000 }, record: { win: 0, loss: 1, draw: 0 } },
};

/** A fake Chess.com: serves stats, an archive list and monthly JSON with ETags; records every request. */
function fakeApi(months: Record<string, { games: unknown[]; etag: string }>, opts: { failAfter?: number; status?: number } = {}) {
  const calls: { url: string; etag: string | null }[] = [];
  let inFlight = 0;
  const fetcher: SyncFetch = async (url, etag) => {
    if (inFlight) throw new Error('requests must be serial');
    inFlight++;
    try {
      calls.push({ url, etag });
      if (opts.failAfter !== undefined && calls.length > opts.failAfter) return { status: opts.status ?? 429, json: null, etag: null };
      if (url === `${API}/stats`) return { status: 200, json: STATS, etag: 's1' };
      if (url === `${API}/games/archives`) return { status: 200, json: { archives: Object.keys(months).map((m) => `${API}/games/${m}`) }, etag: null };
      const key = url.split('/games/')[1]!;
      const m = months[key]!;
      if (etag && etag === m.etag) return { status: 304, json: null, etag: m.etag };
      return { status: 200, json: { games: m.games }, etag: m.etag };
    } finally {
      inFlight--;
    }
  };
  return { fetcher, calls };
}

describe('converting a Chess.com archive game', () => {
  it('reads side, result, ratings, time class, moves and clocks', async () => {
    const g = (await convertChessComGame(archive.games[1], ME)).game!;
    expect(g).toMatchObject({ color: 'black', result: 'loss', playerRating: 457, opponentRating: 470, timeClass: 'rapid', timeControl: '600+5', rated: true, source: 'chess.com' });
    expect(g.moves.slice(0, 4)).toEqual(['e2e4', 'e7e5', 'g1f3', 'g8f6']);
    expect(g.clocks![7]).toBe(20);
    expect(g.endDate).toBe('2026-11-02');
    expect(g.analysis).toBeNull();
  });

  it('gives the same id as the Mac pipeline, so both routes describe one game', async () => {
    const fromPhone = (await convertChessComGame(archive.games[0], ME)).game!;
    const fromMac = pipelineFile.games.find((x) => x.url === fromPhone.url)!;
    expect(fromPhone.id).toBe(fromMac.id);
    expect(fromPhone.moves).toEqual(fromMac.moves);
    expect(await gameIdFromUrl('https://www.chess.com/game/live/900000001')).toBe(fromMac.id);
  });

  it('leaves out coach and bot games, variants and games of other players, saying why', async () => {
    expect((await convertChessComGame(archive.games.find((g) => g.pgn.includes('Play vs Coach'))!, ME)).skipped).toBe('computer');
    expect((await convertChessComGame({ ...archive.games[0], rules: 'chess960' }, ME)).skipped).toBe('variant');
    expect((await convertChessComGame(archive.games[0], 'someone_else')).skipped).toBe('notPlayer');
    expect((await convertChessComGame({ ...archive.games[0], pgn: '[Event "x"]\n\n*' }, ME)).skipped).toBe('empty');
  });

  it('is case-insensitive about the username', async () => {
    expect((await convertChessComGame(archive.games[0], 'Fixture_Learner')).game!.color).toBe('white');
  });
});

describe('sync from the phone', () => {
  const months = () => ({ '2026/10': { games: archive.games.slice(3, 4), etag: 'a' }, '2026/11': { games: [...archive.games.slice(0, 3), ...archive.games.slice(4)], etag: 'b' } });

  it('stores current ratings and new games with one serial pass', async () => {
    const db = fresh();
    const api = fakeApi(months());
    const r = await syncChessCom(db, api.fetcher, ME, 1000);
    expect(r).toMatchObject({ status: 'ok', added: 6, skipped: { computer: 1 } });
    expect(await db.games.count()).toBe(6);
    const stats = await getMeta<{ rapid: { rating: number } }>(db, 'chesscom.ratings');
    expect(stats!.rapid.rating).toBe(455);
    expect(api.calls.map((c) => c.url)).toEqual([`${API}/stats`, `${API}/games/archives`, `${API}/games/2026/10`, `${API}/games/2026/11`]);
  });

  it('a second sync sends ETags, re-reads only the latest month and adds nothing', async () => {
    const db = fresh();
    await syncChessCom(db, fakeApi(months()).fetcher, ME, 1000);
    const api = fakeApi(months());
    const r = await syncChessCom(db, api.fetcher, ME, 2000);
    expect(r).toMatchObject({ status: 'ok', added: 0 });
    expect(api.calls.map((c) => [c.url.split('/pub/player/fixture_learner/')[1], c.etag])).toEqual([['stats', null], ['games/archives', null], ['games/2026/11', 'b']]);
  });

  it('never overwrites a game that already has an analysis; it only fills in whether the game was rated', async () => {
    const db = fresh();
    await importGames(db, JSON.stringify(pipelineFile), 500);
    const before = await db.games.toArray();
    expect(before.every((g) => g.rated === undefined)).toBe(true); // a PGN file does not say
    const r = await syncChessCom(db, fakeApi(months()).fetcher, ME, 1000);
    expect(r.added).toBe(0);
    const after = await db.games.toArray();
    const core = (g: (typeof after)[number]) => ({ ...g, rated: undefined, updatedAt: 0 });
    expect(after.map(core)).toEqual(before.map(core));
    expect(after.every((g) => typeof g.rated === 'boolean')).toBe(true);
  });

  it('stops quietly on rate limiting or when offline and keeps what it has', async () => {
    const db = fresh();
    const limited = await syncChessCom(db, fakeApi(months(), { failAfter: 3 }).fetcher, ME, 1000);
    expect(limited.status).toBe('rate-limited');
    expect(await db.games.count()).toBe(1);
    const offline = await syncChessCom(db, async () => { throw new TypeError('Failed to fetch'); }, ME, 2000);
    expect(offline.status).toBe('offline');
    expect(await db.games.count()).toBe(1);
  });

  it('reports an unknown username instead of failing silently', async () => {
    const r = await syncChessCom(fresh(), fakeApi(months(), { failAfter: 0, status: 404 }).fetcher, 'nobody_here', 1000);
    expect(r.status).toBe('not-found');
  });
});
