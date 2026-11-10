import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { Attempt } from '../db/types';
import { conceptStatuses } from './curriculum';
import { baselineConcepts, baselineProgress, DIAGNOSTIC, nextBaselineConcept } from './diagnostic';

let k = 0;
const att = (themes: string[], over: Partial<Attempt> = {}): Attempt => ({
  uuid: `a${++k}`, deviceId: 'd', sessionId: null, context: 'diagnostic', exerciseId: `lichess:${k}`, exerciseKind: 'puzzle',
  contentVersion: 'p@1', conceptId: null, themes, rating: 1000, ts: k, tzOffsetMin: 0, elapsedMs: 1, firstMove: null, played: [],
  mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false, fresh: true, scheduledReview: false, daysSinceLast: null,
  schedulerVersion: 's', ...over,
});
const statuses = (attempts: Attempt[]) => conceptStatuses(CONCEPTS, [], attempts);

describe('baseline diagnostic', () => {
  it('covers the first four weeks of assessable concepts, ignoring prerequisites', () => {
    const ids = baselineConcepts(CONCEPTS).map((c) => c.id);
    expect(ids).toContain('safety.hanging-pieces');
    expect(ids).toContain('tactics.pin'); // has a prerequisite, still sampled
    expect(ids).toContain('opening.italian'); // repertoire knowledge via opening-tagged positions
    expect(ids).not.toContain('safety.counting'); // no assessment exists
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it('with no attempts everything is unsampled and nothing is complete', () => {
    const p = baselineProgress(statuses([]));
    expect(p.sampled).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.rows.every((r) => r.n === 0 && r.state === 'untested')).toBe(true);
    expect(p.positionsLeft).toBe(p.total * DIAGNOSTIC.perConcept);
  });

  it('a concept counts as sampled after two unseen positions and stays provisional, never mastered or weak', () => {
    const p = baselineProgress(statuses([att(['fork']), att(['fork'], { outcome: 'fail' }), att(['pin'])]));
    const fork = p.rows.find((r) => r.concept.id === 'tactics.double-attack')!;
    expect(fork.n).toBe(2);
    expect(fork.state).toBe('provisional');
    expect(p.rows.find((r) => r.concept.id === 'tactics.pin')!.n).toBe(1);
    expect(p.sampled).toBe(1);
  });

  it('repeats and reviews do not count towards the baseline', () => {
    const p = baselineProgress(statuses([att(['fork'], { fresh: false }), att(['fork'], { fresh: false, scheduledReview: true })]));
    expect(p.rows.find((r) => r.concept.id === 'tactics.double-attack')!.n).toBe(0);
  });

  it('asks next for the least-sampled concept, not the one just shown, and stops when complete', () => {
    const first = nextBaselineConcept(statuses([]), null)!;
    expect(first.id).toBe('safety.hanging-pieces');
    const second = nextBaselineConcept(statuses([att(['hangingPiece'])]), first.id)!;
    expect(second.id).not.toBe(first.id);
    const all = baselineConcepts(CONCEPTS).flatMap((c) =>
      Array.from({ length: DIAGNOSTIC.perConcept }, () =>
        c.assessment.kind === 'unseen-puzzles' ? att(c.assessment.themes.slice(0, 1)) : att([], { conceptId: c.id }),
      ),
    );
    expect(baselineProgress(statuses(all)).complete).toBe(true);
    expect(nextBaselineConcept(statuses(all), null)).toBeNull();
  });
});
