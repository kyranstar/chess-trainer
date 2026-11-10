/** React bindings for the local database: live queries plus the derived learner state. */
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CONCEPTS } from '../content';
import type { TrainerDB } from '../db/db';
import { packStatus, type PackStatus } from '../db/pack';
import type { Attempt, GameJournalEntry, LessonEvent, ReviewState, SessionRecord } from '../db/types';
import { conceptStatuses, type ConceptStatus } from '../learn/curriculum';
import { estimateLevel } from '../metrics/metrics';
import type { Puzzle } from '../puzzles/types';
import { dueItems } from '../schedule/review';
import { localDate } from '../schedule/session';

export const DbContext = createContext<TrainerDB | null>(null);

export function useDb(): TrainerDB {
  const db = useContext(DbContext);
  if (!db) throw new Error('Database context missing');
  return db;
}

export interface Learner {
  ready: boolean;
  attempts: Attempt[];
  events: LessonEvent[];
  reviews: ReviewState[];
  statuses: ConceptStatus[];
  level: { level: number; n: number };
  /** Puzzle ids the learner has ever been shown. */
  seen: Set<string>;
}

export function useLearner(): Learner {
  const db = useDb();
  const attempts = useLiveQuery(() => db.attempts.orderBy('ts').toArray(), [db]);
  const events = useLiveQuery(() => db.lessonEvents.orderBy('ts').toArray(), [db]);
  const reviews = useLiveQuery(() => db.reviewStates.toArray(), [db]);
  return useMemo(() => {
    const a = attempts ?? [];
    const e = events ?? [];
    return {
      ready: !!attempts && !!events && !!reviews,
      attempts: a,
      events: e,
      reviews: reviews ?? [],
      statuses: conceptStatuses(CONCEPTS, e, a),
      level: estimateLevel(a),
      seen: new Set(a.filter((x) => x.exerciseKind === 'puzzle').map((x) => x.exerciseId.replace(/^lichess:/, ''))),
    };
  }, [attempts, events, reviews]);
}

export function useDueReviews(reviews: ReviewState[], now: number): ReviewState[] {
  return useMemo(() => dueItems(reviews, now), [reviews, now]);
}

export function useTodaySession(): SessionRecord | null | undefined {
  const db = useDb();
  const date = localDate(Date.now());
  return useLiveQuery(async () => (await db.sessions.where('date').equals(date).last()) ?? null, [db, date]);
}

export function usePack(): PackStatus | undefined {
  const db = useDb();
  return useLiveQuery(() => packStatus(db), [db]);
}

let poolCache: { key: string; puzzles: Puzzle[]; byId: Map<string, Puzzle> } | null = null;

/** All installed puzzles, loaded once per pack version and kept in memory. */
export function usePool(): { puzzles: Puzzle[]; byId: Map<string, Puzzle>; version: string } | null {
  const db = useDb();
  const pack = usePack();
  const key = pack?.manifest ? `${pack.manifest.id}@${pack.manifest.version}` : '';
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || poolCache?.key === key) return;
    let live = true;
    void db.puzzles.toArray().then((rows) => {
      if (!live) return;
      poolCache = { key, puzzles: rows, byId: new Map(rows.map((p) => [p.id, p])) };
      bump((x) => x + 1);
    });
    return () => {
      live = false;
    };
  }, [db, key]);
  if (!key || poolCache?.key !== key) return null;
  return { puzzles: poolCache.puzzles, byId: poolCache.byId, version: key };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** A clock that ticks once a minute, for "due now" calculations. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

let focusCount = 0;
/** While a board task is on screen the tab bar is hidden so the board gets the room. */
export function useFocusMode(): void {
  useEffect(() => {
    focusCount++;
    document.documentElement.classList.add('focus-mode');
    return () => {
      focusCount--;
      if (focusCount === 0) document.documentElement.classList.remove('focus-mode');
    };
  }, []);
}

/** Sessions from the last two weeks, oldest first (for the study/play suggestion). */
export function useRecentSessions(): SessionRecord[] {
  const db = useDb();
  const from = localDate(Date.now() - 14 * 86_400_000);
  return useLiveQuery(() => db.sessions.where('date').aboveOrEqual(from).sortBy('createdAt'), [db, from]) ?? [];
}

export function useJournal(): GameJournalEntry[] {
  const db = useDb();
  return useLiveQuery(() => db.gameJournal.orderBy('ts').reverse().toArray(), [db]) ?? [];
}
