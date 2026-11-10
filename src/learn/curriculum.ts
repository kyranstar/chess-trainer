/**
 * Curriculum state, derived from lesson events and attempts (nothing is stored).
 *
 *   new -> started -> taught -> demonstrated
 *
 *  - "taught" means a local lesson was finished, or the learner SAID they finished a linked
 *    lesson. Opening a link proves nothing.
 *  - "demonstrated" requires passing an independent check on unseen positions. Passing it
 *    without a lesson is a pre-test skip.
 *  - Evidence (unseen accuracy on the concept's themes) is reported separately from the
 *    stage, and "untested" is never shown as weak.
 */
import { conceptOpenings, conceptThemes, hasAssessment } from '../content';
import type { Concept } from '../content/types';
import type { Attempt, LessonEvent } from '../db/types';
import { type Band, endgameAccuracy, PROVISIONAL_N, unseenAccuracy, type UnseenAccuracy } from '../metrics/metrics';

/** Check for concepts assessed by exact endgame play-outs instead of puzzles. */
export const KPK_CHECK = {
  size: 5,
  pass: 4,
  rubric: 'check-kpk-v1: 5 unseen king-and-pawn starts (3 to win, 2 to hold) against perfect play; a start counts only if every move kept the theoretical result with no help; pass = 4 or more',
};

export const CHECK = {
  size: 5,
  pass: 4,
  band: { lo: 900, hi: 1300 } as Band,
  rubric: 'check-v1: 5 unseen puzzles on the concept, Lichess rating 900–1299, no hints; pass = 4 or more solved first try',
};

/**
 * A passed check is asked again after this many days. One 4-of-5 result on the day (or the
 * day after) a lesson says little about what is still there weeks later.
 */
export const REFRESH_AFTER_DAYS = 21;
/** A first check needs a night in between, not just a new date: a lesson at 23:55 is not checked at 00:05. */
export const MIN_CHECK_DELAY_MS = 6 * 3_600_000;

export type Stage = 'new' | 'started' | 'taught' | 'demonstrated';

export interface ConceptStatus {
  concept: Concept;
  stage: Stage;
  taughtVia: 'local-lesson' | 'self-reported-link' | null;
  /** When the lesson was first finished (or reported finished). */
  taughtAt: number | null;
  demonstratedVia: 'check' | 'pretest' | null;
  lastCheck: { passed: boolean; ts: number; correct: number | null; total: number | null } | null;
  prereqsMet: boolean;
  unmetPrereqs: string[];
  assessable: boolean;
  /** Has a lesson that works with no connection. */
  offlineLesson: boolean;
  hasAnyLesson: boolean;
  evidence: UnseenAccuracy;
  evidenceState: 'untested' | 'provisional' | 'measured';
}

export function evidenceFor(concept: Concept, attempts: Attempt[]): UnseenAccuracy {
  const themes = conceptThemes(concept);
  if (themes.length) return unseenAccuracy(attempts, { themes });
  if (conceptOpenings(concept).length) return unseenAccuracy(attempts, { conceptId: concept.id });
  if (concept.assessment.kind === 'kpk-playout') return { ...endgameAccuracy(attempts), excluded: { repeats: 0, skipped: 0, guided: 0 } };
  return unseenAccuracy([]);
}

