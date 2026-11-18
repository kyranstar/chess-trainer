/**
 * "Your move" on the clock: a fixed, gentle allowance on some positions, none on the rest.
 *
 * The first version was a ladder that tightened the clock after ten passes in twelve. The
 * outside reviewer showed why that was wrong: ten of twelve is far too noisy to show that
 * accuracy is reliable (a player who passes 70% of the time gets there one block in four),
 * unrated moves dropped out of the count, and "pace reached" became a speed achievement in
 * all but name. What the learner's games show is not that he is short of time but that most
 * of his errors come with time in hand; whether a clock makes his moves worse is not known.
 *
 * So the clock is used to find that out and to practise under it, without pushing:
 *   - about one position in three is played with TIMED_SECONDS for choosing the move, fixed
 *     by the position's id, so comparable positions fall into both conditions by chance;
 *   - running over never forces a move and never changes its rating: the move is still
 *     played and rated, and "late" is stored beside the rating, not instead of it;
 *   - the two conditions are counted apart, first looks only. The allowance changes only by
 *     a deliberate decision, which starts a new series.
 *
 * Series 2 (17 November 2026, ADR-057, owner request): the clock is announced. A timed
 * position opens covered, with "On the clock" over it, and the clock starts when the board
 * appears; it then runs as a bar and a figure under the board, red for the last seconds;
 * when it runs out the flag has fallen. Which positions are timed, the allowance, and the
 * rule that running over never forces a move or changes its rating are unchanged. A clock
 * that is felt is a different condition from a line of small text, so answers from here on
 * carry `clock:2` and are compared only with each other.
 */
import type { Attempt } from '../db/types';
import { wilson } from '../metrics/metrics';

/** Seconds for choosing the move on a timed position. */
export const TIMED_SECONDS = 30;
/** How the clock is shown: 1 a line of text under the board, 2 announced and running in sight. */
export const CLOCK_SERIES = 2;
/** The day series 2 began, for the sentence in Progress. */
export const CLOCK_SERIES_FROM = '17 November';
/** How long a timed position stays covered while it is announced; the clock starts after it. */
export const ANNOUNCE_MS = 1300;
/** The last seconds of the allowance, shown in red. */
export const lowAt = (pace: number): number => Math.min(10, pace / 3);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Whether a position is one of those played on the clock. */
export function isTimed(itemId: string): boolean {
  return hash(`clock|${itemId}`) % 3 === 0;
}

export function paceOf(a: Attempt): number | null {
  const tag = a.themes.find((t) => t.startsWith('pace:'));
  return tag ? Number(tag.slice(5)) : null;
}

/** The series an answer belongs to: answers from before the tag existed are series 1. */
export function seriesOf(a: Attempt): number {
  const tag = a.themes.find((t) => t.startsWith('clock:'));
  return tag ? Number(tag.slice(6)) : 1;
}

