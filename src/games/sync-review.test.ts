/**
 * Cases found by an independent review of the sync and analysis code (2026-11-10): month
 * rollover, a changed username, evening games west of Greenwich, an engine that never starts.
 * The time zone is pinned because two of them are about local calendar days.
 */
process.env.TZ = 'America/New_York';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDb, openDb, setMeta, type TrainerDB } from '../db/db';
import type { SessionRecord } from '../db/types';
import type { PvLine } from '../engine/uci';
import { analysePending, syncIfDue } from './autosync';
import { convertChessComGame, syncChessCom, type SyncFetch } from './chesscom';
import archive from './fixtures/chesscom-archive.fixture.json';
import { earlyBlunderGames, ratingSeries } from './metrics';
import { localDate, planSession, spend, suggestSessionKind } from '../schedule/session';

const API = 'https://api.chess.com/pub/player';
const names: string[] = [];
function fresh(): TrainerDB {
  const n = `rev-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(n);
  return openDb(n);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

type Months = Record<string, unknown[]>;
function fakeApi(user: string, months: () => Months) {
  const calls: string[] = [];
  const fetcher: SyncFetch = async (url) => {
    calls.push(url);
    const base = `${API}/${user}`;
    if (url === `${base}/stats`) return { status: 200, json: { chess_rapid: { last: { rating: 455, date: 1 } } }, etag: null };
    if (url === `${base}/games/archives`) return { status: 200, json: { archives: Object.keys(months()).map((m) => `${base}/games/${m}`) }, etag: null };
    const key = url.split('/games/')[1]!;
    // What the browser transport gives: a full 200 every time, and no readable ETag header across origins.
    return { status: 200, json: { games: months()[key] ?? [] }, etag: null };
  };
  return { fetcher, calls };
}

const games = (archive as { games: { url: string; white: { username: string }; black: { username: string } }[] }).games;
const mine = games.filter((g) => g.white.username === 'fixture_learner' || g.black.username === 'fixture_learner');

describe('month rollover', () => {
  it('games finished in a month after its last read are still fetched once a newer month exists', async () => {
    const db = fresh();
    let months: Months = { '2026/10': [mine[0]] };
    const api = fakeApi('fixture_learner', () => months);
    // 28 October: one game so far this month.
    expect((await syncChessCom(db, api.fetcher, 'fixture_learner', 1000)).added).toBe(1);
    // The learner plays again on 30 October and on 1 November, and opens the app on 2 November.
    months = { '2026/10': [mine[0], mine[1]], '2026/11': [mine[2]] };
    const second = await syncChessCom(db, api.fetcher, 'fixture_learner', 2000);
    expect(second.status).toBe('ok');
    expect(await db.games.count()).toBe(3); // the 30 October game must not be lost for good
    // ... and it never arrives later either:
    await syncChessCom(db, api.fetcher, 'fixture_learner', 3000);
    expect(await db.games.count()).toBe(3);
  });
});

describe('changing the username', () => {
  it('the previous player\'s games do not stay in the numbers', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, fakeApi('fixture_learner', () => ({ '2026/11': games })).fetcher, 1000);
    const before = await db.games.count();
    expect(before).toBeGreaterThan(0);
    // The handle is corrected to another account (here: the opponent of the first fixture game).
    await setMeta(db, 'chesscom.username', 'opponent_one');
    const theirs = games.filter((g) => g.white.username === 'opponent_one' || g.black.username === 'opponent_one');
    expect(theirs.length).toBeGreaterThan(0);
    await syncIfDue(db, fakeApi('opponent_one', () => ({ '2026/11': theirs })).fetcher, 2000, true);
    const all = await db.games.toArray();
    // Every stored game should now be one in which the current player took part, from their side.
    const rapid = ratingSeries(all, 'rapid');
    expect(rapid.n).toBeLessThanOrEqual(theirs.length);
  });
});

describe('a game finished in the evening, west of Greenwich', () => {
  const raw = {
    url: 'https://www.chess.com/game/live/900000099',
    time_control: '600',
    time_class: 'rapid',
    rated: true,
    rules: 'chess',
    end_time: Date.UTC(2026, 10, 10, 1, 0, 0) / 1000, // 20:00 on 9 November in New York
    white: { username: 'fixture_learner', rating: 500 },
    black: { username: 'someone', rating: 500 },
    pgn: '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.11.10"]\n[White "fixture_learner"]\n[Black "someone"]\n[Result "1-0"]\n[Timezone "UTC"]\n[UTCDate "2026.11.10"]\n[UTCTime "00:50:00"]\n[TimeControl "600"]\n[EndDate "2026.11.10"]\n[EndTime "01:00:00"]\n[Link "https://www.chess.com/game/live/900000099"]\n\n1. e4 e5 2. Nf3 Nc6 1-0',
  };

  it('is dated by the learner\'s own calendar day', async () => {
    expect(new Date(raw.end_time * 1000).getHours()).toBe(20); // the test really runs in New York time
    const { game } = await convertChessComGame(raw, 'fixture_learner');
    expect(game!.endDate).toBe(localDate(raw.end_time * 1000)); // 2026-11-09
  });

  it('counts as yesterday\'s play day the next morning, so the app does not ask for another game', async () => {
    const { game } = await convertChessComGame(raw, 'fixture_learner');
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).getTime();
    const studied = (d: number): SessionRecord => spend(planSession({ id: `s${d}`, now: at(d, 18), budgetMin: 30, statuses: [], dueCount: 0, online: true }), 2, 600, at(d, 18));
    const history = [studied(7), studied(8)];
    // Morning of 10 November, New York. The learner played a rapid game last night.
    expect(suggestSessionKind(history, at(10, 9), []).kind).toBe('play'); // without the game: two study days, so play
    const s = suggestSessionKind(history, at(10, 9), [game!.endDate]);
    expect(s.kind).toBe('study');
  });
});

describe('the engine never starts', () => {
  it('analysePending reports a failure instead of waiting for ever', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, fakeApi('fixture_learner', () => ({ '2026/11': games })).fetcher, 1000);
    // What UciEngine does when the worker script or the WASM file fails to load: `ready` never resolves.
    const never = new Promise<void>(() => {});
    const dead = { name: 'unknown', newGame: () => never, analyse: async (): Promise<PvLine[]> => { await never; return []; } };
    const outcome = await Promise.race([
      analysePending(db, dead, { nodes: 10, startTimeoutMs: 200 }).then(() => 'returned', () => 'threw'),
      new Promise<string>((r) => setTimeout(() => r('still waiting after 1.5 s'), 1500)),
    ]);
    expect(outcome).toBe('threw'); // the caller shows it; nothing waits in silence
  });
});

describe('headline inputs', () => {
  it('(information) earlyBlunderGames ignores games without a measure and reports them as pending', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, fakeApi('fixture_learner', () => ({ '2026/11': games })).fetcher, 1000);
    const all = await db.games.toArray();
    const e = earlyBlunderGames(all, { timeClass: 'rapid' });
    expect(e.games).toBe(0);
    expect(e.pending).toBe(all.filter((g) => g.timeClass === 'rapid' && g.rated !== false).length);
  });
});

describe('after Chess.com says "too many requests"', () => {
  it('automatic refreshes wait an hour; a refresh the learner asks for still goes out', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    let calls = 0;
    const limited: SyncFetch = async () => { calls++; return { status: 429, json: null, etag: null }; };
    expect((await syncIfDue(db, limited, 1000))?.status).toBe('rate-limited');
    expect(await syncIfDue(db, limited, 1000 + 10 * 60_000)).toBeNull();
    expect(calls).toBe(1);
    expect((await syncIfDue(db, limited, 1000 + 10 * 60_000, true))?.status).toBe('rate-limited');
    expect((await syncIfDue(db, limited, 1000 + 75 * 60_000))?.status).toBe('rate-limited');
    expect(calls).toBe(3);
  });

  it('a month that cannot be read does not block the months after it, and is tried again', async () => {
    const db = fresh();
    let broken = true;
    const base = `${API}/fixture_learner`;
    const fetcher: SyncFetch = async (url) => {
      if (url === `${base}/stats`) return { status: 200, json: {}, etag: null };
      if (url === `${base}/games/archives`) return { status: 200, json: { archives: [`${base}/games/2026/09`, `${base}/games/2026/10`] }, etag: null };
      if (url.endsWith('2026/09')) return broken ? { status: 500, json: null, etag: null } : { status: 200, json: { games: [mine[0]] }, etag: null };
      return { status: 200, json: { games: [mine[1]] }, etag: null };
    };
    const first = await syncChessCom(db, fetcher, 'fixture_learner', 1000);
    expect(first.status).toBe('error');
    expect(await db.games.count()).toBe(1); // October arrived although September failed
    broken = false;
    expect((await syncChessCom(db, fetcher, 'fixture_learner', 2000)).status).toBe('ok');
    expect(await db.games.count()).toBe(2);
  });
});

