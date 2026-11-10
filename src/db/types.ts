import type { PackManifest, Puzzle } from '../puzzles/types';

/** Where in the product an attempt happened. */
export type AttemptContext = 'review' | 'apply' | 'test' | 'practice' | 'check' | 'lesson';
export type Outcome = 'success' | 'fail' | 'assisted' | 'skipped';
export type ExerciseKind = 'puzzle' | 'lesson-try';

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

export type BlockKind = 'review' | 'learn' | 'apply' | 'test';
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