/** "0:23" from seconds left, rounded up as a chess clock shows it. */
export function clockFace(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface Condition {
  /** Rated best, good or an inaccuracy. */
  passed: number;
  /** Rated a mistake or a blunder, late or not. */
  failed: number;
  /** Answered, but the engine gave no rating. */
  unrated: number;
  /** Moves made after the allowance ran out (also counted above by their rating). */
  late: number;
}

export interface OwnMoveSummary {
  /** The series now running (see CLOCK_SERIES). */
  timed: Condition;
  untimed: Condition;
  /** The same two counts for answers given under the earlier, quiet clock. */
  before: { timed: Condition; untimed: Condition };
  /**
   * Answers during which the app left the screen: hiding the page stops the clock but not
   * the thinking, so these are practice and are in neither condition.
   */
  interrupted: number;
  /** Answers to a position that had been shown before and left (ADR-060): not first looks, in neither condition. */
  shownBefore: number;
  /** How many moves got each rating, every first look answered. */
  grades: Record<'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'unrated', number>;
  /** Of moves made when something of his could already be taken: how often that capture was gone afterwards. */
  threat: { met: number; n: number };
  /** Of moves made when something could be taken on those terms, or mate given: how often he did. */
  free: { taken: number; n: number };
  /** Of moves that left something loose or allowed mate: how often the reply he named was one that matters. */
  named: { yes: number; n: number };
}

/** First looks at a position only: a second look says more about memory than about the clock. */
export function ownMoveSummary(attempts: Attempt[], since?: number): OwnMoveSummary {
  const rows = attempts.filter((a) => a.exerciseKind === 'own-move' && a.context !== 'review' && !a.themes.includes('left') && (since === undefined || a.ts >= since));
  const has = (a: Attempt, t: string) => a.themes.includes(t);
  const late = (a: Attempt) => has(a, 'late') || has(a, 'timeout');
  // Ratings under the earlier schemes: 'clean' / 'failed' / 'unresolved'.
  const gradeOf = (a: Attempt): keyof OwnMoveSummary['grades'] => {
    const g = a.themes[1];
    if (g === 'clean') return 'good';
    if (g === 'failed') return 'blunder';
    if (g === 'unresolved' || g === undefined) return 'unrated';
    return g as keyof OwnMoveSummary['grades'];
  };
  const condition = (xs: Attempt[]): Condition => ({
    passed: xs.filter((a) => ['best', 'good', 'inaccuracy'].includes(gradeOf(a))).length,
    failed: xs.filter((a) => ['mistake', 'blunder'].includes(gradeOf(a))).length,
    unrated: xs.filter((a) => gradeOf(a) === 'unrated').length,
    late: xs.filter(late).length,
  });
  const grades: OwnMoveSummary['grades'] = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, unrated: 0 };
  for (const a of rows) grades[gradeOf(a)]++;
  const something = rows.filter((a) => a.themes[2] === 'loose' || a.themes[2] === 'mate');
  const now = rows.filter((a) => seriesOf(a) === CLOCK_SERIES);
  const earlier = rows.filter((a) => seriesOf(a) !== CLOCK_SERIES);
  const fair = (a: Attempt) => !has(a, 'interrupted') && !has(a, 'shown-before');
  const timed = (xs: Attempt[]) => condition(xs.filter((a) => fair(a) && (paceOf(a) ?? 0) > 0));
  const untimed = (xs: Attempt[]) => condition(xs.filter((a) => fair(a) && (paceOf(a) ?? 0) === 0));
  return {
    timed: timed(now),
    untimed: untimed(now),
    before: { timed: timed(earlier), untimed: untimed(earlier) },
    interrupted: now.filter((a) => has(a, 'interrupted')).length,
    shownBefore: now.filter((a) => has(a, 'shown-before') && !has(a, 'interrupted')).length,
    grades,
    threat: { met: rows.filter((a) => has(a, 'threat-met')).length, n: rows.filter((a) => has(a, 'threat-met') || has(a, 'threat-left')).length },
    free: { taken: rows.filter((a) => has(a, 'free-taken')).length, n: rows.filter((a) => has(a, 'free-taken') || has(a, 'free-left')).length },
    named: { yes: something.filter((a) => has(a, 'named-it')).length, n: something.length },
  };
}

/**
 * Timed against untimed: the share passed of every first look answered (an unrated move
 * counts as not passed, so a condition cannot look better by having more unrated moves),
 * and the difference with a plausible range (Newcombe's method on the two Wilson ranges).
 */
export function conditionDifference(timed: Condition, untimed: Condition): { timed: number; untimed: number; diff: number; lo: number; hi: number } | null {
  const n1 = timed.passed + timed.failed + timed.unrated;
  const n2 = untimed.passed + untimed.failed + untimed.unrated;
  if (n1 === 0 || n2 === 0) return null;
  const p1 = timed.passed / n1;
  const p2 = untimed.passed / n2;
  const w1 = wilson(timed.passed, n1);
  const w2 = wilson(untimed.passed, n2);
  const diff = p1 - p2;
  return { timed: p1, untimed: p2, diff, lo: diff - Math.hypot(p1 - w1.lo, w2.hi - p2), hi: diff + Math.hypot(w1.hi - p1, p2 - w2.lo) };
}

/**
 * What the flag costs: the run of timed first looks, newest back, that were both sound
 * (best, good or an inaccuracy) and made before the flag fell. A mistake, a blunder or a
 * fallen flag ends it. It counts sound moves inside the allowance and never how fast they
 * were made: a move at second 29 counts as much as one at second 3. An unrated move and an
 * answer during which the app left the screen neither add to it nor end it.
 */
export function clockRun(attempts: Attempt[]): number {
  const rows = attempts
    .filter((a) => a.exerciseKind === 'own-move' && a.context !== 'review' && !a.themes.includes('left') && !a.themes.includes('interrupted') && !a.themes.includes('shown-before') && seriesOf(a) === CLOCK_SERIES && (paceOf(a) ?? 0) > 0)
    .sort((a, b) => b.ts - a.ts);
  let run = 0;
  for (const a of rows) {
    const step = runStep(a.themes[1] ?? 'unrated', a.themes.includes('late'));
    if (step === 'ends') break;
    if (step === 'adds') run++;
  }
  return run;
}

/** What one timed answer does to the run. */
export function runStep(grade: string, late: boolean): 'adds' | 'ends' | 'neither' {
  if (grade === 'unrated') return late ? 'ends' : 'neither';
  if (late || grade === 'mistake' || grade === 'blunder') return 'ends';
  return 'adds';
}
