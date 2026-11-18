/**
 * Small statistics for the Progress charts. Pure and deterministic, so the same records always
 * give the same picture on the phone and in the tests.
 */

/** Two-sided 95% critical values of Student's t for 1 to 30 degrees of freedom. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064,
  2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Student's t, two-sided 95%: the table up to 30, then the usual expansion in 1/df. */
export function tCritical(df: number): number {
  if (df < 1) return Infinity;
  if (df <= 30) return T975[Math.round(df) - 1]!;
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

export interface ClusterRatio {
  /** Pooled events per decision. */
  rate: number;
  /** Linearised standard error with the game as the cluster; null with one game. */
  se: number | null;
  lo: number;
  hi: number;
  games: number;
  events: number;
  decisions: number;
}

/**
 * Events per decision pooled over games, with an interval that treats the game, not the move,
 * as the unit: moves of one game are not independent, and errors bunch. The standard error is
 * the linearised (delta-method) one for a ratio of sums with a G/(G-1) correction, and the
 * interval uses t with G-1 degrees of freedom. The lower end is cut at zero.
 */
export function clusterRatio(games: { events: number; decisions: number }[]): ClusterRatio | null {
  const used = games.filter((g) => g.decisions > 0);
  const events = used.reduce((t, g) => t + g.events, 0);
  const decisions = used.reduce((t, g) => t + g.decisions, 0);
  if (decisions === 0) return null;
  const rate = events / decisions;
  const G = used.length;
  if (G < 2) return { rate, se: null, lo: rate, hi: rate, games: G, events, decisions };
  const ss = used.reduce((t, g) => t + (g.events - rate * g.decisions) ** 2, 0);
  const se = Math.sqrt((G / (G - 1)) * ss) / decisions;
  const half = tCritical(G - 1) * se;
  return { rate, se, lo: Math.max(0, rate - half), hi: rate + half, games: G, events, decisions };
}

/** Consecutive, non-overlapping blocks from the oldest; the incomplete remainder is pending. */
export function blocksOf<T>(xs: T[], size: number): { blocks: T[][]; pending: T[] } {
  const whole = Math.floor(xs.length / size);
  const blocks: T[][] = [];
  for (let i = 0; i < whole; i++) blocks.push(xs.slice(i * size, (i + 1) * size));
  return { blocks, pending: xs.slice(whole * size) };
}
