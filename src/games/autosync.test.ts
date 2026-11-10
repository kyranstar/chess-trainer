import { afterEach, describe, expect, it } from 'vitest';
import { legalDests, positionFromFen } from '../chess/rules';
import { deleteDb, getMeta, openDb, setMeta, type TrainerDB } from '../db/db';
import type { PvLine } from '../engine/uci';
import { analysePending, needsMeasure, SYNC_EVERY_MS, syncIfDue } from './autosync';
import type { SyncFetch } from './chesscom';
import archive from './fixtures/chesscom-archive.fixture.json';
import pipelineFile from './fixtures/my-games.fixture.json';
import { importGames } from './import';

const API = 'https://api.chess.com/pub/player/fixture_learner';
const names: string[] = [];
function fresh(): TrainerDB {
  const n = `auto-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(n);
  return openDb(n);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

function api() {
  const calls: string[] = [];
  const fetcher: SyncFetch = async (url) => {
    calls.push(url);
    if (url === `${API}/stats`) return { status: 200, json: { chess_rapid: { last: { rating: 455, date: 1 } } }, etag: null };
    if (url === `${API}/games/archives`) return { status: 200, json: { archives: [`${API}/games/2026/11`] }, etag: null };
    return { status: 200, json: archive, etag: 'e' };
  };
  return { fetcher, calls };
}
/** An engine that always says the position is level and offers the first legal move it finds. */
let newGames = 0;
const flatEngine = {
  name: 'Test engine',
  newGame: async () => { newGames++; },
  analyse: async (fen: string): Promise<PvLine[]> => {
    const [from, tos] = [...legalDests(positionFromFen(fen))].sort()[0]!;
    const move = `${from}${tos.slice().sort()[0]}`;
    return [{ move, score: { cp: 0 }, pv: [move] }];
  },
};

describe('automatic sync', () => {
  it('does nothing without a username', async () => {
    const db = fresh();
    const a = api();
    expect(await syncIfDue(db, a.fetcher, 1000)).toBeNull();
    expect(a.calls).toEqual([]);
  });

  it('syncs when a username is set, then waits before asking again', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    const a = api();
    const first = await syncIfDue(db, a.fetcher, 1_000_000);
    expect(first).toMatchObject({ status: 'ok', added: 6 });
    expect(await syncIfDue(db, a.fetcher, 1_000_000 + SYNC_EVERY_MS - 1)).toBeNull();
    expect(a.calls).toHaveLength(3);
    const later = await syncIfDue(db, a.fetcher, 1_000_000 + SYNC_EVERY_MS + 1);
    expect(later).toMatchObject({ status: 'ok', added: 0 });
  });

  it('a failed attempt (offline) is retried on the next launch, not after the full wait', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    const off = await syncIfDue(db, async () => { throw new TypeError('offline'); }, 1000);
    expect(off?.status).toBe('offline');
    expect((await syncIfDue(db, api().fetcher, 2000))?.status).toBe('ok');
  });

  it('force ignores the wait', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, api().fetcher, 1000);
    expect(await syncIfDue(db, api().fetcher, 2000, true)).toMatchObject({ status: 'ok' });
  });
});

describe('analysing games on the device', () => {
  it('measures every game with the device engine, newest first; a Mac analysis stays the one to look at, and a later import cannot remove the measurement', async () => {
    const db = fresh();
    await importGames(db, JSON.stringify({ ...pipelineFile, games: pipelineFile.games.slice(0, 2) }), 1);
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, api().fetcher, 1000);
    const macAnalysed = (await db.games.toArray()).filter((g) => g.analysis).map((g) => g.id);
    expect(macAnalysed).toHaveLength(2);
    const order: string[] = [];
    newGames = 0;
    const n = await analysePending(db, flatEngine, { nodes: 10, onProgress: (p) => order.push(`${p.done}/${p.total}`) });
    expect(n).toBe(6); // all six, including the two the Mac already analysed
    expect(newGames).toBe(7); // once to start, then the engine's memory is cleared before every game
    expect(order[0]).toBe('0/6');
    const deviceKey = 'game-analysis-v3/Test engine/10';
    let all = await db.games.toArray();
    for (const g of all) {
      expect(g.measureKey).toBe(deviceKey);
      expect(g.measure!.facts!.length).toBe(g.measure!.decisions.length);
      expect(g.analysisKey).toBe(macAnalysed.includes(g.id) ? 'game-analysis-v2/Stockfish 19/200000' : deviceKey);
    }
    expect(all.filter((g) => needsMeasure(g))).toEqual([]);
    expect(await analysePending(db, flatEngine, { nodes: 10 })).toBe(0); // nothing left to do

    // The full Mac file arrives afterwards: it becomes the analysis to look at for all six ...
    await importGames(db, JSON.stringify(pipelineFile), 2);
    all = await db.games.toArray();
    expect(all.filter((g) => g.analysisKey === 'game-analysis-v2/Stockfish 19/200000').length).toBe(pipelineFile.games.filter((g) => g.analysis).length);
    // ... and every measurement record is still there, untouched.
    for (const g of all) expect(g.measureKey).toBe(deviceKey);
    expect(await analysePending(db, flatEngine, { nodes: 10 })).toBe(0);
    expect(await getMeta(db, 'chesscom.username')).toBe('fixture_learner');
  });

  it('stops when told to and resumes later without redoing finished games', async () => {
    const db = fresh();
    await setMeta(db, 'chesscom.username', 'fixture_learner');
    await syncIfDue(db, api().fetcher, 1000);
    let budget = 9; // decisions allowed before "the app went to the background": one whole game and part of the next
    const first = await analysePending(db, flatEngine, { nodes: 10, keepGoing: () => budget-- > 0 });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(6);
    const second = await analysePending(db, flatEngine, { nodes: 10 });
    expect(first + second).toBe(6);
  });
});
