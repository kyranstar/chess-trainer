/**
 * Spaced review of exercises the learner has already seen, using FSRS (ts-fsrs).
 *
 * Review state is DERIVED: it is a pure fold over the immutable attempt log, so it can be
 * rebuilt at any time (after restore, or after a scheduler version change) without
 * touching history. Review results never feed the "unseen" accuracy metric.
 *
 * Policy v1:
 *  - puzzles enter the queue on their first non-success (fail or assisted);
 *  - lesson examples always enter the queue;
 *  - success -> Good; fail or assisted -> Again; skipped -> no change;
 *  - no same-day learning steps: an item is never due again on the day it was seen, so a
 *    review always tests recall after at least one night, not short-term rehearsal.
 */
import { type Card, createEmptyCard, fsrs, FSRSVersion, generatorParameters, type Grade, Rating } from 'ts-fsrs';
import type { Attempt, ReviewState, SerializedCard } from '../db/types';

export const SCHEDULER_VERSION = `review-v1/ts-fsrs-${FSRSVersion}`;

const scheduler = fsrs(
  generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: false, enable_short_term: false }),
);

function serialize(card: Card): SerializedCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

function deserialize(c: SerializedCard): Card {
  return {
    ...c,
    due: new Date(c.due),
    last_review: c.last_review === null ? undefined : new Date(c.last_review),
  };
}

function gradeOf(a: Attempt): Grade | null {
  if (a.outcome === 'skipped') return null;
  return a.outcome === 'success' ? Rating.Good : Rating.Again;
}

export function applyAttempt(state: ReviewState | undefined, a: Attempt): ReviewState | undefined {
  const grade = gradeOf(a);
  if (grade === null) return state;
  if (!state && a.exerciseKind === 'puzzle' && a.outcome === 'success') return undefined;
  const now = new Date(a.ts);
  const card = state ? deserialize(state.card) : createEmptyCard(now);
  const next = scheduler.next(card, now, grade).card;
  return { itemId: a.exerciseId, algo: SCHEDULER_VERSION, due: next.due.getTime(), card: serialize(next), lastAttemptUuid: a.uuid };
}

/** Rebuilds every review state from the log. Order of the input does not matter. */
export function rebuildReviewStates(attempts: Attempt[]): Map<string, ReviewState> {
  const sorted = [...attempts].sort((x, y) => x.ts - y.ts || (x.uuid < y.uuid ? -1 : x.uuid > y.uuid ? 1 : 0));
  const out = new Map<string, ReviewState>();
  for (const a of sorted) {
    const next = applyAttempt(out.get(a.exerciseId), a);
    if (next) out.set(a.exerciseId, next);
  }
  return out;
}

export function dueItems(states: ReviewState[], now: number): ReviewState[] {
  return states.filter((s) => s.due <= now).sort((a, b) => a.due - b.due || (a.itemId < b.itemId ? -1 : 1));
}

/** FSRS's predicted probability of recall for an item at `now` (0..1). */
export function predictedRecall(state: ReviewState, now: number): number {
  return scheduler.get_retrievability(deserialize(state.card), new Date(now), false);
}
