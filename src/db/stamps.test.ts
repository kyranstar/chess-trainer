import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from './backup';
import { deleteDb, getMeta, openDb, setMeta, type TrainerDB } from './db';
import { clearFlag, setFlag } from './flags';
import { STAMP_PREFIX } from './stamps';

let n = 0;
const names: string[] = [];
function fresh(): TrainerDB {
  const name = `stamps-${++n}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of names.splice(0)) await deleteDb(name);
});

let clock = Date.UTC(2026, 10, 20, 12);
/** Each call moves the clock on a second, so every change has its own time. */
function tick(): void {
  clock += 1000;
  vi.spyOn(Date, 'now').mockReturnValue(clock);
}
async function carry(from: TrainerDB, to: TrainerDB): Promise<void> {
  await importBackup(to, serializeBackup(await exportBackup(from)));
}
const flag = (id: string) => ({ id, kind: 'puzzle', ts: clock, fen: null, said: 'x', state: {}, app: 'test' });

describe('settings travel with their change times', () => {
  it('a flag taken off stays off after a merge', async () => {
    const a = fresh();
    const b = fresh();
    tick(); await setFlag(a, flag('x'));
    await carry(a, b);
    expect(await getMeta(b, 'flag:x')).toBeDefined();
    tick(); await clearFlag(b, 'x');
    await carry(b, a);
    expect(await getMeta(a, 'flag:x')).toBeUndefined();
  });

  it('unlinking Chess.com travels', async () => {
    const a = fresh();
    const b = fresh();
    tick(); await setMeta(a, 'chesscom.username', 'sam');
    await carry(a, b);
    tick(); await b.meta.delete('chesscom.username');
    await carry(b, a);
    expect(await getMeta(a, 'chesscom.username')).toBeUndefined();
  });

  it('a later change wins either way', async () => {
    const a = fresh();
    const b = fresh();
    tick(); await setMeta(a, 'lessonProgress:l1@1', 3);
    tick(); await setMeta(b, 'lessonProgress:l1@1', 5);
    await carry(a, b);
    await carry(b, a);
    expect(await getMeta(a, 'lessonProgress:l1@1')).toBe(5);
    expect(await getMeta(b, 'lessonProgress:l1@1')).toBe(5);
  });

  it('a declined repertoire move travels', async () => {
    const a = fresh();
    const b = fresh();
    tick(); await setMeta(a, 'openings.declined', ['w:e4:e5']);
    await carry(a, b);
    expect(await getMeta(b, 'openings.declined')).toEqual(['w:e4:e5']);
  });

  it('an old file without stamps fills only what is missing', async () => {
    const a = fresh();
    const b = fresh();
    tick(); await setMeta(a, 'chesscom.username', 'from-file');
    await setMeta(a, 'openings.band', 1200);
    tick(); await setMeta(b, 'chesscom.username', 'mine');
    const file = await exportBackup(a);
    delete file.data.settingStamps;
    delete file.manifest.itemCounts.settingStamps;
    delete file.manifest.contentHashes.settingStamps;
    await importBackup(b, serializeBackup(file));
    expect(await getMeta(b, 'chesscom.username')).toBe('mine');
    expect(await getMeta(b, 'openings.band')).toBe(1200);
  });

  it('device keys are not stamped', async () => {
    const a = fresh();
    tick();
    await setMeta(a, 'deviceId', 'd1');
    await setMeta(a, 'chesscom.etags', {});
    expect(await a.meta.where('key').startsWith(STAMP_PREFIX).count()).toBe(0);
  });
});
