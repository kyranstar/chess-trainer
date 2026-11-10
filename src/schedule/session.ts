/**
 * Deterministic daily session planner (v1).
 *
 * A study day is four blocks in a fixed order: review 7, learn 9, apply 8, test 6 minutes
 * (scaled for other session lengths). Rules:
 *  - review is hard-capped at its budget no matter how large the backlog is;
 *  - the learn block is always reserved when a concept is ready, and is never replaced by
 *    review;
 *  - if the next concept only has online lessons and the device is offline, that is said
 *    plainly; an offline lesson is taught instead if one is ready, otherwise the minutes go
 *    to practice (never to substitute text);
 *  - unused minutes flow forward (review -> test, learn -> apply).
 */
import type { BlockKind, SessionBlock, SessionRecord } from '../db/types';
import { awaitingCheck, type ConceptStatus, nextToLearn } from '../learn/curriculum';

export const PLANNER_VERSION = 'planner-v1';
export const BLOCK_MINUTES: Record<BlockKind, number> = { review: 7, learn: 9, apply: 8, test: 6 };
export const SESSION_LENGTHS = [10, 20, 30, 45, 60] as const;
const ORDER: BlockKind[] = ['review', 'learn', 'apply', 'test'];

export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface PlanInput {
  id: string;
  now: number;
  budgetMin: number;
  statuses: ConceptStatus[];
  dueCount: number;
  online: boolean;
}

function budgets(totalMin: number): Record<BlockKind, number> {
  const total = totalMin * 60;
  const out = { review: 0, learn: 0, apply: 0, test: 0 };
  let used = 0;
  for (const k of ORDER.slice(0, 3)) {
    out[k] = Math.round((total * BLOCK_MINUTES[k]) / 30 / 30) * 30;
    used += out[k];
  }
  out.test = total - used;
  return out;
}

/** Concept to practise when there is nothing newly taught: fewest unseen observations first. */
function practiceFallback(statuses: ConceptStatus[]): ConceptStatus | null {
  const pool = statuses.filter((s) => s.assessable && s.concept.themes.length > 0 && s.prereqsMet);
  return pool.slice().sort((a, b) => a.evidence.n - b.evidence.n || a.concept.order - b.concept.order)[0] ?? null;
}

export function planSession(input: PlanInput): SessionRecord {
  const { statuses, dueCount, online, now } = input;
  const b = budgets(input.budgetMin);
  const block = (kind: BlockKind, over: Partial<SessionBlock>): SessionBlock => ({
    kind, budgetSec: b[kind], spentSec: 0, status: 'pending', conceptId: null, reason: '', notice: null, attemptUuids: [], ...over,
  });

  // Review
  let review: SessionBlock;
  if (dueCount > 0) {
    review = block('review', { reason: `${dueCount} position${dueCount === 1 ? '' : 's'} you missed before ${dueCount === 1 ? 'is' : 'are'} due again. Capped at ${Math.round(b.review / 60)} minutes.` });
  } else {
    b.test += b.review;
    b.review = 0;
    review = block('review', { budgetSec: 0, status: 'skipped', reason: 'Nothing is due for review today; the time moves to the mixed test.' });
  }

  // Learn
  const { pick, deferred } = nextToLearn(statuses, { online });
  const deferredNote = deferred ? `“${deferred.concept.title}” is next, but its lessons need a connection. It stays first in line for when you are online.` : null;
  let learn: SessionBlock;
  if (pick) {
    const why = pick.concept.prereqs.length ? 'its prerequisites are demonstrated' : 'it has no prerequisites';
    learn = block('learn', {
      conceptId: pick.concept.id,
      reason: `Next new concept in the curriculum (${why}).`,
      notice: deferredNote,
    });
  } else {
    b.apply += b.learn;
    b.learn = 0;
    learn = block('learn', {
      budgetSec: 0,
      status: 'skipped',
      reason: deferred ? 'New learning is deferred today.' : 'No new concept is ready: every concept with a lesson is studied or waiting on a prerequisite check.',
      notice: deferred ? `${deferredNote} The minutes go to practice instead.` : null,
    });
  }

  // Apply
  const waiting = awaitingCheck(statuses);
  const applyTarget =
    (pick?.assessable && pick.concept.themes.length ? pick : null) ?? waiting[waiting.length - 1] ?? practiceFallback(statuses);
  const apply = block('apply', {
    conceptId: applyTarget?.concept.id ?? null,
    reason: !applyTarget
      ? 'No concept with practice positions is available yet.'
      : applyTarget === pick
        ? 'New positions on the concept you just studied. Hints allowed; hinted solves are recorded as assisted.'
        : applyTarget.stage === 'taught'
          ? `“${applyTarget.concept.title}” was studied but not yet shown on unseen positions.`
          : `“${applyTarget.concept.title}” has the least evidence so far (${applyTarget.evidence.n} unseen positions).`,
  });

  const test = block('test', { budgetSec: b.test, reason: 'Unseen positions across concepts, no hints. This is what the accuracy numbers on Progress are built from.' });
  apply.budgetSec = b.apply;

  return {
    id: input.id,
    date: localDate(now),
    createdAt: now,
    updatedAt: now,
    budgetMin: input.budgetMin,
    plannerVersion: PLANNER_VERSION,
    status: 'active',
    blocks: [review, learn, apply, test],
  };
}

export function activeBlockIndex(s: SessionRecord): number {
  return s.blocks.findIndex((b) => b.status === 'pending' || b.status === 'active');
}

export function activeBlock(s: SessionRecord): SessionBlock | null {
  return s.blocks[activeBlockIndex(s)] ?? null;
}

function withBlock(s: SessionRecord, i: number, now: number, f: (b: SessionBlock) => SessionBlock): SessionRecord {
  const blocks = s.blocks.map((b, j) => (j === i ? f(b) : b));
  const done = blocks.every((b) => b.status === 'done' || b.status === 'skipped');
  return { ...s, blocks, updatedAt: now, status: done ? 'done' : 'active' };
}

/** Adds active time to a block. */
export function spend(s: SessionRecord, i: number, seconds: number, now: number): SessionRecord {
  return withBlock(s, i, now, (b) => ({ ...b, spentSec: b.spentSec + seconds, status: b.status === 'pending' ? 'active' : b.status }));
}

export function addAttempt(s: SessionRecord, i: number, uuid: string, now: number): SessionRecord {
  return withBlock(s, i, now, (b) => ({ ...b, attemptUuids: [...b.attemptUuids, uuid], status: b.status === 'pending' ? 'active' : b.status }));
}

export function completeBlock(s: SessionRecord, i: number, now: number, how: 'done' | 'skipped' = 'done'): SessionRecord {
  return withBlock(s, i, now, (b) => ({ ...b, status: how }));
}

export function secondsLeft(b: SessionBlock): number {
  return Math.max(0, b.budgetSec - b.spentSec);
}

/**
 * Which concept the next mixed-test position should come from: among assessable concepts
 * whose prerequisites are met (or that were studied), the one with the fewest unseen
 * observations, never the same concept twice in a row. Untested concepts therefore get
 * sampled first, which is how the baseline diagnostic fills in.
 */
export function pickTestConcept(statuses: ConceptStatus[], previousConceptId: string | null): ConceptStatus | null {
  const pool = statuses.filter((s) => s.assessable && s.concept.themes.length > 0 && (s.prereqsMet || s.stage !== 'new'));
  const ranked = pool.slice().sort((a, b) => a.evidence.n - b.evidence.n || a.concept.order - b.concept.order);
  return ranked.find((s) => s.concept.id !== previousConceptId) ?? ranked[0] ?? null;
}
