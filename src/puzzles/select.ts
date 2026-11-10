/** Deterministic puzzle selection: same inputs and seed always give the same puzzles. */
import type { Band } from '../metrics/metrics';
import type { Puzzle } from './types';

export interface SelectOptions {
  /** Any of these Lichess theme tags. */
  themes?: string[];
  /** Any of these opening families (OpeningTags). */
  openings?: string[];
  /** Desired puzzle rating (Lichess scale). */
  target: number;
  /** Hard rating limits; when set, the window never widens beyond them. */
  band?: Band;
  count: number;
  /** Puzzle ids to leave out (normally everything the learner has ever attempted). */
  exclude: Set<string>;
  seed: string;
}

export const BASE_WINDOW = 150;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function selectPuzzles(pool: Puzzle[], o: SelectOptions): Puzzle[] {
  const eligible = pool.filter(
    (p) =>
      !o.exclude.has(p.id) &&
      (!o.themes?.length || o.themes.some((t) => p.themes.includes(t))) &&
      (!o.openings?.length || o.openings.some((t) => p.opening?.includes(t))) &&
      (!o.band || (p.rating >= o.band.lo && p.rating < o.band.hi)),
  );
  if (eligible.length === 0) return [];
  let window = BASE_WINDOW;
  let near = eligible.filter((p) => Math.abs(p.rating - o.target) <= window);
  while (near.length < o.count && near.length < eligible.length) {
    window *= 2;
    near = eligible.filter((p) => Math.abs(p.rating - o.target) <= window);
  }
  return near
    .map((p) => ({ p, h: fnv1a(`${o.seed}|${p.id}`) }))
    .sort((a, b) => a.h - b.h || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, o.count)
    .map((x) => x.p);
}
