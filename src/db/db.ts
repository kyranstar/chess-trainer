/**
 * Local-only storage (IndexedDB via Dexie).
 *
 * Two kinds of table:
 *  - user history (attempts, lessonEvents, sessions, meta): irreplaceable, append-only where
 *    noted, included in backups, never deleted by content or app updates;
 *  - replaceable content/derived data (packs, puzzles, reviewStates): can be rebuilt.
 *
 * Schema changes: add a new `this.version(n)` block below, never edit an old one, and add a
 * migration test that opens a database created with the previous schema.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { GameRecord } from '../games/types';
import type { RepertoireEntry } from '../openings/repertoire';
import { reviewKey, sameItemIds } from '../schedule/position';
import { applyAttempt, isDue, rebuildReviewStates, SCHEDULER_VERSION } from '../schedule/review';
import type { Attempt, AttemptDraft, GameJournalDraft, GameJournalEntry, LessonEvent, MetaRow, PackRow, PuzzleRow, ReviewState, SessionRecord } from './types';

export const DB_NAME = 'chess-trainer';
export const SCHEMA_VERSION = 4;

export class TrainerDB extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  packs!: EntityTable<PackRow, 'id'>;
  puzzles!: EntityTable<PuzzleRow, 'id'>;
  attempts!: EntityTable<Attempt, 'uuid'>;
  lessonEvents!: EntityTable<LessonEvent, 'uuid'>;
  reviewStates!: EntityTable<ReviewState, 'itemId'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  gameJournal!: EntityTable<GameJournalEntry, 'id'>;
  repertoire!: EntityTable<RepertoireEntry, 'id'>;
  games!: EntityTable<GameRecord, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
      packs: 'id',
      puzzles: 'id, packId, rating, *themes',
      attempts: 'uuid, exerciseId, ts, conceptId, sessionId',
      lessonEvents: 'uuid, conceptId, ts',
      reviewStates: 'itemId, due',
      sessions: 'id, date',
    });
    // v2 (M2): hand-logged games for play days. Additive only; no existing row is touched.
    this.version(2).stores({ gameJournal: 'id, ts' });
    // v3 (M3): the learner's own opening choices, one row per position. Additive only.
    this.version(3).stores({ repertoire: 'id, side, positionKey' });
    // v4 (M4): the learner's own games with engine analysis from the Mac pipeline. Additive only.
    this.version(4).stores({ games: 'id, endDate, timeClass' });
  }
}

export function openDb(name: string = DB_NAME): TrainerDB {
  return new TrainerDB(name);
}

export async function deleteDb(name: string): Promise<void> {
  await Dexie.delete(name);
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function tzOffsetMin(ts: number): number {
  return -new Date(ts).getTimezoneOffset();
}

export async function getMeta<T>(db: TrainerDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: TrainerDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Stable random id for this browser profile; created on first use. */
export async function getDeviceId(db: TrainerDB): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta<string>(db, 'deviceId');
    if (existing) return existing;
    const id = newUuid();
    await setMeta(db, 'deviceId', id);
    return id;
  });
}

/** Appends one immutable attempt and updates the derived review state atomically. */
export async function recordAttempt(db: TrainerDB, draft: AttemptDraft): Promise<Attempt> {
  const deviceId = await getDeviceId(db);
  return db.transaction('rw', db.attempts, db.reviewStates, async () => {
    // A position from his own games counts as seen whichever exercise showed it.
    const earlier = await db.attempts.where('exerciseId').anyOf(sameItemIds(draft.exerciseId)).toArray();
    // The gap is measured from the last time the position was actually answered; a showing
    // that was skipped or left is exposure, not practice.
    const last = earlier.filter((a) => a.outcome !== 'skipped').reduce<Attempt | undefined>((m, a) => (!m || a.ts > m.ts ? a : m), undefined);
    const state = await db.reviewStates.get(reviewKey(draft.exerciseId));
    const attempt: Attempt = {
      ...draft,
      uuid: newUuid(),
      deviceId,
      tzOffsetMin: tzOffsetMin(draft.ts),
      fresh: earlier.length === 0,
      scheduledReview: !!state && isDue(state, draft.ts),
      daysSinceLast: last ? Math.floor((draft.ts - last.ts) / 86_400_000) : null,
      schedulerVersion: SCHEDULER_VERSION,
    };
    await db.attempts.add(attempt);
    const next = applyAttempt(state, attempt);
    if (next) await db.reviewStates.put(next);
    return attempt;
  });
}

export async function recordLessonEvent(
  db: TrainerDB,
  e: Omit<LessonEvent, 'uuid' | 'deviceId' | 'tzOffsetMin'>,
): Promise<LessonEvent> {
  const event: LessonEvent = { ...e, uuid: newUuid(), deviceId: await getDeviceId(db), tzOffsetMin: tzOffsetMin(e.ts) };
  await db.lessonEvents.add(event);
  return event;
}

export async function saveSession(db: TrainerDB, s: SessionRecord): Promise<void> {
  await db.sessions.put(s);
}

/**
 * Changes a stored session by reading and writing it in one transaction. The screen's copy
 * of a session lags behind the database by a render, so two changes built from that copy
 * (a clock tick and a recorded attempt, say) would overwrite each other. A session that is
 * not stored is never created here.
 */
export async function updateSession(db: TrainerDB, id: string, change: (s: SessionRecord) => SessionRecord): Promise<void> {
  if (!id) return;
  await db.transaction('rw', db.sessions, async () => {
    const row = await db.sessions.get(id);
    if (row) await db.sessions.put(change(row));
  });
}

export async function saveJournalEntry(db: TrainerDB, draft: GameJournalDraft, id: string = newUuid()): Promise<GameJournalEntry> {
  const entry: GameJournalEntry = { ...draft, id, deviceId: await getDeviceId(db), tzOffsetMin: tzOffsetMin(draft.ts), updatedAt: Date.now() };
  await db.gameJournal.put(entry);
  return entry;
}

/** Recomputes every review state from the attempt log (after restore or a scheduler change). */
export async function rebuildReviews(db: TrainerDB): Promise<number> {
  return db.transaction('rw', db.attempts, db.reviewStates, async () => {
    const states = rebuildReviewStates(await db.attempts.toArray());
    await db.reviewStates.clear();
    await db.reviewStates.bulkPut([...states.values()]);
    return states.size;
  });
}

/**
 * Review states are derived from the attempt log by the current policy. When the policy has
 * changed since they were last built (what enters the queue, what graduates), they are built
 * again from the log, so an app update applies the new rules to old history too. Attempts are
 * never changed. Returns true if a rebuild happened.
 */
export async function ensureReviewPolicy(db: TrainerDB): Promise<boolean> {
  if ((await getMeta<string>(db, 'scheduler.version')) === SCHEDULER_VERSION) return false;
  await rebuildReviews(db);
  await setMeta(db, 'scheduler.version', SCHEDULER_VERSION);
  return true;
}

export type { Table };
