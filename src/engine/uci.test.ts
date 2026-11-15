import { describe, expect, it } from 'vitest';
import { evalText, winPercent } from './uci';

describe('the number beside the bar (owner request, 12 November)', () => {
  it('is the engine\'s evaluation in pawns, the inverse of the expected score the bar shows', () => {
    expect(evalText(winPercent({ cp: 11 }))).toBe('+0.11');
    expect(evalText(winPercent({ cp: -240 }))).toBe('−2.40');
    expect(evalText(winPercent({ cp: 0 }))).toBe('0.00');
    expect(evalText(50)).toBe('0.00');
    // A hair either side of level is not given a sign it has not earned.
    expect(evalText(winPercent({ cp: 0.3 }))).toBe('0.00');
    expect(evalText(winPercent({ cp: -0.3 }))).toBe('0.00');
  });

  it('keeps to five characters: one decimal from ten pawns up, and a forced mate is M', () => {
    expect(evalText(winPercent({ cp: 1234 }))).toBe('+12.3');
    expect(evalText(winPercent({ cp: -1050 }))).toBe('−10.5');
    expect(evalText(winPercent({ cp: 999 }))).toBe('+9.99');
    expect(evalText(winPercent({ mate: 3 }))).toBe('+M');
    expect(evalText(winPercent({ mate: -1 }))).toBe('−M');
  });

  it('a better position for the learner always reads higher', () => {
    const order = [5, 19, 50, 72, 97].map((wp) => Number(evalText(wp).replace('−', '-')));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
