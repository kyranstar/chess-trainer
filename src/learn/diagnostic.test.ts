import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { Attempt } from '../db/types';
import { conceptStatuses } from './curriculum';
import { baselineConcepts, baselineProgress, DIAGNOSTIC, nextBaselineConcept, projectPlan } from './diagnostic';

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

describe('30-day projection', () => {
  const plan = projectPlan(statuses([]), { startDate: '2026-11-10', days: 30, playWeekdays: [3, 6] });

  it('has 30 days with two play days in every full week', () => {
    expect(plan).toHaveLength(30);
    expect(plan[0]!.date).toBe('2026-11-10');
    expect(plan.filter((d) => d.kind === 'play').length).toBeGreaterThanOrEqual(8);
    for (const d of plan.filter((x) => x.kind === 'play')) expect([3, 6]).toContain(new Date(`${d.date}T12:00:00`).getDay());
  });

  it('introduces at most one new concept per study day, never before its prerequisites', () => {
    const seen = new Set<string>();
    for (const d of plan) {
      if (d.kind !== 'study' || !d.concept) continue;
      for (const p of d.concept.prereqs) expect(seen.has(p), `${d.concept.id} after ${p}`).toBe(true);
      expect(seen.has(d.concept.id)).toBe(false);
      seen.add(d.concept.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(15);
  });

  it('never schedules a concept that has no lesson, and says which lessons need a connection', () => {
    for (const d of plan) {
      if (!d.concept) continue;
      expect(d.concept.localLessons.length + d.concept.links.length).toBeGreaterThan(0);
      expect(d.lesson).toBe(d.concept.localLessons.length ? 'on-device' : 'online');
    }
  });

  it('skips concepts already studied or demonstrated', () => {
    const ev = (conceptId: string) => ({ uuid: conceptId, deviceId: 'd', ts: 1, tzOffsetMin: 0, conceptId, lessonId: null, url: null, type: 'check-passed' as const });
    const later = projectPlan(conceptStatuses(CONCEPTS, [ev('safety.hanging-pieces')], []), { startDate: '2026-11-10', days: 30, playWeekdays: [3, 6] });
    expect(later.some((d) => d.concept?.id === 'safety.hanging-pieces')).toBe(false);
  });
});
