import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from './backup';
import { makeEntry, START_FEN } from '../openings/repertoire';
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
const V1_BACKUP_SHAPE = (hashes: Record<string, string | undefined>) => ({
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
    expect(backup.manifest.itemCounts.repertoire).toBe(0);
    const dst = openDb(name());
    const report = await importBackup(dst, serializeBackup(backup));
    expect(report.added.gameJournal).toBe(1);
    expect(await dst.gameJournal.get(e.id)).toEqual(e);
    expect((await importBackup(dst, serializeBackup(backup))).added.gameJournal).toBe(0);
  });
});

/** The schema as shipped in version 2 (M2). Never edit. */
const V2_STORES = { ...V1_STORES, gameJournal: 'id, ts' };
const V2_JOURNAL = {
  id: 'g-1', deviceId: 'dev-1', ts: 10, tzOffsetMin: -300, updatedAt: 11, sessionId: null, site: 'chess.com', timeClass: 'rapid',
  timeControl: '10+5', color: 'black', result: 'loss', url: null, turningPoint: 'move 14', nextTime: 'slow down', ratingAfter: 449,
};

describe('upgrade from schema 2', () => {
  it('keeps attempts and the game journal and adds the repertoire', async () => {
    const n = name();
    const old = new Dexie(n);
    old.version(1).stores(V1_STORES);
    old.version(2).stores({ gameJournal: V2_STORES.gameJournal });
    await old.open();
    await old.table('attempts').add(V1_ATTEMPT);
    await old.table('gameJournal').add(V2_JOURNAL);
    old.close();
    const db = openDb(n);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(await db.attempts.get(V1_ATTEMPT.uuid)).toEqual(V1_ATTEMPT);
    expect(await db.gameJournal.get('g-1')).toEqual(V2_JOURNAL);
    await db.repertoire.put(makeEntry('white', START_FEN, [], 'e2e4', 5));
    expect(await db.repertoire.count()).toBe(1);
  });

  it('restores a schema-2 backup (no repertoire table) and round-trips the repertoire in current backups', async () => {
    const src = openDb(name());
    await src.gameJournal.add(V2_JOURNAL as never);
    const current = await exportBackup(src, 1);
    const { repertoire: _c, ...counts } = current.manifest.itemCounts;
    const { repertoire: _h, ...hashes } = current.manifest.contentHashes;
    const { repertoire: _d, ...data } = current.data;
    const v2File = JSON.stringify({ manifest: { ...current.manifest, schemaVersion: 2, itemCounts: counts, contentHashes: hashes }, data });
    const dst = openDb(name());
    const report = await importBackup(dst, v2File);
    expect(report.added.gameJournal).toBe(1);
    expect(report.added.repertoire).toBe(0);

    const e = makeEntry('white', START_FEN, [], 'e2e4', 5);
    await src.repertoire.put(e);
    const withRep = await importBackup(dst, serializeBackup(await exportBackup(src, 2)));
    expect(withRep.added.repertoire).toBe(1);
    expect(await dst.repertoire.get(e.id)).toEqual(e);
    // An older copy of the same entry never overwrites a newer local choice.
    await dst.repertoire.put({ ...e, uci: 'd2d4', san: 'd4', updatedAt: 99 });
    await importBackup(dst, serializeBackup(await exportBackup(src, 3)));
    expect((await dst.repertoire.get(e.id))!.uci).toBe('d2d4');
  });

  it('a current file that lacks a required table is rejected as damaged', async () => {
    const src = openDb(name());
    const b = await exportBackup(src, 1);
    const { repertoire: _d, ...data } = b.data;
    await expect(importBackup(openDb(name()), JSON.stringify({ manifest: b.manifest, data }))).rejects.toThrow(/missing the "repertoire" table/);
  });
});

/** The schema as shipped in version 3 (M3). Never edit. */
describe('upgrade from schema 3', () => {
  it('keeps the repertoire and adds the games table; schema-3 backups still restore', async () => {
    const n = name();
    const old = new Dexie(n);
    old.version(1).stores(V1_STORES);
    old.version(2).stores({ gameJournal: 'id, ts' });
    old.version(3).stores({ repertoire: 'id, side, positionKey' });
    await old.open();
    const e = makeEntry('white', START_FEN, [], 'e2e4', 5);
    await old.table('repertoire').add(e);
    await old.table('attempts').add(V1_ATTEMPT);
    old.close();
    const db = openDb(n);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(await db.repertoire.get(e.id)).toEqual(e);
    expect(await db.attempts.count()).toBe(1);
    expect(await db.games.count()).toBe(0);

    const current = await exportBackup(db, 1);
    const { games: _c, ...counts } = current.manifest.itemCounts;
    const { games: _h, ...hashes } = current.manifest.contentHashes;
    const { games: _g, ...data } = current.data;
    const v3File = JSON.stringify({ manifest: { ...current.manifest, schemaVersion: 3, itemCounts: counts, contentHashes: hashes }, data });
    const report = await importBackup(openDb(name()), v3File);
    expect(report.added).toMatchObject({ attempts: 1, repertoire: 1, games: 0 });
  });
});
