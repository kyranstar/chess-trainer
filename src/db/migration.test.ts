import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from './backup';
import { deleteDb, openDb, recordAttempt, saveJournalEntry, SCHEMA_VERSION } from './db';

/** The schema exactly as shipped in version 1 (M1). Never edit: it stands in for an old install. */
const V1_STORES = {
  meta: 'key',
  packs: 'id',
  puzzles: 'id, packId, rating, *themes',
  attempts: 'uuid, exerciseId, ts, conceptId, sessionId',
  lessonEvents: 'uuid, conceptId, ts',
  reviewStates: 'itemId, due',
  sessions: 'id, date',
};

const V1_ATTEMPT = {
  uuid: '11111111-1111-4111-8111-111111111111', deviceId: 'dev-1', sessionId: 's-old', context: 'test', exerciseId: 'lichess:00008',
  exerciseKind: 'puzzle', contentVersion: 'lichess-core@2026.11.10', conceptId: 'safety.hanging-pieces', themes: ['hangingPiece'], rating: 1819,
  ts: Date.UTC(2026, 10, 10, 12), tzOffsetMin: -300, elapsedMs: 5000, firstMove: 'h6f6', played: [], mistakes: 1, hints: 0, outcome: 'fail',
  acceptedAlternative: false, fresh: true, scheduledReview: false, daysSinceLast: null, schedulerVersion: 'review-v1/ts-fsrs-x',
};
const V1_SESSION = {
  id: 's-old', date: '2026-11-10', createdAt: 1, updatedAt: 2, budgetMin: 30, plannerVersion: 'planner-v1', status: 'done',
  blocks: [{ kind: 'review', budgetSec: 420, spentSec: 60, status: 'done', conceptId: null, reason: 'r', notice: null, attemptUuids: [] }],
};
/** A backup file written by version 1 (schemaVersion 1, three tables). */
const V1_BACKUP_SHAPE = (hashes: Record<string, string>) => ({
  manifest: {
    format: 'chess-trainer-backup', schemaVersion: 1, exporterVersion: '0.1.0', exportTime: '2026-11-10T12:00:00.000Z', deviceId: 'dev-1',
    itemCounts: { attempts: 1, lessonEvents: 0, sessions: 1 }, contentHashes: hashes,
  },
  data: { attempts: [V1_ATTEMPT], lessonEvents: [], sessions: [V1_SESSION] },
});

const names: string[] = [];
const name = () => {
  const n = `mig-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(n);
  return n;
};
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

async function createV1(n: string) {
  const old = new Dexie(n);
  old.version(1).stores(V1_STORES);
  await old.open();
  await old.table('meta').put({ key: 'deviceId', value: 'dev-1' });
  await old.table('attempts').add(V1_ATTEMPT);
  await old.table('sessions').add(V1_SESSION);
  await old.table('reviewStates').add({
    itemId: 'lichess:00008', algo: 'review-v1/ts-fsrs-x', due: V1_ATTEMPT.ts + 86_400_000, lastAttemptUuid: V1_ATTEMPT.uuid,
    card: { due: V1_ATTEMPT.ts + 86_400_000, stability: 0.4, difficulty: 7, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: V1_ATTEMPT.ts },
  });
  old.close();
}

describe('upgrade from schema 1', () => {
  it('opens a version-1 database, keeps every row, and adds the game journal', async () => {
    const n = name();
    await createV1(n);
    const db = openDb(n);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(await db.attempts.get(V1_ATTEMPT.uuid)).toEqual(V1_ATTEMPT);
    expect(await db.sessions.get('s-old')).toEqual(V1_SESSION);
    expect((await db.meta.get('deviceId'))?.value).toBe('dev-1');
    expect(await db.reviewStates.count()).toBe(1);
    expect(await db.gameJournal.count()).toBe(0);
  });

  it('new writes work after the upgrade and the old attempt still drives freshness', async () => {
    const n = name();
    await createV1(n);
    const db = openDb(n);
    const again = await recordAttempt(db, {
      sessionId: null, context: 'practice', exerciseId: 'lichess:00008', exerciseKind: 'puzzle', contentVersion: 'p@2', conceptId: null,
      themes: [], rating: 1819, ts: V1_ATTEMPT.ts + 86_400_000 * 3, elapsedMs: 1, firstMove: null, played: [], mistakes: 0, hints: 0,
      outcome: 'success', acceptedAlternative: false,
    });
    expect(again.fresh).toBe(false);
    expect(again.daysSinceLast).toBe(3);
    await saveJournalEntry(db, { timeClass: 'rapid', timeControl: '10+5', site: 'chess.com', color: 'white', result: 'win', url: null, turningPoint: '', nextTime: '', ratingAfter: 470, sessionId: null, ts: 5 });
    expect(await db.gameJournal.count()).toBe(1);
  });

  it('restores a backup file written by version 1', async () => {
    const src = openDb(name());
    await src.attempts.add(V1_ATTEMPT as never);
    await src.sessions.add(V1_SESSION as never);
    const current = await exportBackup(src, 1);
    const v1File = JSON.stringify(V1_BACKUP_SHAPE({
      attempts: current.manifest.contentHashes.attempts,
      lessonEvents: current.manifest.contentHashes.lessonEvents,
      sessions: current.manifest.contentHashes.sessions,
    }));
    const dst = openDb(name());
    const report = await importBackup(dst, v1File);
    expect(report.added.attempts).toBe(1);
    expect(report.added.gameJournal).toBe(0);
    expect(await dst.attempts.get(V1_ATTEMPT.uuid)).toEqual(V1_ATTEMPT);
  });

  it('current backups carry the journal and round-trip it', async () => {
    const src = openDb(name());
    const e = await saveJournalEntry(src, { timeClass: 'rapid', timeControl: '10+5', site: 'chess.com', color: 'black', result: 'loss', url: 'https://www.chess.com/game/live/1', turningPoint: 'move 14, left a knight hanging', nextTime: 'check what the last move attacks', ratingAfter: 449, sessionId: null, ts: 10 });
    const backup = await exportBackup(src, 20);
    expect(backup.manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.manifest.itemCounts.gameJournal).toBe(1);
    const dst = openDb(name());
    const report = await importBackup(dst, serializeBackup(backup));
    expect(report.added.gameJournal).toBe(1);
    expect(await dst.gameJournal.get(e.id)).toEqual(e);
    expect((await importBackup(dst, serializeBackup(backup))).added.gameJournal).toBe(0);
  });
});