export function conceptStatuses(concepts: Concept[], events: LessonEvent[], attempts: Attempt[]): ConceptStatus[] {
  const byConcept = new Map<string, LessonEvent[]>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    const list = byConcept.get(e.conceptId) ?? [];
    list.push(e);
    byConcept.set(e.conceptId, list);
  }
  const partial = new Map<string, ConceptStatus>();
  for (const concept of concepts) {
    const evs = byConcept.get(concept.id) ?? [];
    const local = evs.some((e) => e.type === 'local-completed');
    const linked = evs.some((e) => e.type === 'link-marked-done');
    const checks = evs.filter((e) => e.type === 'check-passed' || e.type === 'check-failed');
    const passed = checks.find((e) => e.type === 'check-passed');
    const last = checks[checks.length - 1];
    const taughtBefore = passed ? evs.some((e) => (e.type === 'local-completed' || e.type === 'link-marked-done') && e.ts <= passed.ts) : false;
    const evidence = evidenceFor(concept, attempts);
    const taughtEvent = evs.find((e) => e.type === 'local-completed' || e.type === 'link-marked-done');
    partial.set(concept.id, {
      concept,
      stage: passed ? 'demonstrated' : local || linked ? 'taught' : evs.length ? 'started' : 'new',
      taughtVia: local ? 'local-lesson' : linked ? 'self-reported-link' : null,
      taughtAt: taughtEvent?.ts ?? null,
      demonstratedVia: passed ? (taughtBefore ? 'check' : 'pretest') : null,
      lastCheck: last ? { passed: last.type === 'check-passed', ts: last.ts, correct: last.detail?.correct ?? null, total: last.detail?.total ?? null } : null,
      prereqsMet: true,
      unmetPrereqs: [],
      assessable: hasAssessment(concept),
      offlineLesson: concept.localLessons.length > 0,
      hasAnyLesson: concept.localLessons.length > 0 || concept.links.length > 0,
      evidence,
      evidenceState: evidence.n === 0 ? 'untested' : evidence.n < PROVISIONAL_N ? 'provisional' : 'measured',
    });
  }
  for (const s of partial.values()) {
    s.unmetPrereqs = s.concept.prereqs.filter((p) => {
      const ps = partial.get(p);
      if (!ps) return false;
      // A prerequisite with no assessment yet cannot be demonstrated; having studied it is enough.
      return ps.assessable ? ps.stage !== 'demonstrated' : ps.stage !== 'taught';
    });
    s.prereqsMet = s.unmetPrereqs.length === 0;
  }
  return concepts.map((c) => partial.get(c.id)!);
}

export function gradeCheck(attempts: Attempt[]): { complete: boolean; passed: boolean; correct: number; total: number } {
  const decided = attempts.filter((a) => a.outcome !== 'skipped');
  const correct = decided.filter((a) => a.outcome === 'success').length;
  const complete = decided.length >= CHECK.size;
  return { complete, passed: complete && correct >= CHECK.pass, correct, total: decided.length };
}

/**
 * The next concept for the protected new-learning block: first in curriculum order that is
 * not yet taught, has its prerequisites met and has a lesson. Offline, link-only concepts
 * are passed over and the first one is reported as `deferred` so the UI can say so.
 */
export function nextToLearn(statuses: ConceptStatus[], opts: { online: boolean }): { pick: ConceptStatus | null; deferred: ConceptStatus | null } {
  let deferred: ConceptStatus | null = null;
  for (const s of statuses) {
    if (s.stage === 'taught' || s.stage === 'demonstrated') continue;
    if (!s.prereqsMet || !s.hasAnyLesson) continue;
    if (s.offlineLesson || opts.online) return { pick: s, deferred };
    deferred ??= s;
  }
  return { pick: null, deferred };
}

const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * A demonstrated concept whose evidence has gone stale: the last check was passed more than
 * REFRESH_AFTER_DAYS ago, or a later re-check was not passed. It still unlocks what depends
 * on it (taking that away would lock lessons already begun); it is flagged and re-checked.
 */
export function needsRefresh(s: ConceptStatus, now: number): boolean {
  if (s.stage !== 'demonstrated' || !s.assessable || !s.lastCheck) return false;
  return !s.lastCheck.passed || now - s.lastCheck.ts >= REFRESH_AFTER_DAYS * 86_400_000;
}

/**
 * The check to give inside today's session, if any.
 *  - A first check is never given on the day the lesson was studied, and the concept that
 *    has waited longest goes first.
 *  - Otherwise a demonstrated concept that needs a refresh is re-checked.
 *  - No concept is checked twice on one day.
 */
export function checkForSession(statuses: ConceptStatus[], now: number): { concept: Concept; why: 'first' | 'refresh' } | null {
  const notToday = (s: ConceptStatus) => !s.lastCheck || !sameLocalDay(s.lastCheck.ts, now);
  const first = statuses
    .filter((s) => s.stage === 'taught' && s.assessable && s.taughtAt !== null && now - s.taughtAt >= MIN_CHECK_DELAY_MS && !sameLocalDay(s.taughtAt, now) && notToday(s))
    .sort((a, b) => a.taughtAt! - b.taughtAt! || a.concept.order - b.concept.order)[0];
  if (first) return { concept: first.concept, why: 'first' };
  const stale = statuses
    .filter((s) => needsRefresh(s, now) && notToday(s))
    .sort((a, b) => a.lastCheck!.ts - b.lastCheck!.ts || a.concept.order - b.concept.order)[0];
  return stale ? { concept: stale.concept, why: 'refresh' } : null;
}

/** Concepts that were taught but not yet shown on unseen positions, in curriculum order. */
export function awaitingCheck(statuses: ConceptStatus[]): ConceptStatus[] {
  return statuses.filter((s) => s.stage === 'taught' && s.assessable);
}
