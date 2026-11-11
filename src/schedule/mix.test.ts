import { describe, expect, it } from 'vitest';
import type { ReviewState } from '../db/types';
import { MIX_WEIGHTS, type MixKind, nextMixKind, reviewOrder } from './mix';

/** A small deterministic generator, so the test is the same every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const all = { review: true, move: true, safe: true, chance: true, missed: true, puzzle: true };

describe('one-button practice: what comes next', () => {
  it('mixes every kind of material roughly by its weight, in no fixed order', () => {
    const rnd = lcg(7);
    const history: MixKind[] = [];
    for (let i = 0; i < 2000; i++) history.push(nextMixKind(all, history, rnd)!);
    const total = Object.values(MIX_WEIGHTS).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(MIX_WEIGHTS) as MixKind[]) {
      const share = history.filter((x) => x === k).length / history.length;
      expect(Math.abs(share - MIX_WEIGHTS[k] / total), k).toBeLessThan(0.06);
    }
    // Not a fixed rotation: the same kind is followed by different kinds.
    const afterSense = new Set(history.map((k, i) => (k === 'safe' ? history[i + 1] : undefined)).filter(Boolean));
    expect(afterSense.size).toBeGreaterThanOrEqual(3);
  });

  it('never gives the same kind three times running while something else is available', () => {
    const rnd = lcg(3);
    const history: MixKind[] = [];
    for (let i = 0; i < 1000; i++) history.push(nextMixKind(all, history, rnd)!);
    for (let i = 2; i < history.length; i++) expect(history[i] === history[i - 1] && history[i] === history[i - 2]).toBe(false);
  });

  it('only offers what exists, and ends when nothing does', () => {
    const rnd = lcg(11);
    const only = { review: false, move: false, safe: false, chance: false, missed: false, puzzle: true };
    expect(nextMixKind(only, ['puzzle', 'puzzle'], rnd)).toBe('puzzle'); // the only thing left may repeat
    const two = { review: true, move: false, safe: false, chance: false, missed: false, puzzle: true };
    const seen = new Set<MixKind>();
    const history: MixKind[] = [];
    for (let i = 0; i < 100; i++) { const k = nextMixKind(two, history, rnd)!; history.push(k); seen.add(k); }
    expect([...seen].sort()).toEqual(['puzzle', 'review']);
    expect(nextMixKind({ review: false, move: false, safe: false, chance: false, missed: false, puzzle: false }, [], rnd)).toBeNull();
  });
});

describe('order of due reviews', () => {
  it('positions from the learner’s own games come before lesson examples, repertoire moves, endings and puzzles; oldest first within each', () => {
    const st = (itemId: string, due: number) => ({ itemId, due }) as ReviewState;
    const order = reviewOrder([st('lichess:a', 1), st('opening:white|k:e2e4', 2), st('game:g:12', 9), st('sense:safe-or-not:g:14', 5), st('lesson:x:2', 3), st('kpk:win:8/8', 4), st('lichess:b', 0)]).map((s) => s.itemId);
    expect(order).toEqual(['sense:safe-or-not:g:14', 'game:g:12', 'lesson:x:2', 'opening:white|k:e2e4', 'kpk:win:8/8', 'lichess:b', 'lichess:a']);
  });
});

import type { Attempt } from '../db/types';
import { runSummary } from './mix';

describe('how a stretch of practice went, said plainly', () => {
  it('counts each kind of item with its own denominator, and an overall passed-of-scored', () => {
    let n = 0;
    const a = (kind: Attempt['exerciseKind'], outcome: Attempt['outcome'], over: Partial<Attempt> = {}) => ({ uuid: `r${++n}`, ts: n, exerciseKind: kind, exerciseId: `x${n}`, outcome, themes: [], scheduledReview: false, context: 'practice', ...over }) as unknown as Attempt;
    const s = runSummary([
      a('own-move', 'success', { themes: ['own-move', 'best'] }),
      a('own-move', 'success', { themes: ['own-move', 'inaccuracy'] }),
      a('own-move', 'fail', { themes: ['own-move', 'blunder'] }),
      a('own-move', 'skipped', { themes: ['own-move', 'left'] }), // shown and left
      a('sense', 'success'), a('sense', 'fail'), a('sense', 'skipped'),
      a('puzzle', 'success'), a('puzzle', 'fail'), a('puzzle', 'assisted'),
      a('own-game', 'success'), a('own-game', 'fail'),
      a('puzzle', 'success', { scheduledReview: true }), a('sense', 'fail', { scheduledReview: true }),
    ]);
    expect(s.moves).toEqual({ best: 1, good: 0, inaccuracy: 1, mistake: 0, blunder: 1, unrated: 0 });
    expect(s.questions).toEqual({ right: 1, n: 2 });
    expect(s.puzzles).toEqual({ right: 1, n: 3 });
    expect(s.missed).toEqual({ right: 1, n: 2 });
    expect(s.reviews).toEqual({ right: 1, n: 2 });
    expect(s.passed).toBe(6);
    expect(s.scored).toBe(12);
    expect(runSummary([]).scored).toBe(0);
  });
});

