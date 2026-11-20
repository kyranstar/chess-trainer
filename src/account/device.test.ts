import { afterEach, describe, expect, it } from 'vitest';
import { deleteDb, getMeta, openDb, recordAttempt, setMeta } from '../db/db';
import type { AttemptDraft } from '../db/types';
import { dbNameFor, inferUsername, LEGACY_DB } from './device';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const draft: AttemptDraft = {
  sessionId: null, context: 'practice', exerciseId: 'lichess:a', exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
  conceptId: 'tactics.double-attack', themes: [], rating: 1000, ts: 1, elapsedMs: 1, firstMove: 'e2e4',
  played: ['e2e4'], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
};
async function legacyWithPractice(): Promise<void> {
  const db = openDb(LEGACY_DB);
  await recordAttempt(db, draft);
  db.close();
}
afterEach(async () => {
  await deleteDb(LEGACY_DB);
});

describe('which database an account uses on this device', () => {
  it('the admin adopts the old database', async () => {
    await legacyWithPractice();
    expect(await dbNameFor('u-admin', true, memoryStorage())).toBe(LEGACY_DB);
  });

  it('a member never adopts the old database', async () => {
    await legacyWithPractice();
    const storage = memoryStorage();
    expect(await dbNameFor('u-sam', false, storage)).toBe('chess-trainer:u-sam');
    const old = openDb(LEGACY_DB);
    expect(await old.attempts.count()).toBe(1);
    old.close();
  });

  it('adoption is remembered', async () => {
    await legacyWithPractice();
    const storage = memoryStorage();
    expect(await dbNameFor('u-admin', true, storage)).toBe(LEGACY_DB);
    expect(await dbNameFor('u-admin', true, storage)).toBe(LEGACY_DB);
    expect(await dbNameFor('u-other-admin', true, storage)).toBe('chess-trainer:u-other-admin');
  });

  it('an empty old database is not adopted', async () => {
    openDb(LEGACY_DB).close();
    expect(await dbNameFor('u-admin', true, memoryStorage())).toBe('chess-trainer:u-admin');
  });
});

describe('the Chess.com username of an adopted database', () => {
  const name = `infer-${Math.random().toString(36).slice(2)}`;
  afterEach(async () => {
    await deleteDb(name);
  });

  it('is the player the stored games were fetched for', async () => {
    const db = openDb(name);
    await setMeta(db, 'chesscom.gamesOf', 'kyranstar');
    expect(await inferUsername(db)).toBe('kyranstar');
    expect(await getMeta(db, 'chesscom.username')).toBe('kyranstar');
  });

  it('nothing fetched, no username', async () => {
    const db = openDb(name);
    expect(await inferUsername(db)).toBeNull();
    expect(await getMeta(db, 'chesscom.username')).toBeUndefined();
  });

  it('a stored username is kept', async () => {
    const db = openDb(name);
    await setMeta(db, 'chesscom.gamesOf', 'old');
    await setMeta(db, 'chesscom.username', 'chosen');
    expect(await inferUsername(db)).toBe('chosen');
  });

  it('an unlinked account stays unlinked', async () => {
    const db = openDb(name);
    await setMeta(db, 'chesscom.gamesOf', 'old');
    await setMeta(db, 'chesscom.username', '');
    expect(await inferUsername(db)).toBe('');
  });
});
