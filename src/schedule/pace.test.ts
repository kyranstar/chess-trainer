import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import { conditionDifference, isTimed, ownMoveSummary, TIMED_SECONDS } from './pace';

let k = 0;
const a = (themes: string[], outcome: Attempt['outcome'], over: Partial<Attempt> = {}) => ({ uuid: `s${++k}`, ts: k, exerciseKind: 'own-move', context: 'practice', exerciseId: `m${k}`, themes, outcome, fresh: true, ...over }) as unknown as Attempt;

describe('which positions are played on the clock', () => {
  it('about one position in three, fixed by the position itself so a reload or a second look cannot change it', () => {
    const ids = Array.from({ length: 600 }, (_, i) => `move:game${i % 40}:${18 + (i % 9) * 2}:${i}`);
    const timed = ids.filter(isTimed).length;
    expect(timed).toBeGreaterThan(150);
    expect(timed).toBeLessThan(250);
    expect(ids.map(isTimed)).toEqual(ids.map(isTimed));
    expect(TIMED_SECONDS).toBe(30);
  });
});

describe('what is counted for "Your move"', () => {
  it('timed and untimed positions are counted apart, and a late move keeps its rating', () => {
    const s = ownMoveSummary([
      a(['own-move', 'best', 'none', 'no-reply-named', 'pace:0'], 'success'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:0', 'threat-met', 'free-taken'], 'success'),
      a(['own-move', 'blunder', 'loose', 'named-it', 'pace:0', 'threat-left'], 'fail'),
      a(['own-move', 'unrated', 'loose', 'no-reply-named', 'pace:0'], 'skipped'),
      a(['own-move', 'inaccuracy', 'none', 'no-reply-named', 'pace:30'], 'success'),
      a(['own-move', 'mistake', 'mate', 'named-another', 'pace:30', 'free-left'], 'fail'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:30', 'late'], 'success'),
      a(['own-move', 'blunder', 'loose', 'named-it', 'pace:30', 'late'], 'fail'), // late AND a blunder: visible in both counts
      a(['own-move', 'left'], 'skipped'), // shown and left: not an answer
      a(['own-move', 'best', 'none', 'no-reply-named', 'pace:0'], 'success', { context: 'review', fresh: false }), // a second look: not counted
    ]);
    expect(s.untimed).toEqual({ passed: 2, failed: 1, unrated: 1, late: 0 });
    expect(s.timed).toEqual({ passed: 2, failed: 2, unrated: 0, late: 2 });
    expect(s.grades).toEqual({ best: 1, good: 2, inaccuracy: 1, mistake: 1, blunder: 2, unrated: 1 });
    expect(s.threat).toEqual({ met: 1, n: 2 });
    expect(s.free).toEqual({ taken: 1, n: 2 });
    expect(s.named).toEqual({ yes: 2, n: 4 });
  });

  it('a move during which the app left the screen is practice, not part of the timed comparison', () => {
    const s = ownMoveSummary([
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:30'], 'success'),
      a(['own-move', 'blunder', 'loose', 'named-it', 'pace:30', 'interrupted'], 'fail'),
      a(['own-move', 'best', 'none', 'no-reply-named', 'pace:0', 'interrupted'], 'success'),
    ]);
    expect(s.timed).toEqual({ passed: 1, failed: 0, unrated: 0, late: 0 });
    expect(s.untimed).toEqual({ passed: 0, failed: 0, unrated: 0, late: 0 });
    expect(s.interrupted).toBe(2);
    // Still answers: the ratings count them.
    expect(s.grades).toMatchObject({ best: 1, good: 1, blunder: 1 });
  });

  it('the difference between the conditions is over every first look answered, rated or not, and comes with its range', () => {
    const d = conditionDifference({ passed: 6, failed: 2, unrated: 2, late: 1 }, { passed: 16, failed: 3, unrated: 1, late: 0 })!;
    expect(d.timed).toBeCloseTo(0.6, 5);
    expect(d.untimed).toBeCloseTo(0.8, 5);
    expect(d.diff).toBeCloseTo(-0.2, 5);
    // Ten and twenty answers cannot tell 60% from 80%: the range spans nought.
    expect(d.lo).toBeCloseTo(-0.511, 2);
    expect(d.hi).toBeCloseTo(0.117, 2);
    expect(conditionDifference({ passed: 0, failed: 0, unrated: 0, late: 0 }, { passed: 3, failed: 1, unrated: 0, late: 0 })).toBeNull();
  });

  it('attempts recorded under the earlier schemes still count', () => {
    const s = ownMoveSummary([
      a(['own-move', 'clean', 'none', 'no-reply-named', 'pace:0'], 'success'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:20', 'timeout'], 'skipped'),
    ]);
    expect(s.untimed.passed).toBe(1);
    expect(s.timed).toMatchObject({ late: 1 });
  });
});
