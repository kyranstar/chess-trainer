/**
 * Test support: builds a measurement record (analysis v3 shape) from the hand-checked v2
 * fixture analysis, so selection and metric logic can be tested without running an engine.
 * The real engine's v3 output is checked separately in analyse.test.ts.
 */
import type { GameAnalysis, GameEvent, GameRecord } from '../types';

const targetOf = (e: GameEvent): 'mate' | 'material' | null =>
  e.majorError && e.errorLabel === 'allows-mate' ? 'mate' : e.majorError && e.errorLabel === 'loses-material' ? 'material' : null;

export function measureFrom(a: GameAnalysis): GameAnalysis {
  const byPly = new Map(a.events.map((e) => [e.ply, e]));
  return {
    decisions: a.decisions,
    events: a.events.map((e) => ({ ...e, target: targetOf(e) })),
    facts: a.decisions.map(([ply]) => {
      const e = byPly.get(ply);
      const t = e ? targetOf(e) : null;
      return {
        ply,
        wp: e ? e.bestWp : 50,
        played: t === 'material' ? -9 : 0,
        best: e?.opportunity === 'material' ? 3 : 0,
        ...(t === 'mate' ? { mated: true as const } : {}),
        ...(e?.opportunity === 'mate' ? { mating: true as const } : {}),
      };
    }),
  };
}

export function withMeasure<T extends GameRecord>(g: T, key = 'game-analysis-v3/Test engine/1'): T {
  return g.analysis ? { ...g, measure: measureFrom(g.analysis), measureKey: key } : g;
}
