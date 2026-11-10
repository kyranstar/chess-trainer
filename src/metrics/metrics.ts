/**
 * Dashboard metrics. Every function is a pure, reproducible computation over the immutable
 * attempt log and returns its own denominator, exclusions, uncertainty and the ids of the
 * attempts behind it, so the UI can always show "n", "period" and "view positions".
 */
import type { Attempt } from '../db/types';

/** Below this many observations a rate is labelled provisional (policy, not statistics). */
export const PROVISIONAL_N = 20;
export const METRICS_VERSION = 'metrics-v1';

export type Confidence = 'none' | 'provisional' | 'ok';

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson score interval for a binomial proportion, 95%. */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return { lo: successes === 0 ? 0 : clamp(centre - half), hi: successes === n ? 1 : clamp(centre + half) };
}

export interface Band {
  lo: number;
  hi: number;
}
export const BAND_WIDTH = 200;
export function bandOf(rating: number): Band {
  const lo = Math.floor(rating / BAND_WIDTH) * BAND_WIDTH;
  return { lo, hi: lo + BAND_WIDTH };
}

export interface RateMetric {
  n: number;
  successes: number;
  rate: number | null;
  interval: Interval | null;
  confidence: Confidence;
  attemptUuids: string[];
}

function rateOf(rows: Attempt[]): RateMetric {
  const n = rows.length;
  const successes = rows.filter((a) => a.outcome === 'success').length;
  return {
    n,
    successes,
    rate: n ? successes / n : null,
    interval: n ? wilson(successes, n) : null,
    confidence: n === 0 ? 'none' : n < PROVISIONAL_N ? 'provisional' : 'ok',
    attemptUuids: rows.map((a) => a.uuid),
  };
}

export interface UnseenFilter {
  /** Any of these theme tags. */
  themes?: string[];
  band?: Band;
  /** Inclusive lower bound, UTC ms. */
  since?: number;
  conceptId?: string;
}

export interface UnseenAccuracy extends RateMetric {
  excluded: { repeats: number; skipped: number; guided: number };
}

/**
 * Unseen puzzle accuracy.
 *   numerator   = puzzles solved on the first-ever presentation with no wrong move and no hint
 *   denominator = first-ever presentations of a puzzle with a decided outcome
 *   excluded    = repeats and scheduled reviews, skips, guided lesson examples
 */
export function unseenAccuracy(attempts: Attempt[], f: UnseenFilter = {}): UnseenAccuracy {
  const inScope = attempts.filter(
    (a) =>
      (f.since === undefined || a.ts >= f.since) &&
      (!f.themes || f.themes.some((t) => a.themes.includes(t))) &&
      (!f.band || (a.rating !== null && a.rating >= f.band.lo && a.rating < f.band.hi)) &&
      (!f.conceptId || a.conceptId === f.conceptId),
  );
  const excluded = { repeats: 0, skipped: 0, guided: 0 };
  const rows: Attempt[] = [];
  for (const a of inScope) {
    if (a.exerciseKind !== 'puzzle') excluded.guided++;
    else if (!a.fresh) excluded.repeats++;
    else if (a.outcome === 'skipped') excluded.skipped++;
    else rows.push(a);
  }
  return { ...rateOf(rows), excluded };
}

export interface Retention extends RateMetric {
  buckets: { label: string; minDays: number; n: number; successes: number; attemptUuids: string[] }[];
}

const GAPS: [string, number, number][] = [
  ['1–2 days', 1, 2],
  ['3–7 days', 3, 7],
  ['8–21 days', 8, 21],
  ['22+ days', 22, Infinity],
];

/**
 * Retention: success on scheduled spaced reviews (item was due), grouped by days since the
 * item was last seen. Early repeats and first presentations are excluded.
 */
export function retention(attempts: Attempt[], since?: number): Retention {
  const rows = attempts.filter((a) => a.scheduledReview && a.outcome !== 'skipped' && (since === undefined || a.ts >= since));
  const buckets = GAPS.map(([label, lo, hi]) => {
    const inB = rows.filter((a) => (a.daysSinceLast ?? 0) >= lo && (a.daysSinceLast ?? 0) <= hi);
    return { label, minDays: lo, n: inB.length, successes: inB.filter((a) => a.outcome === 'success').length, attemptUuids: inB.map((a) => a.uuid) };
  });
  return { ...rateOf(rows), buckets };
}

export const LEVEL_PRIOR = 1200;

/**
 * Practice level on the Lichess puzzle scale: an Elo-style running estimate from unseen
 * puzzles only, used to choose puzzle difficulty. It is NOT a playing-strength rating and
 * is never shown without its sample size.
 *   expected = 1 / (1 + 10^((puzzle - level) / 400));  level += K * (score - expected)
 *   K = max(24, 160 / (1 + i / 4)) for the i-th observation (fast at first, then steady).
 */
export function estimateLevel(attempts: Attempt[]): { level: number; n: number } {
  const rows = attempts
    .filter((a) => a.exerciseKind === 'puzzle' && a.fresh && a.outcome !== 'skipped' && a.rating !== null)
    .sort((x, y) => x.ts - y.ts || (x.uuid < y.uuid ? -1 : 1));
  let level = LEVEL_PRIOR;
  rows.forEach((a, i) => {
    const expected = 1 / (1 + 10 ** ((a.rating! - level) / 400));
    const k = Math.max(24, 160 / (1 + i / 4));
    level += k * ((a.outcome === 'success' ? 1 : 0) - expected);
  });
  return { level: Math.round(level), n: rows.length };
}

export function formatPct(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}

export interface EndgameAccuracy extends RateMetric {
  win: { n: number; successes: number };
  hold: { n: number; successes: number };
}

/**
 * Theoretical endgame accuracy (king and pawn against king).
 *   numerator   = starts played out with the win or draw kept on every move, first time seen, no help
 *   denominator = first-time play-outs with a decided outcome
 * Every move is judged by the exact table of the ending, so there is no engine judgement in it.
 */
export function endgameAccuracy(attempts: Attempt[], since?: number): EndgameAccuracy {
  const rows = attempts.filter((a) => a.exerciseKind === 'endgame' && a.fresh && a.outcome !== 'skipped' && (since === undefined || a.ts >= since));
  const part = (goal: string) => {
    const r = rows.filter((a) => a.themes.includes(goal));
    return { n: r.length, successes: r.filter((a) => a.outcome === 'success').length };
  };
  return { ...rateOf(rows), win: part('win'), hold: part('hold') };
}
