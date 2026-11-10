import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { LessonEvent } from '../db/types';
import { conceptStatuses } from '../learn/curriculum';
import { activeBlock, BLOCK_MINUTES, completeBlock, localDate, planSession, PLANNER_VERSION, pickTestConcept, spend } from './session';

const T0 = new Date(2026, 10, 10, 9, 0, 0).getTime();
let k = 0;
const ev = (conceptId: string, type: LessonEvent['type']): LessonEvent => ({
  uuid: `e${++k}`, deviceId: 'd', ts: T0 - 1000 + k, tzOffsetMin: 0, conceptId, lessonId: null, url: null, type,
});
const plan = (events: LessonEvent[], over: Partial<Parameters<typeof planSession>[0]> = {}) =>
  planSession({ id: 's1', now: T0, budgetMin: 30, statuses: conceptStatuses(CONCEPTS, events, []), dueCount: 3, online: true, ...over });

describe('session plan', () => {
  it('builds review, learn, apply, test in order with the 7/9/8/6 minute split', () => {
    const s = plan([]);
    expect(s.blocks.map((b) => b.kind)).toEqual(['review', 'learn', 'apply', 'test']);
    expect(s.blocks.map((b) => b.budgetSec / 60)).toEqual([7, 9, 8, 6]);
    expect(BLOCK_MINUTES).toEqual({ review: 7, learn: 9, apply: 8, test: 6 });
    expect(s.date).toBe(localDate(T0));
    expect(s.plannerVersion).toBe(PLANNER_VERSION);
    expect(s.blocks.every((b) => b.reason.length > 0)).toBe(true);
  });

  it('scales budgets for 10, 20, 45 and 60 minute sessions', () => {
    for (const m of [10, 20, 45, 60]) {
      const total = plan([], { budgetMin: m }).blocks.reduce((t, b) => t + b.budgetSec, 0);
      expect(total).toBe(m * 60);
    }
  });

  it('protects new-learning time even with a large review backlog', () => {
    const s = plan([], { dueCount: 500 });
    const learn = s.blocks.find((b) => b.kind === 'learn')!;
    expect(learn.status).toBe('pending');
    expect(learn.budgetSec).toBe(9 * 60);
    expect(learn.conceptId).toBe('safety.hanging-pieces');
    expect(s.blocks.find((b) => b.kind === 'review')!.budgetSec).toBe(7 * 60); // hard cap
  });

  it('with nothing due, skips review and gives its minutes to the test block', () => {
    const s = plan([], { dueCount: 0 });
    const review = s.blocks[0]!;
    expect(review.status).toBe('skipped');
    expect(review.budgetSec).toBe(0);
    expect(s.blocks[3]!.budgetSec).toBe((6 + 7) * 60);
  });

  it('applies the concept being learned in the apply block', () => {
    const s = plan([ev('safety.hanging-pieces', 'check-passed')]);
    expect(s.blocks[1]!.conceptId).toBe('safety.counting');
    // counting has no unseen assessment yet, so apply falls back to an assessable concept
    expect(s.blocks[2]!.conceptId).not.toBe('safety.counting');
    const s2 = plan([ev('safety.hanging-pieces', 'check-passed'), ev('safety.counting', 'link-marked-done')]);
    expect(s2.blocks[1]!.conceptId).toBe('mate.in-one');
    expect(s2.blocks[2]!.conceptId).toBe('mate.in-one');
  });

  it('offline: defers a link-only concept honestly and teaches an offline lesson instead', () => {
    const s = plan([ev('safety.hanging-pieces', 'check-passed')], { online: false });
    const learn = s.blocks[1]!;
    expect(learn.conceptId).toBe('tactics.double-attack');
    expect(learn.notice).toMatch(/Counting attackers and defenders.*connection/);
  });

  it('offline with no local lesson available: no fake lesson, the time goes to practice', () => {
    const events = [ev('safety.hanging-pieces', 'check-passed'), ev('tactics.double-attack', 'local-completed')];
    const s = plan(events, { online: false });
    const learn = s.blocks[1]!;
    expect(learn.status).toBe('skipped');
    expect(learn.conceptId).toBeNull();
    expect(learn.notice).toMatch(/connection/);
    expect(s.blocks[2]!.budgetSec).toBe((8 + 9) * 60);
    expect(s.blocks[2]!.conceptId).toBe('tactics.double-attack'); // taught, awaiting its check
  });
});

describe('session progress', () => {
  it('resumes at the first unfinished block and finishes after the last', () => {
    let s = plan([]);
    expect(activeBlock(s)?.kind).toBe('review');
    s = spend(s, 0, 100, T0 + 100_000);
    expect(s.blocks[0]!.spentSec).toBe(100);
    expect(s.blocks[0]!.status).toBe('active');
    s = completeBlock(s, 0, T0 + 200_000);
    expect(activeBlock(s)?.kind).toBe('learn');
    for (const i of [1, 2, 3]) s = completeBlock(s, i, T0 + 300_000);
    expect(activeBlock(s)).toBeNull();
    expect(s.status).toBe('done');
    expect(s.updatedAt).toBe(T0 + 300_000);
  });
});

describe('mixed test selection', () => {
  it('samples the least-observed eligible concept first and avoids repeating the previous one', () => {
    const statuses = conceptStatuses(CONCEPTS, [], []);
    const first = pickTestConcept(statuses, null);
    expect(first?.concept.id).toBe('safety.hanging-pieces');
    const second = pickTestConcept(statuses, first!.concept.id);
    expect(second?.concept.id).not.toBe(first!.concept.id);
    expect(second?.assessable).toBe(true);
  });
});
