import type { PackManifest, Puzzle } from '../puzzles/types';

/** Where in the product an attempt happened. */
export type AttemptContext = 'review' | 'apply' | 'test' | 'practice' | 'check' | 'lesson' | 'diagnostic';
export type Outcome = 'success' | 'fail' | 'assisted' | 'skipped';
export type ExerciseKind = 'puzzle' | 'lesson-try' | 'opening' | 'own-game' | 'endgame' | 'sense';

/**
 * Immutable record of one presentation of one exercise. Never updated or deleted.
 *  - success : solved with no wrong move and no hint
 *  - fail    : first error was a wrong move
 *  - assisted: a hint or the solution was shown before the outcome was decided
 *  - skipped : left before any move; excluded from every accuracy denominator
 */
export interface Attempt {
  uuid: string;
  deviceId: string;
  sessionId: string | null;
  context: AttemptContext;
  exerciseId: string; // "lichess:<id>" | "lesson:<lessonId>:<step>"
  exerciseKind: ExerciseKind;
  contentVersion: string; // "<packId>@<version>" | "<lessonId>@<revision>"
  conceptId: string | null; // concept the task was scheduled under, if any
  themes: string[];
  rating: number | null;
  ts: number; // UTC ms when the outcome was decided
  tzOffsetMin: number; // local offset at the time, minutes east of UTC
  elapsedMs: number;
  firstMove: string | null;
  played: string[];
  mistakes: number;
  hints: number;
  outcome: Outcome;
  acceptedAlternative: boolean;
  /**
   * Opening recall only: when the move played was not the repertoire move, what the engine
   * evidence says about it. A sound alternative is recorded as such, not as a blunder.
   */
  altVerdict?: 'sound' | 'weaker' | 'unknown';
  /** No earlier attempt at this exercise existed on this device. */
  fresh: boolean;
  /** The exercise was in the spaced-review queue and due when shown. */
  scheduledReview: boolean;
  /** Days since the previous attempt at this exercise (null when fresh). */
  daysSinceLast: number | null;
  schedulerVersion: string;
}

export type AttemptDraft = Omit<Attempt, 'uuid' | 'deviceId' | 'fresh' | 'scheduledReview' | 'daysSinceLast' | 'schedulerVersion' | 'tzOffsetMin'>;

export type LessonEventType =
  | 'local-started'
  | 'local-completed'
  | 'link-opened' // NOT completion evidence
  | 'link-marked-done' // the learner says they finished the external lesson
  | 'check-passed'
  | 'check-failed';

export interface LessonEvent {
  uuid: string;
  deviceId: string;
  ts: number;
  tzOffsetMin: number;
  conceptId: string;
  lessonId: string | null; // local lesson id
  url: string | null; // external link
  type: LessonEventType;
  detail?: { correct: number; total: number; attemptUuids: string[]; rubric: string };
}

/** Derived, rebuildable from attempts (see schedule/review.ts). */
export interface ReviewState {
  itemId: string;
  algo: string;
  due: number;
  card: SerializedCard;
  lastAttemptUuid: string;
  /**
   * Out of active review: 'graduated' after a successful recall two weeks or more later,
   * 'set-aside' after repeated misses. The history is kept; a later miss of a graduated item
   * brings it back.
   */
  retired?: 'graduated' | 'set-aside';
}

export interface SerializedCard {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export type StudyBlockKind = 'review' | 'learn' | 'apply' | 'test';
/** 'play' and 'reflect' belong to play-day sessions. */
export type BlockKind = StudyBlockKind | 'play' | 'reflect';
export type BlockStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface SessionBlock {
  kind: BlockKind;
  budgetSec: number;
  spentSec: number;
  status: BlockStatus;
  conceptId: string | null;
  /** Why this block has this content, shown to the learner. */
  reason: string;
  /** Honest note when planned content is unavailable (e.g. linked course while offline). */
  notice: string | null;
  attemptUuids: string[];
}

export interface SessionRecord {
  id: string;
  /** Absent on sessions written before play days existed; treat as 'study'. */
  kind?: 'study' | 'play';
  date: string; // local YYYY-MM-DD
  createdAt: number;
  updatedAt: number;
  budgetMin: number;
  plannerVersion: string;
  status: 'active' | 'done';
  blocks: SessionBlock[];
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface PackRow {
  id: string;
  manifest: PackManifest;
  installedAt: number;
}

export type PuzzleRow = Puzzle & { packId: string };

/** A game the learner played and logged by hand. Self-reported; nothing here is engine analysis. */
export interface GameJournalEntry {
  id: string;
  deviceId: string;
  ts: number;
  tzOffsetMin: number;
  updatedAt: number;
  sessionId: string | null;
  site: 'chess.com' | 'lichess' | 'over-the-board' | 'other';
  timeClass: 'rapid' | 'blitz' | 'daily' | 'other';
  timeControl: string;
  color: 'white' | 'black' | null;
  result: 'win' | 'draw' | 'loss' | null;
  /** Link to the game, pasted by the learner. Never fetched by the app. */
  url: string | null;
  /** The learner's own words. */
  turningPoint: string;
  nextTime: string;
  /** Rating shown by the site after the game, typed in by the learner. */
  ratingAfter: number | null;
}
export type GameJournalDraft = Omit<GameJournalEntry, 'id' | 'deviceId' | 'tzOffsetMin' | 'updatedAt'>;
