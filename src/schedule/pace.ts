/**
 * The pace ladder for "Your move".
 *
 * Accuracy first, then speed. The learner starts with no clock. Once his moves are clean
 * often enough, each move gets a clock; while they stay clean the clock tightens toward
 * what a ten-minute game allows (about fifteen seconds a move), and it loosens again when
 * accuracy drops. Speed is never rewarded for itself: the only way down the ladder is clean
 * moves, and a move not made in time counts as not clean at that pace.
 *
 * The rung is derived from the attempt log (nothing is stored), so it survives restores and
 * can be recomputed by anyone: replay the attempts in order; at the current pace look at the
 * last PACE_WINDOW moves whose result is established; PACE_UP or more clean tightens the
 * clock, PACE_DOWN or fewer loosens it, and either way the count starts afresh.
 */
import type { Attempt } from '../db/types';

/** Seconds per move, slowest first; 0 means no clock. */
export const PACES = [0, 30, 20, 15, 10] as const;
export const PACE_WINDOW = 12;
export const PACE_UP = 10;
export const PACE_DOWN = 6;

export interface Pace {
  index: number;
  /** Seconds allowed for choosing a move; 0 = no clock. */
  pace: number;
  /** Established results at this pace since it was last set (at most PACE_WINDOW). */
  atThisPace: { clean: number; n: number };
}

export function paceOf(a: Attempt): number | null {
  const tag = a.themes.find((t) => t.startsWith('pace:'));
  return tag ? Number(tag.slice(5)) : null;
}

/** null when the attempt establishes nothing about accuracy at its pace. */
function resultOf(a: Attempt): boolean | null {
  if (a.themes.includes('timeout')) return false;
  if (a.outcome === 'success') return true;
  if (a.outcome === 'fail') return false;
  return null;
}

export function paceFrom(attempts: Attempt[]): Pace {
  const log = attempts.filter((a) => a.exerciseKind === 'own-move' && a.context !== 'review').sort((x, y) => x.ts - y.ts);
  let index = 0;
  let window: boolean[] = [];
  for (const a of log) {
    if (paceOf(a) !== PACES[index]) continue; // made at another pace (an override, or before a step)
    const r = resultOf(a);
    if (r === null) continue;
    window.push(r);
    if (window.length > PACE_WINDOW) window.shift();
    if (window.length < PACE_WINDOW) continue;
    const clean = window.filter(Boolean).length;
    if (clean >= PACE_UP && index < PACES.length - 1) {
      index++;
      window = [];
    } else if (clean <= PACE_DOWN && index > 0) {
      index--;
      window = [];
    }
  }
  return { index, pace: PACES[index]!, atThisPace: { clean: window.filter(Boolean).length, n: window.length } };
}

export interface OwnMoveSummary {
  /** Passed in time: rated best, good or an inaccuracy. */
  clean: number;
  /** Rated a mistake or a blunder. */
  failed: number;
  /** Answered, but the engine gave no rating. */
  notScored: number;
  /** How many moves got each rating (moves not made in time are left out). */
  grades: Record<'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'unrated', number>;
  /** Not made within the pace's time (counted apart from the three above). */
  timeouts: number;
  /** Of moves made when something of his could already be taken: how often the move dealt with all of it. */
  threat: { met: number; n: number };
  /** Of moves made when something could be taken and kept, or mate given: how often he did. */
  free: { taken: number; n: number };
  /** Of moves that left something loose or allowed mate: how often the reply he named was that one. */
  named: { yes: number; n: number };
}

export function ownMoveSummary(attempts: Attempt[], since?: number): OwnMoveSummary {
  const rows = attempts.filter((a) => a.exerciseKind === 'own-move' && !a.themes.includes('left') && (since === undefined || a.ts >= since));
  const has = (a: Attempt, t: string) => a.themes.includes(t);
  const timed = rows.filter((a) => has(a, 'timeout'));
  const inTime = rows.filter((a) => !has(a, 'timeout'));
  // Attempts recorded before moves were rated in bands used 'clean' / 'failed' / 'unresolved'.
  const grade = (g: string) => inTime.filter((a) => a.themes[1] === g).length;
  const something = rows.filter((a) => a.themes[2] === 'loose' || a.themes[2] === 'mate');
  return {
    clean: inTime.filter((a) => a.outcome === 'success').length,
    failed: inTime.filter((a) => a.outcome === 'fail').length,
    notScored: inTime.filter((a) => a.outcome === 'skipped').length,
    grades: {
      best: grade('best'), good: grade('good') + grade('clean'), inaccuracy: grade('inaccuracy'),
      mistake: grade('mistake'), blunder: grade('blunder') + grade('failed'), unrated: grade('unrated') + grade('unresolved'),
    },
    timeouts: timed.length,
    threat: { met: rows.filter((a) => has(a, 'threat-met')).length, n: rows.filter((a) => has(a, 'threat-met') || has(a, 'threat-left')).length },
    free: { taken: rows.filter((a) => has(a, 'free-taken')).length, n: rows.filter((a) => has(a, 'free-taken') || has(a, 'free-left')).length },
    named: { yes: something.filter((a) => has(a, 'named-it')).length, n: something.length },
  };
}

