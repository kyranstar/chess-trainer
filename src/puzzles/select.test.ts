import { describe, expect, it } from 'vitest';
import { selectPuzzles } from './select';
import type { Puzzle } from './types';

const pool: Puzzle[] = Array.from({ length: 200 }, (_, i) => ({
  id: `p${i}`, fen: '', moves: '', rating: 600 + i * 8, rd: 75, pop: 90, plays: 1000,
  themes: [i % 2 ? 'fork' : 'pin', i % 5 === 0 ? 'short' : 'oneMove'], game: '',
  opening: i % 10 === 0 ? ['Italian_Game'] : undefined,
}));

describe('puzzle selection', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = selectPuzzles(pool, { themes: ['fork'], target: 1200, count: 5, exclude: new Set(), seed: '2026-11-10' });
    const b = selectPuzzles(pool, { themes: ['fork'], target: 1200, count: 5, exclude: new Set(), seed: '2026-11-10' });
    const c = selectPuzzles(pool, { themes: ['fork'], target: 1200, count: 5, exclude: new Set(), seed: '2026-11-11' });
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a.map((p) => p.id)).not.toEqual(c.map((p) => p.id));
  });

  it('respects theme, never returns excluded (already seen) puzzles, and stays near the target', () => {
    const exclude = new Set(pool.filter((p) => p.rating < 1250).map((p) => p.id));
    const out = selectPuzzles(pool, { themes: ['fork'], target: 1200, count: 6, exclude, seed: 's' });
    expect(out).toHaveLength(6);
    for (const p of out) {
      expect(p.themes).toContain('fork');
      expect(exclude.has(p.id)).toBe(false);
      expect(Math.abs(p.rating - 1200)).toBeLessThanOrEqual(150);
    }
  });

  it('widens the rating window rather than returning nothing', () => {
    const out = selectPuzzles(pool, { themes: ['pin'], target: 3000, count: 3, exclude: new Set(), seed: 's' });
    expect(out).toHaveLength(3);
  });

  it('can select by opening family and by fixed band', () => {
    const it = selectPuzzles(pool, { openings: ['Italian_Game'], target: 1000, count: 4, exclude: new Set(), seed: 's' });
    expect(it.every((p) => p.opening?.includes('Italian_Game'))).toBe(true);
    const band = selectPuzzles(pool, { themes: ['fork'], band: { lo: 900, hi: 1300 }, target: 1100, count: 50, exclude: new Set(), seed: 's' });
    expect(band.length).toBeGreaterThan(0);
    expect(band.every((p) => p.rating >= 900 && p.rating < 1300)).toBe(true);
  });

  it('returns fewer than asked when the pool is exhausted', () => {
    const out = selectPuzzles(pool, { themes: ['nope'], target: 1000, count: 3, exclude: new Set(), seed: 's' });
    expect(out).toEqual([]);
  });
});
