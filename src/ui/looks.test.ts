import { describe, expect, it } from 'vitest';
import { contrast, LOOK_IDS, LOOKS, oklabDistance, resolveTokens } from './looks';

const modes = LOOK_IDS.flatMap((id) => (LOOKS[id].dark ? [[id, false], [id, true]] : [[id, false]]) as [typeof id, boolean][]);

describe('the three looks', () => {
  const base = Object.keys(resolveTokens('clubroom', false)).sort();

  it.each(modes)('%s (dark %s) sets every token', (id, dark) => {
    expect(Object.keys(resolveTokens(id, dark)).sort()).toEqual(base);
  });

  it.each(modes)('%s (dark %s): text reads at 4.5:1 or better', (id, dark) => {
    const t = resolveTokens(id, dark);
    for (const [fg, bg] of [['ink', 'paper'], ['ink', 'surface'], ['muted', 'paper'], ['muted', 'surface'], ['felt-ink', 'felt'], ['secondary-ink', 'secondary-bg']] as const) {
      expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(modes)('%s (dark %s): the move chips and the main colour stay apart', (id, dark) => {
    const t = resolveTokens(id, dark);
    const keys = ['you', 'game', 'best', 'other', 'felt'];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) expect(oklabDistance(t[keys[i]!]!, t[keys[j]!]!), `${keys[i]} vs ${keys[j]}`).toBeGreaterThanOrEqual(0.07);
    }
  });

  it('Night is always dark; Studio follows the system', () => {
    expect(resolveTokens('night', false)).toEqual(resolveTokens('night', true));
    expect(resolveTokens('studio', true).paper).not.toBe(resolveTokens('studio', false).paper);
  });

  it('contrast is the WCAG ratio', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
