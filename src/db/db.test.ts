import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, parseBackup, serializeBackup } from './backup';
import { deleteDb, getDeviceId, getMeta, openDb, recordAttempt, recordLessonEvent, saveSession, setMeta, type TrainerDB, updateSession, ensureReviewPolicy } from './db';
import type { AttemptDraft, SessionRecord } from './types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 12);
let n = 0;
const names: string[] = [];
function fresh(): TrainerDB {
  const name = `test-${++n}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const name of names.splice(0)) await deleteDb(name);
});

function draft(over: Partial<AttemptDraft> = {}): AttemptDraft {
  return {
    sessionId: null, context: 'practice', exerciseId: 'lichess:a', exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
    conceptId: 'tactics.double-attack', themes: ['fork'], rating: 1000, ts: T0, elapsedMs: 4000, firstMove: 'e2e4',
    played: ['e2e4'], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false, ...over,
  };
}
const session = (id: string): SessionRecord => ({
  id, date: '2026-11-10', createdAt: T0, updatedAt: T0, budgetMin: 30, plannerVersion: 'p1', status: 'active', blocks: [],
});

describe('attempt log', () => {
  it('stamps device, freshness and scheduler version', async () => {
    const db = fresh();
    const a = await recordAttempt(db, draft());
    expect(a.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.deviceId).toBe(await getDeviceId(db));
    expect(a.fresh).toBe(true);
    expect(a.scheduledReview).toBe(false);
    expect(a.daysSinceLast).toBeNull();
    const b = await recordAttempt(db, draft({ ts: T0 + 3 * DAY }));
    expect(b.fresh).toBe(false);
    expect(b.daysSinceLast).toBe(3);
  });

  it('a failed puzzle is queued, and its next due attempt is a scheduled review', async () => {
    const db = fresh();
    await recordAttempt(db, draft({ outcome: 'fail' }));
    const state = await db.reviewStates.get('lichess:a');
    expect(state).toBeDefined();
    const early = await recordAttempt(db, draft({ ts: T0 + 1000 }));
    expect(early.scheduledReview).toBe(false); // seen again before it was due
    const due = await recordAttempt(db, draft({ ts: state!.due + DAY * 30 }));
    expect(due.scheduledReview).toBe(true);
    expect(due.fresh).toBe(false);
  });

  it('the gap since last seen ignores showings that were skipped', async () => {
    const db = fresh();
    await recordAttempt(db, draft({ outcome: 'fail', ts: T0 }));
    await recordAttempt(db, draft({ outcome: 'skipped', ts: T0 + 10 * DAY }));
    const real = await recordAttempt(db, draft({ outcome: 'success', ts: T0 + 10 * DAY + 3_600_000 }));
    expect(real.daysSinceLast).toBe(10);
    expect(real.fresh).toBe(false);
  });

  it('session changes made at the same moment are all kept', async () => {
    const db = fresh();
    const block = { kind: 'review' as const, budgetSec: 420, spentSec: 10, status: 'active' as const, conceptId: null, reason: '', notice: null, attemptUuids: [] };
    await saveSession(db, { ...session('s1'), blocks: [block] });
    // The clock tick and a recorded attempt both start from the same stale snapshot.
    await Promise.all([
      updateSession(db, 's1', (s) => ({ ...s, blocks: s.blocks.map((b, i) => (i === 0 ? { ...b, spentSec: b.spentSec + 5 } : b)) })),
      updateSession(db, 's1', (s) => ({ ...s, blocks: s.blocks.map((b, i) => (i === 0 ? { ...b, attemptUuids: [...b.attemptUuids, 'u-1'] } : b)) })),
    ]);
    const row = (await db.sessions.get('s1'))!;
    expect(row.blocks[0]!.attemptUuids).toContain('u-1');
    expect(row.blocks[0]!.spentSec).toBe(15);
    // A session that does not exist is never created by an update.
    await updateSession(db, '', (s) => s);
    await updateSession(db, 'nope', (s) => s);
    expect(await db.sessions.count()).toBe(1);
  });

  it('attempts are append-only: the same uuid cannot be written twice', async () => {
    const db = fresh();
    const a = await recordAttempt(db, draft());
    await expect(db.attempts.add(a)).rejects.toThrow();
    expect(await db.attempts.count()).toBe(1);
  });

  it('survives closing and reopening the database', async () => {
    const db = fresh();
    const name = db.name;
    const a = await recordAttempt(db, draft({ outcome: 'fail' }));
    const device = await getDeviceId(db);
    db.close();
    const again = openDb(name);
    expect(await again.attempts.get(a.uuid)).toEqual(a);
    expect(await getDeviceId(again)).toBe(device);
    expect(await again.reviewStates.count()).toBe(1);
  });
});

describe('backup and restore', () => {
  async function seeded(): Promise<TrainerDB> {
    const db = fresh();
    await recordAttempt(db, draft({ outcome: 'fail' }));
    await recordAttempt(db, draft({ exerciseId: 'lichess:b', outcome: 'success', ts: T0 + 5 }));
    await recordAttempt(db, draft({ exerciseId: 'lichess:a', outcome: 'success', ts: T0 + 2 * DAY }));
    await recordLessonEvent(db, { conceptId: 'tactics.double-attack', lessonId: 'lasker-double-attack', url: null, type: 'local-completed', ts: T0 });
    await saveSession(db, session('s1'));
    return db;
  }

  it('round-trips into a clean database: attempts, lesson events, sessions and review due dates', async () => {
    const src = await seeded();
    const text = serializeBackup(await exportBackup(src, T0 + 3 * DAY));
    const dst = fresh();
    const report = await importBackup(dst, text);
    expect(report.added).toEqual({ attempts: 3, lessonEvents: 1, sessions: 1, gameJournal: 0, repertoire: 0, games: 0 });
    expect(await dst.attempts.orderBy('uuid').toArray()).toEqual(await src.attempts.orderBy('uuid').toArray());
    expect(await dst.lessonEvents.toArray()).toEqual(await src.lessonEvents.toArray());
    expect(await dst.sessions.toArray()).toEqual(await src.sessions.toArray());
    expect(await dst.reviewStates.toArray()).toEqual(await src.reviewStates.toArray());
  });

  it('manifest carries schema version, counts and per-table hashes', async () => {
    const b = await exportBackup(await seeded(), T0);
    expect(b.manifest.format).toBe('chess-trainer-backup');
    expect(b.manifest.schemaVersion).toBe(4);
    expect(b.manifest.itemCounts).toEqual({ attempts: 3, lessonEvents: 1, sessions: 1, gameJournal: 0, repertoire: 0, games: 0, settings: 0 });
    expect(b.manifest.contentHashes.attempts).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('importing the same backup twice adds nothing the second time', async () => {
    const text = serializeBackup(await exportBackup(await seeded(), T0));
    const dst = fresh();
    await importBackup(dst, text);
    const again = await importBackup(dst, text);
    expect(again.added).toEqual({ attempts: 0, lessonEvents: 0, sessions: 0, gameJournal: 0, repertoire: 0, games: 0 });
    expect(await dst.attempts.count()).toBe(3);
  });

  it('merges into existing history without deleting it', async () => {
    const text = serializeBackup(await exportBackup(await seeded(), T0));
    const dst = fresh();
    const own = await recordAttempt(dst, draft({ exerciseId: 'lichess:z', outcome: 'fail' }));
    await importBackup(dst, text);
    expect(await dst.attempts.count()).toBe(4);
    expect(await dst.attempts.get(own.uuid)).toEqual(own);
    expect((await dst.reviewStates.toArray()).map((s) => s.itemId).sort()).toEqual(['lichess:a', 'lichess:z']);
  });

  it.each([
    ['not JSON', () => 'PK\u0003\u0004 not json'],
    ['wrong format', (t: string) => t.replace('chess-trainer-backup', 'something-else')],
    ['tampered row (hash mismatch)', (t: string) => t.replace('"outcome":"fail"', '"outcome":"success"')],
    ['truncated', (t: string) => t.slice(0, t.length / 2)],
    ['future schema', (t: string) => t.replace('"schemaVersion":4', '"schemaVersion":99')],
  ])('rejects a corrupted backup (%s) and leaves existing data untouched', async (_label, corrupt) => {
    const text = corrupt(serializeBackup(await exportBackup(await seeded(), T0)));
    const dst = fresh();
    const own = await recordAttempt(dst, draft({ exerciseId: 'lichess:z' }));
    await expect(importBackup(dst, text)).rejects.toThrow();
    expect(await dst.attempts.toArray()).toEqual([own]);
    expect(await dst.sessions.count()).toBe(0);
  });

  it('parseBackup reports a readable reason', async () => {
    await expect(parseBackup('{}')).rejects.toThrow(/not a Chess Trainer backup/i);
  });
});

describe('schema', () => {
  it('table and index definitions are frozen (change = new version + a case in migration.test.ts)', async () => {
    const db = fresh();
    await db.open();
    expect(db.verno).toBe(4);
    const shape = Object.fromEntries(db.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')]));
    expect(shape).toEqual({
      meta: 'key',
      packs: 'id',
      puzzles: 'id, packId, rating, *themes',
      attempts: 'uuid, exerciseId, ts, conceptId, sessionId',
      lessonEvents: 'uuid, conceptId, ts',
      reviewStates: 'itemId, due',
      sessions: 'id, date',
      gameJournal: 'id, ts',
      repertoire: 'id, side, positionKey',
      games: 'id, endDate, timeClass',
    });
  });
});

describe('preferences travel with a backup', () => {
  it('carries the choices the learner made, not device bookkeeping, and never overwrites a choice already made here', async () => {
    const a = fresh();
    await setMeta(a, 'openings.band', 2);
    await setMeta(a, 'openings.side', 'black');
    await setMeta(a, 'chesscom.username', 'someone');
    await setMeta(a, 'lessonProgress:lasker-pins@1', 3);
    await setMeta(a, 'chesscom.etags', { x: 'y' });
    await setMeta(a, 'lastBackupAt', 5);
    const file = await exportBackup(a, T0);
    expect(file.data.settings!.map((r) => r.key).sort()).toEqual(['chesscom.username', 'lessonProgress:lasker-pins@1', 'openings.band', 'openings.side']);

    const b = fresh();
    await setMeta(b, 'openings.side', 'white'); // already chosen on this device
    const myDevice = await getDeviceId(b);
    await importBackup(b, serializeBackup(file));
    expect(await getMeta(b, 'openings.band')).toBe(2);
    expect(await getMeta(b, 'chesscom.username')).toBe('someone');
    expect(await getMeta(b, 'lessonProgress:lasker-pins@1')).toBe(3);
    expect(await getMeta(b, 'openings.side')).toBe('white');
    expect(await getMeta(b, 'chesscom.etags')).toBeUndefined();
    expect(await getDeviceId(b)).toBe(myDevice);
  });

  it('a file without preferences (every earlier backup) still restores, and a damaged preferences section is refused', async () => {
    const a = fresh();
    await setMeta(a, 'openings.band', 2);
    const file = await exportBackup(a, T0);
    const { settings: _drop, ...rest } = file.data;
    void _drop;
    const older = { manifest: { ...file.manifest, itemCounts: { ...file.manifest.itemCounts }, contentHashes: { ...file.manifest.contentHashes } }, data: rest };
    delete (older.manifest.itemCounts as Record<string, unknown>).settings;
    delete (older.manifest.contentHashes as Record<string, unknown>).settings;
    await expect(importBackup(fresh(), JSON.stringify(older))).resolves.toBeTruthy();
    const tampered = { ...file, data: { ...file.data, settings: [{ key: 'openings.band', value: 9 }] } };
    await expect(parseBackup(JSON.stringify(tampered))).rejects.toThrow(/checksum/);
  });
});

describe('a change of review policy reaches history recorded before it', () => {
  it('states are rebuilt once from the attempt log; attempts are untouched', async () => {
    const db = fresh();
    // A lesson example found first time: under the old policy it sat in the queue.
    const a = await recordAttempt(db, draft({ exerciseId: 'lesson:x:1', exerciseKind: 'lesson-try', outcome: 'success', ts: T0 }));
    await db.reviewStates.put({ itemId: 'lesson:x:1', algo: 'review-v1/old', due: T0 + DAY, lastAttemptUuid: a.uuid, card: { due: T0 + DAY, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: T0 } });
    await recordAttempt(db, draft({ exerciseId: 'lichess:missed', outcome: 'fail', ts: T0 }));
    expect(await ensureReviewPolicy(db)).toBe(true);
    expect((await db.reviewStates.toArray()).map((s) => s.itemId)).toEqual(['lichess:missed']);
    expect(await db.attempts.count()).toBe(2);
    expect(await ensureReviewPolicy(db)).toBe(false); // only once
  });
});

