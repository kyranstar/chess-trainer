import { describe, expect, it } from 'vitest';
import { blocksOf, clusterRatio, tCritical } from './stats';

describe('t critical value (two-sided 95%)', () => {
  it('matches the table for small degrees of freedom and tends to 1.96', () => {
    expect(tCritical(1)).toBeCloseTo(12.706, 3);
    expect(tCritical(4)).toBeCloseTo(2.776, 3);
    expect(tCritical(19)).toBeCloseTo(2.093, 3);
    expect(tCritical(39)).toBeCloseTo(2.023, 2);
    expect(tCritical(1000)).toBeCloseTo(1.962, 2);
  });
});

describe('ratio with the game as the cluster', () => {
  it('pools errors over decisions, not the mean of per-game rates', () => {
    const r = clusterRatio([{ events: 1, decisions: 10 }, { events: 0, decisions: 30 }]);
    expect(r!.rate).toBeCloseTo(1 / 40, 6);
  });
  it('gives the linearised standard error with the G/(G-1) correction', () => {
    const games = [{ events: 2, decisions: 20 }, { events: 0, decisions: 20 }, { events: 1, decisions: 10 }, { events: 3, decisions: 30 }];
    const r = clusterRatio(games)!;
    const rate = 6 / 80;
    const ss = games.reduce((t, g) => t + (g.events - rate * g.decisions) ** 2, 0);
    const se = Math.sqrt((4 / 3) * ss) / 80;
    expect(r.se).toBeCloseTo(se, 9);
    expect(r.lo).toBeCloseTo(Math.max(0, rate - tCritical(3) * se), 9);
    expect(r.hi).toBeCloseTo(rate + tCritical(3) * se, 9);
  });
  it('is wider when the same errors are bunched into one game', () => {
    const spread = clusterRatio(Array.from({ length: 10 }, () => ({ events: 1, decisions: 25 })))!;
    const bunched = clusterRatio([{ events: 10, decisions: 25 }, ...Array.from({ length: 9 }, () => ({ events: 0, decisions: 25 }))])!;
    expect(spread.rate).toBeCloseTo(bunched.rate, 9);
    expect(bunched.hi - bunched.lo).toBeGreaterThan(spread.hi - spread.lo);
  });
  it('never goes below zero, and gives nothing without decisions or with a single game', () => {
    expect(clusterRatio([{ events: 0, decisions: 30 }, { events: 0, decisions: 12 }])!.lo).toBe(0);
    expect(clusterRatio([])).toBeNull();
    expect(clusterRatio([{ events: 0, decisions: 0 }])).toBeNull();
    const one = clusterRatio([{ events: 2, decisions: 30 }])!;
    expect(one.rate).toBeCloseTo(2 / 30, 9);
    expect(one.se).toBeNull();
  });
});

describe('consecutive blocks', () => {
  it('cuts complete blocks from the oldest and leaves the remainder pending', () => {
    const xs = Array.from({ length: 45 }, (_, i) => i);
    const b = blocksOf(xs, 20);
    expect(b.blocks).toHaveLength(2);
    expect(b.blocks[0]![0]).toBe(0);
    expect(b.blocks[1]![19]).toBe(39);
    expect(b.pending).toEqual([40, 41, 42, 43, 44]);
  });
  it('has no block under the size', () => {
    expect(blocksOf([1, 2, 3], 20)).toEqual({ blocks: [], pending: [1, 2, 3] });
  });
});
