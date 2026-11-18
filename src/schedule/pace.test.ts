import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import { clockFace, clockRun, conditionDifference, isTimed, lowAt, ownMoveSummary, runStep, TIMED_SECONDS } from './pace';

let k = 0;
/** An answer under the clock as it is now (series 2). */
const a = (themes: string[], outcome: Attempt['outcome'], over: Partial<Attempt> = {}) => old([...themes, ...(themes.includes('left') ? [] : ['clock:2'])], outcome, over);
/** An answer from before the clock was announced: no series tag. */
const old = (themes: string[], outcome: Attempt['outcome'], over: Partial<Attempt> = {}) => ({ uuid: `s${++k}`, ts: k, exerciseKind: 'own-move', context: 'practice', exerciseId: `m${k}`, themes, outcome, fresh: true, ...over }) as unknown as Attempt;

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

  it('attempts recorded under the earlier schemes still count, in the series they were given in', () => {
    const s = ownMoveSummary([
      old(['own-move', 'clean', 'none', 'no-reply-named', 'pace:0'], 'success'),
      old(['own-move', 'good', 'none', 'no-reply-named', 'pace:20', 'timeout'], 'skipped'),
    ]);
    expect(s.before.untimed.passed).toBe(1);
    expect(s.before.timed).toMatchObject({ late: 1 });
    expect(s.grades).toMatchObject({ good: 2 });
  });

  it('answers under the quiet clock and under the announced one are different series: they are never added together', () => {
    const s = ownMoveSummary([
      old(['own-move', 'good', 'none', 'no-reply-named', 'pace:30'], 'success'),
      old(['own-move', 'blunder', 'loose', 'named-it', 'pace:30', 'late'], 'fail'),
      old(['own-move', 'best', 'none', 'no-reply-named', 'pace:0'], 'success'),
      old(['own-move', 'best', 'none', 'no-reply-named', 'pace:0', 'interrupted'], 'success'),
      a(['own-move', 'mistake', 'none', 'no-reply-named', 'pace:30'], 'fail'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:0'], 'success'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:0', 'interrupted'], 'success'),
    ]);
    expect(s.timed).toEqual({ passed: 0, failed: 1, unrated: 0, late: 0 });
    expect(s.untimed).toEqual({ passed: 1, failed: 0, unrated: 0, late: 0 });
    expect(s.before.timed).toEqual({ passed: 1, failed: 1, unrated: 0, late: 1 });
    expect(s.before.untimed).toEqual({ passed: 1, failed: 0, unrated: 0, late: 0 });
    // Only what is left out of the series now running is said to be left out of it.
    expect(s.interrupted).toBe(1);
    // The ratings are of the moves, whatever the clock looked like: all seven.
    expect(s.grades).toEqual({ best: 2, good: 3, inaccuracy: 0, mistake: 1, blunder: 1, unrated: 0 });
  });
});

describe('what the flag costs', () => {
  const timed = (grade: string, ...more: string[]) => a(['own-move', grade, 'none', 'no-reply-named', 'pace:30', ...more], grade === 'mistake' || grade === 'blunder' ? 'fail' : 'success');
  const untimed = (grade: string) => a(['own-move', grade, 'none', 'no-reply-named', 'pace:0'], grade === 'blunder' ? 'fail' : 'success');

  it('the run is of timed moves that were sound and in time; a move with no clock is not part of it either way', () => {
    expect(clockRun([])).toBe(0);
    expect(clockRun([timed('best'), untimed('blunder'), timed('inaccuracy'), untimed('good'), timed('good')])).toBe(3);
  });

  it('a mistake, a blunder or a fallen flag ends it, however good the late move was', () => {
    expect(clockRun([timed('good'), timed('mistake'), timed('best'), timed('good')])).toBe(2);
    expect(clockRun([timed('good'), timed('good'), timed('blunder')])).toBe(0);
    expect(clockRun([timed('good'), timed('best', 'late'), timed('good')])).toBe(1);
    expect(clockRun([timed('good'), timed('good'), timed('best', 'late')])).toBe(0);
  });

  it('what could not be judged fairly neither adds nor ends: an unrated move, the app left the screen, a position only shown, a second look', () => {
    expect(clockRun([
      timed('good'),
      timed('unrated'),
      timed('blunder', 'interrupted'),
      a(['own-move', 'left'], 'skipped'),
      timed('blunder', 'x'),
    ].map((x, i) => (i === 4 ? { ...x, context: 'review' } as Attempt : x)).concat([timed('best')]))).toBe(2);
    // But a flag that fell is a flag that fell, rated or not.
    expect(clockRun([timed('good'), timed('unrated', 'late')])).toBe(0);
  });

  it('it is counted newest back, whatever order the answers are handed over in', () => {
    const xs = [timed('blunder'), timed('good'), timed('good')];
    expect(clockRun(xs.slice().reverse())).toBe(2);
  });

  it('answers under the quiet clock are not in it: nothing was at stake then', () => {
    expect(clockRun([old(['own-move', 'good', 'none', 'no-reply-named', 'pace:30'], 'success'), timed('good')])).toBe(1);
  });

  it('speed is never counted: one answer either adds one, ends the run, or does neither', () => {
    expect(runStep('best', false)).toBe('adds');
    expect(runStep('inaccuracy', false)).toBe('adds');
    expect(runStep('mistake', false)).toBe('ends');
    expect(runStep('good', true)).toBe('ends');
    expect(runStep('unrated', false)).toBe('neither');
  });
});

describe('the clock as it is shown', () => {
  it('reads like a chess clock and rounds up, so it shows 0:00 only when the time is gone', () => {
    expect(clockFace(30)).toBe('0:30');
    expect(clockFace(29.2)).toBe('0:30');
    expect(clockFace(9.01)).toBe('0:10');
    expect(clockFace(0.2)).toBe('0:01');
    expect(clockFace(0)).toBe('0:00');
    expect(clockFace(75)).toBe('1:15');
  });

  it('turns red for the last ten seconds, or the last third of a shorter allowance', () => {
    expect(lowAt(30)).toBe(10);
    expect(lowAt(2)).toBeCloseTo(0.667, 2);
  });
});
