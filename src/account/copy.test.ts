import { afterEach, describe, expect, it } from 'vitest';
import { deleteDb, openDb, recordAttempt, SCHEMA_VERSION, setMeta, type TrainerDB } from '../db/db';
import type { AttemptDraft } from '../db/types';
import { __setChunkChars, memoryCopyStore, pullCopy, pushCopy } from './copy';

let n = 0;
const names: string[] = [];
function fresh(): TrainerDB {
  const name = `copy-${++n}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  __setChunkChars(900_000);
  for (const name of names.splice(0)) await deleteDb(name);
});

const T0 = Date.UTC(2026, 10, 20, 12);
function draft(i: number): AttemptDraft {
  return {
    sessionId: null, context: 'practice', exerciseId: `lichess:p${i}`, exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
    conceptId: 'tactics.double-attack', themes: ['fork'], rating: 1000, ts: T0 + i, elapsedMs: 4000, firstMove: 'e2e4',
    played: ['e2e4'], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
  };
}
async function answer(db: TrainerDB, from: number, count: number): Promise<void> {
  for (let i = from; i < from + count; i++) await recordAttempt(db, draft(i));
}

describe('the account copy', () => {
  it('round trip through chunks', async () => {
    __setChunkChars(1000);
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 5);
    expect(await pushCopy(a, store, T0)).toMatchObject({ ok: true });
    expect(store.manifest!.chunks).toBeGreaterThan(1);
    expect(await pullCopy(b, store)).toEqual({ merged: true });
    expect(await b.attempts.count()).toBe(5);
  });

  it('a push behind the server merges first', async () => {
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 1);
    await pushCopy(a, store, T0);
    await answer(b, 10, 3);
    expect(await pushCopy(b, store, T0 + 1)).toMatchObject({ ok: true });
    expect(store.manifest!.rev).toBe(2);
    expect(await b.attempts.count()).toBe(4);
    await pullCopy(a, store);
    expect(await a.attempts.count()).toBe(4);
  });

  it('nothing to send is not sent', async () => {
    const a = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 1);
    await pushCopy(a, store, T0);
    await pushCopy(a, store, T0 + 200_000);
    expect(store.manifest!.rev).toBe(1);
  });

  it('a change to a setting is sent', async () => {
    const a = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 1);
    await pushCopy(a, store, T0);
    await setMeta(a, 'chesscom.username', 'sam');
    await pushCopy(a, store, T0 + 200_000);
    expect(store.manifest!.rev).toBe(2);
  });

  it('a pull that brings nothing of ours does not cause a push', async () => {
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 2);
    await pushCopy(a, store, T0);
    await pullCopy(b, store);
    await pushCopy(b, store, T0 + 1);
    expect(store.manifest!.rev).toBe(1);
  });

  it('a damaged chunk is refused', async () => {
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 2);
    await pushCopy(a, store, T0);
    store.chunks[0] = `A${store.chunks[0]!.slice(1)}`;
    await expect(pullCopy(b, store)).rejects.toThrow();
    expect(await b.attempts.count()).toBe(0);
  });

  it('a newer copy is held back', async () => {
    const a = fresh();
    const b = fresh();
    const store = memoryCopyStore();
    await answer(a, 0, 1);
    await pushCopy(a, store, T0);
    store.manifest = { ...store.manifest!, schemaVersion: SCHEMA_VERSION + 1, rev: 5 };
    expect(await pullCopy(b, store)).toEqual({ merged: false, heldBack: 'newer-app' });
    await answer(b, 10, 1);
    expect(await pushCopy(b, store, T0 + 1)).toMatchObject({ ok: false, reason: 'newer-app' });
    expect(store.manifest!.rev).toBe(5);
  });
});
