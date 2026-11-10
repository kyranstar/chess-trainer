import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, parseBackup, serializeBackup } from './backup';
import { deleteDb, getDeviceId, openDb, recordAttempt, recordLessonEvent, saveSession, type TrainerDB } from './db';
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
    expect(report.added).toEqual({ attempts: 3, lessonEvents: 1, sessions: 1, gameJournal: 0 });
    expect(await dst.attempts.orderBy('uuid').toArray()).toEqual(await src.attempts.orderBy('uuid').toArray());
    expect(await dst.lessonEvents.toArray()).toEqual(await src.lessonEvents.toArray());
    expect(await dst.sessions.toArray()).toEqual(await src.sessions.toArray());
    expect(await dst.reviewStates.toArray()).toEqual(await src.reviewStates.toArray());
  });

  it('manifest carries schema version, counts and per-table hashes', async () => {
    const b = await exportBackup(await seeded(), T0);
    expect(b.manifest.format).toBe('chess-trainer-backup');
    expect(b.manifest.schemaVersion).toBe(2);
    expect(b.manifest.itemCounts).toEqual({ attempts: 3, lessonEvents: 1, sessions: 1, gameJournal: 0 });
    expect(b.manifest.contentHashes.attempts).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('importing the same backup twice adds nothing the second time', async () => {
    const text = serializeBackup(await exportBackup(await seeded(), T0));
    const dst = fresh();
    await importBackup(dst, text);
    const again = await importBackup(dst, text);
    expect(again.added).toEqual({ attempts: 0, lessonEvents: 0, sessions: 0, gameJournal: 0 });
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
    ['future schema', (t: string) => t.replace('"schemaVersion":2', '"schemaVersion":99')],
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
    expect(db.verno).toBe(2);
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
    });
  });
});
