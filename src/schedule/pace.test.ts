import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import { PACE_DOWN, PACE_UP, PACE_WINDOW, PACES, paceFrom } from './pace';

let k = 0;
const move = (pace: number, result: 'clean' | 'failed' | 'unresolved' | 'timeout', over: Partial<Attempt> = {}): Attempt => ({
  uuid: `a${++k}`, ts: k, exerciseKind: 'own-move', context: 'practice', exerciseId: `move:g:${k}`,
  themes: ['own-move', result === 'timeout' ? 'unresolved' : result, 'none', 'no-reply-named', `pace:${pace}`, ...(result === 'timeout' ? ['timeout'] : [])],
  outcome: result === 'clean' ? 'success' : result === 'failed' ? 'fail' : 'skipped', ...over,
}) as unknown as Attempt;
const many = (n: number, pace: number, result: Parameters<typeof move>[1]) => Array.from({ length: n }, () => move(pace, result));

describe('the pace ladder: accuracy first, the clock tightens only while moves stay clean', () => {
  it('starts with no clock', () => {
    expect(paceFrom([])).toMatchObject({ pace: 0, index: 0, atThisPace: { clean: 0, n: 0 } });
    expect(PACES[0]).toBe(0);
  });

  it('moves to the first clock after enough clean moves, and on down the ladder the same way', () => {
    const first = paceFrom(many(PACE_UP, PACES[0], 'clean'));
    expect(first.index).toBe(0); // not yet a full window
    const up = paceFrom(many(PACE_WINDOW, PACES[0], 'clean'));
    expect(up).toMatchObject({ index: 1, pace: PACES[1], atThisPace: { clean: 0, n: 0 } });
    const twice = paceFrom([...many(PACE_WINDOW, PACES[0], 'clean'), ...many(PACE_WINDOW, PACES[1], 'clean')]);
    expect(twice.pace).toBe(PACES[2]);
  });

  it('never rewards speed: failures and time-outs at a pace hold it or send it back, and unresolved moves count for nothing', () => {
    const base = many(PACE_WINDOW, PACES[0], 'clean'); // now at the first clock
    const mixed = [...base, ...many(PACE_UP - 1, PACES[1], 'clean'), ...many(PACE_WINDOW - PACE_UP + 1, PACES[1], 'failed')];
    expect(paceFrom(mixed).index).toBe(1); // neither good enough to tighten nor bad enough to loosen
    const bad = [...base, ...many(PACE_DOWN, PACES[1], 'clean'), ...many(PACE_WINDOW - PACE_DOWN, PACES[1], 'timeout')];
    expect(paceFrom(bad).index).toBe(0); // back to no clock
    const unresolved = [...base, ...many(40, PACES[1], 'unresolved')];
    expect(paceFrom(unresolved)).toMatchObject({ index: 1, atThisPace: { clean: 0, n: 0 } });
  });

  it('stops at the fastest pace, ignores review attempts and attempts made at another pace', () => {
    let log: Attempt[] = [];
    for (const p of PACES) log = [...log, ...many(PACE_WINDOW, p, 'clean')];
    expect(paceFrom(log).index).toBe(PACES.length - 1);
    const stray = [...many(PACE_WINDOW - 1, PACES[0], 'clean'), move(PACES[2], 'clean'), move(PACES[0], 'clean', { context: 'review' })];
    expect(paceFrom(stray).index).toBe(0);
  });
});

import { ownMoveSummary } from './pace';

describe('what is counted for "Your move"', () => {
  it('passes and misses with the grade behind each, moves not rated, time-outs, and the two other checks, each with its own denominator', () => {
    const a = (themes: string[], outcome: Attempt['outcome']) => ({ uuid: `s${++k}`, ts: k, exerciseKind: 'own-move', context: 'practice', exerciseId: `m${k}`, themes, outcome }) as unknown as Attempt;
    const s = ownMoveSummary([
      a(['own-move', 'best', 'none', 'no-reply-named', 'pace:0'], 'success'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:0', 'threat-met', 'free-taken'], 'success'),
      a(['own-move', 'inaccuracy', 'none', 'no-reply-named', 'pace:0'], 'success'),
      a(['own-move', 'blunder', 'loose', 'named-it', 'pace:0', 'threat-left'], 'fail'),
      a(['own-move', 'mistake', 'mate', 'named-another', 'pace:0', 'free-left'], 'fail'),
      a(['own-move', 'unrated', 'loose', 'no-reply-named', 'pace:20'], 'skipped'),
      a(['own-move', 'good', 'none', 'no-reply-named', 'pace:20', 'timeout'], 'skipped'),
      a(['own-move', 'left'], 'skipped'), // shown and left: not an answer
    ]);
    expect(s).toMatchObject({ clean: 3, failed: 2, notScored: 1, timeouts: 1 });
    expect(s.grades).toEqual({ best: 1, good: 1, inaccuracy: 1, mistake: 1, blunder: 1, unrated: 1 });
    expect(s.threat).toEqual({ met: 1, n: 2 });
    expect(s.free).toEqual({ taken: 1, n: 2 });
    expect(s.named).toEqual({ yes: 1, n: 3 });
  });
});
