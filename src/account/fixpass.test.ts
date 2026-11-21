/**
 * The final review's findings on the accounts round (ADR-063), each reproduced before its fix:
 * a deleted copy must be written again, an "update the app" notice must survive a quiet push,
 * removed repertoire moves must stay removed through a merge both ways, and games of another
 * Chess.com player must never be merged in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from '../db/backup';
import { deleteDb, getMeta, openDb, recordAttempt, SCHEMA_VERSION, setMeta, type TrainerDB } from '../db/db';
import type { AttemptDraft } from '../db/types';
import type { GameRecord } from '../games/types';
import { declineEntry, DECLINED_KEY, putByHand } from '../openings/auto';
import { makeEntry } from '../openings/repertoire';
import { COPY_ERROR, memoryCopyStore, pushCopy, syncOnce } from './copy';

const names: string[] = [];
function fresh(): TrainerDB {
  const name = `fix-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});
const T0 = Date.UTC(2026, 10, 21, 12);
const draft = (i: number): AttemptDraft => ({
  sessionId: null, context: 'practice', exerciseId: `lichess:f${i}`, exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
  conceptId: 'tactics.double-attack', themes: [], rating: 1000, ts: T0 + i, elapsedMs: 1, firstMove: 'e2e4',
  played: ['e2e4'], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
});
async function carry(from: TrainerDB, to: TrainerDB): Promise<void> {
  await importBackup(to, serializeBackup(await exportBackup(from)));
}
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('a deleted copy', () => {
  it('is written again in full by the next push', async () => {
    const a = fresh();
    const store = memoryCopyStore();
    await recordAttempt(a, draft(1));
    await pushCopy(a, store, T0);
    store.manifest = null;
    store.chunks = [];
    await recordAttempt(a, draft(2));
    expect(await pushCopy(a, store, T0 + 200_000)).toMatchObject({ ok: true });
    expect((await store.readManifest())?.rev).toBe(1);
  });
});

describe('a copy from a newer version of the app', () => {
  it('keeps its notice through a push with nothing new', async () => {
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await recordAttempt(a, draft(1));
    await pushCopy(a, store, T0);
    await recordAttempt(b, draft(2));
    await syncOnce(b, store, 'pull', T0);
    store.manifest = { ...store.manifest!, rev: 9, schemaVersion: SCHEMA_VERSION + 1 };
    await syncOnce(b, store, 'pull', T0 + 1);
    expect(await getMeta(b, COPY_ERROR)).toBe('newer-app');
    await syncOnce(b, store, 'tick', T0 + 300_000);
    expect(await getMeta(b, COPY_ERROR)).toBe('newer-app');
  });
});

describe('repertoire moves removed on one device', () => {
  it('a removed suggestion stays removed after a merge both ways', async () => {
    const a = fresh();
    const b = fresh();
    const entry = { ...makeEntry('white', START, [], 'e2e4', T0), source: 'suggested' as const };
    await a.repertoire.put(entry);
    await carry(a, b);
    await declineEntry(a, entry);
    await carry(a, b);
    await carry(b, a);
    expect(await a.repertoire.get(entry.id)).toBeUndefined();
    expect(await b.repertoire.get(entry.id)).toBeUndefined();
  });

  it('a move recorded by hand and removed stays removed', async () => {
    const a = fresh();
    const b = fresh();
    const entry = makeEntry('white', START, [], 'd2d4', T0);
    await putByHand(a, [entry]);
    await carry(a, b);
    await declineEntry(a, entry);
    await carry(b, a);
    expect(await a.repertoire.get(entry.id)).toBeUndefined();
  });

  it('a move recorded by hand again after a removal is kept', async () => {
    const a = fresh();
    const b = fresh();
    const entry = makeEntry('white', START, [], 'd2d4', T0);
    await putByHand(a, [entry]);
    await declineEntry(a, entry);
    await carry(a, b);
    await putByHand(a, [{ ...entry, updatedAt: T0 + 5 }]);
    await carry(b, a);
    expect(await a.repertoire.get(entry.id)).toBeDefined();
    expect(((await getMeta<string[]>(a, DECLINED_KEY)) ?? []).includes(entry.id)).toBe(false);
  });
});

describe('games of another Chess.com player', () => {
  const game = (id: string): GameRecord => ({
    id, source: 'chess.com', url: null, date: '2026-11-01', endDate: '2026-11-01', endTime: null, timeControl: '600', timeClass: 'rapid',
    color: 'white', result: 'win', termination: null, playerRating: 500, opponentRating: 500, opponent: 'x', moves: [], clocks: null,
    analysis: null, importedAt: T0, updatedAt: T0, analysisKey: null,
  } as GameRecord);

  it('are not merged into a device that follows a different player', async () => {
    const a = fresh();
    const b = fresh();
    await setMeta(a, 'chesscom.gamesOf', 'alice');
    await a.games.put(game('alice-1'));
    await setMeta(b, 'chesscom.gamesOf', 'bob');
    await b.games.put(game('bob-1'));
    await carry(a, b);
    expect((await b.games.toArray()).map((g) => g.id)).toEqual(['bob-1']);
  });

  it('come with their player to a new device', async () => {
    const a = fresh();
    const c = fresh();
    await setMeta(a, 'chesscom.gamesOf', 'alice');
    await a.games.put(game('alice-1'));
    await carry(a, c);
    expect((await c.games.toArray()).map((g) => g.id)).toEqual(['alice-1']);
    expect(await getMeta(c, 'chesscom.gamesOf')).toBe('alice');
  });
});
