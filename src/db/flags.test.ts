import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from './backup';
import { deleteDb, openDb } from './db';
import { clearFlag, type Flag, isFlagged, listFlags, setFlag } from './flags';
import { dataSignature, type RemoteFetch, setRemote, uploadIfChanged } from './remote';

const names: string[] = [];
async function fresh() {
  const name = `flags-test-${Math.random()}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const name of names.splice(0)) await deleteDb(name);
});

const flag = (id: string, ts: number, said = 'Good. You c6 +0.10 Game · Also good e6 +0.24'): Flag => ({ id, kind: 'own-move', ts, fen: 'r2qkb1r/ppp1ppp1/5np1/2Pn4/2BPp3/P1N5/1P3PPP/R1BQK2R b KQkq - 2 10', said, state: { phase: 'done', verdict: 'good' }, app: '0.1.0' });

describe('a position flagged for a later look', () => {
  it('is kept with what the screen said, one per position, newest first, and can be taken off', async () => {
    const db = await fresh();
    expect(await listFlags(db)).toEqual([]);
    await setFlag(db, flag('move:g1:19', 100));
    await setFlag(db, flag('lichess:abc', 200, 'Solved first try.'));
    expect(await isFlagged(db, 'move:g1:19')).toBe(true);
    expect(await isFlagged(db, 'move:g1:21')).toBe(false);
    expect((await listFlags(db)).map((f) => f.id)).toEqual(['lichess:abc', 'move:g1:19']);
    // Flagged again: the later one stands, with what the screen said then.
    await setFlag(db, flag('move:g1:19', 300, 'Good.'));
    const all = await listFlags(db);
    expect(all.map((f) => f.id)).toEqual(['move:g1:19', 'lichess:abc']);
    expect(all[0]).toMatchObject({ said: 'Good.', ts: 300, state: { verdict: 'good' } });
    await clearFlag(db, 'move:g1:19');
    expect((await listFlags(db)).map((f) => f.id)).toEqual(['lichess:abc']);
  });

  it('travels in a backup and is restored where it is missing', async () => {
    const a = await fresh();
    await setFlag(a, flag('move:g1:19', 100));
    const file = await exportBackup(a, 1000);
    expect(file.data.settings!.map((r) => r.key)).toEqual(['flag:move:g1:19']);
    const b = await fresh();
    await importBackup(b, serializeBackup(file));
    expect(await listFlags(b)).toEqual([flag('move:g1:19', 100)]);
  });

  it('is something new to send: setting one, replacing it and taking it off each change what the private copy holds', async () => {
    const db = await fresh();
    const none = await dataSignature(db);
    await setFlag(db, flag('move:g1:19', 100));
    const one = await dataSignature(db);
    await setFlag(db, flag('move:g1:19', 300));
    const replaced = await dataSignature(db);
    await clearFlag(db, 'move:g1:19');
    expect(new Set([none, one, replaced]).size).toBe(3);
    expect(await dataSignature(db)).toBe(none);

    // And it is sent: with nothing else changed since the last upload, a new flag goes out.
    await setRemote(db, 'someone/chess-trainer-data', 'test-token-not-a-real-one');
    let puts = 0;
    const fetchFn: RemoteFetch = async (_url, init) => {
      if (init?.method === 'PUT') puts++;
      return { ok: true, status: 200, json: async () => ({ sha: 'sha' }) };
    };
    expect((await uploadIfChanged(db, fetchFn, 1_000_000))?.ok).toBe(true);
    expect(await uploadIfChanged(db, fetchFn, 2_000_000)).toBeNull();
    await setFlag(db, flag('lichess:abc', 400));
    expect((await uploadIfChanged(db, fetchFn, 3_000_000))?.ok).toBe(true);
    expect(puts).toBe(2);
  });
});
