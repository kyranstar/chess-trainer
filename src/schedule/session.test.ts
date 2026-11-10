import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { LessonEvent } from '../db/types';
import { conceptStatuses } from '../learn/curriculum';
import type { SessionRecord } from '../db/types';
import { activeBlock, BLOCK_MINUTES, completeBlock, currentSession, localDate, planPlaySession, planSession, PLANNER_VERSION, pickTestConcept, spend, suggestSessionKind } from './session';

const T0 = new Date(2026, 10, 10, 9, 0, 0).getTime();
let k = 0;
const ev = (conceptId: string, type: LessonEvent['type']): LessonEvent => ({
  uuid: `e${++k}`, deviceId: 'd', ts: T0 - 1000 + k, tzOffsetMin: 0, conceptId, lessonId: null, url: null, type,
});
const plan = (events: LessonEvent[], over: Partial<Parameters<typeof planSession>[0]> = {}) =>
  planSession({ id: 's1', now: T0, budgetMin: 30, statuses: conceptStatuses(CONCEPTS, events, []), dueCount: 3, online: true, ...over });

describe('session plan', () => {
  it('builds review, learn, practice, test in order with the 5/8/11/6 minute split: practice is the largest block', () => {
    const s = plan([]);
    expect(s.blocks.map((b) => b.kind)).toEqual(['review', 'learn', 'apply', 'test']);
    expect(s.blocks.map((b) => b.budgetSec / 60)).toEqual([5, 8, 11, 6]);
    expect(BLOCK_MINUTES).toEqual({ review: 5, learn: 8, apply: 11, test: 6 });
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
    expect(learn.budgetSec).toBe(8 * 60);
    expect(learn.conceptId).toBe('safety.hanging-pieces');
    expect(s.blocks.find((b) => b.kind === 'review')!.budgetSec).toBe(5 * 60); // hard cap
  });

  it('with nothing due, skips review and gives its minutes to practice', () => {
    const s = plan([], { dueCount: 0 });
    const review = s.blocks[0]!;
    expect(review.status).toBe('skipped');
    expect(review.budgetSec).toBe(0);
    expect(s.blocks[2]!.budgetSec).toBe((11 + 5) * 60);
    expect(s.blocks[3]!.budgetSec).toBe(6 * 60);
  });

  it('applies the concept being learned in the apply block', () => {
    const s = plan([ev('safety.hanging-pieces', 'check-passed')]);
    expect(s.blocks[1]!.conceptId).toBe('safety.counting');
    // counting has no unseen assessment yet, so apply falls back to an assessable concept
    expect(s.blocks[2]!.conceptId).not.toBe('safety.counting');
    const s2 = plan([ev('safety.hanging-pieces', 'check-passed'), ev('safety.counting', 'link-marked-done')]);
    expect(s2.blocks[1]!.conceptId).toBe('safety.threat-scan');
    expect(s2.blocks[2]!.conceptId).toBe('safety.threat-scan');
  });

  it('offline: defers a link-only concept honestly and teaches an offline lesson instead', () => {
    // The first seven concepts have lessons on the device. Once they are done, the next one
    // ("Defending against threats") only has linked lessons.
    const done = CONCEPTS.slice(0, 7).map((c) => ev(c.id, 'check-passed'));
    expect(plan([], { online: false }).blocks[1]!.conceptId).toBe('safety.hanging-pieces'); // nothing deferred at the start
    expect(plan([], { online: false }).blocks[1]!.notice).toBeNull();
    const s = plan(done, { online: false });
    const learn = s.blocks[1]!;
    expect(learn.conceptId).toBe('conversion.trade-when-ahead');
    expect(learn.notice).toMatch(/Defending against threats.*connection/);
  });

  it('offline with no local lesson available: no fake lesson, the time goes to practice', () => {
    const events = [ev('safety.hanging-pieces', 'check-passed'), ...CONCEPTS.filter((c) => c.localLessons.length).map((c) => ev(c.id, 'local-completed'))];
    const s = plan(events, { online: false });
    const learn = s.blocks[1]!;
    expect(learn.status).toBe('skipped');
    expect(learn.conceptId).toBeNull();
    expect(learn.notice).toMatch(/connection/);
    expect(s.blocks[2]!.budgetSec).toBe((11 + 8) * 60);
    // apply goes to a concept that was studied and still awaits its check
    const taught = CONCEPTS.filter((c) => c.localLessons.length && c.assessment.kind !== 'none-yet').map((c) => c.id);
    expect(taught).toContain(s.blocks[2]!.conceptId);
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

describe('play days', () => {
  const DAY = 86_400_000;
  const past = (daysAgo: number, kind: 'study' | 'play'): SessionRecord => ({
    id: `p${daysAgo}`, kind, date: localDate(T0 - daysAgo * DAY), createdAt: T0 - daysAgo * DAY, updatedAt: T0 - daysAgo * DAY,
    budgetMin: 30, plannerVersion: PLANNER_VERSION, status: 'done', blocks: [],
  });

  it('a play day is warm-up review, one rapid game, then reflection', () => {
    const s = planPlaySession({ id: 'p', now: T0, dueCount: 4 });
    expect(s.kind).toBe('play');
    expect(s.blocks.map((b) => b.kind)).toEqual(['review', 'play', 'reflect']);
    expect(s.blocks[0]!.budgetSec).toBe(5 * 60);
    expect(planPlaySession({ id: 'p', now: T0, dueCount: 0 }).blocks[0]!.status).toBe('skipped');
  });

  it('suggests study until two study sessions have been done since the last play day', () => {
    expect(suggestSessionKind([], T0).kind).toBe('study');
    expect(suggestSessionKind([past(1, 'study')], T0).kind).toBe('study');
    expect(suggestSessionKind([past(2, 'study'), past(1, 'study')], T0).kind).toBe('play');
    expect(suggestSessionKind([past(3, 'study'), past(2, 'play'), past(1, 'study')], T0).kind).toBe('study');
  });

  it('suggests at most two play days in any seven days, and always explains why', () => {
    const week = [past(6, 'play'), past(5, 'study'), past(4, 'study'), past(3, 'play'), past(2, 'study'), past(1, 'study')];
    const s = suggestSessionKind(week, T0);
    expect(s.kind).toBe('study');
    expect(s.reason).toMatch(/two play days/i);
    expect(suggestSessionKind([past(2, 'study'), past(1, 'study')], T0).reason.length).toBeGreaterThan(10);
  });

  it('sessions written before play days existed count as study sessions', () => {
    const legacy = [past(2, 'study'), past(1, 'study')].map(({ kind: _k, ...rest }) => rest as SessionRecord);
    expect(suggestSessionKind(legacy, T0).kind).toBe('play');
  });
});

describe('audit regressions', () => {
  it('the apply block never targets a concept that has no puzzle filter (it would serve arbitrary puzzles)', () => {
    // The opposition was studied (its check is an endgame play-out, it has no puzzle tags) and the next concept to learn has none either.
    const events = [ev('safety.hanging-pieces', 'check-passed'), ev('endgame.opposition', 'local-completed')];
    const s = plan(events);
    expect(s.blocks[1]!.conceptId).toBe('safety.counting');
    const apply = CONCEPTS.find((c) => c.id === s.blocks[2]!.conceptId)!;
    expect(apply.themes.length + (apply.assessment.kind === 'opening-puzzles' ? 1 : 0)).toBeGreaterThan(0);
    expect(apply.id).not.toBe('endgame.opposition');
  });

  it('a session that was started but never used does not count toward the play-day suggestion', () => {
    const DAY = 86_400_000;
    const untouched = (daysAgo: number): SessionRecord => ({
      id: `u${daysAgo}`, kind: 'study', date: localDate(T0 - daysAgo * DAY), createdAt: T0 - daysAgo * DAY, updatedAt: T0 - daysAgo * DAY,
      budgetMin: 30, plannerVersion: PLANNER_VERSION, status: 'active',
      blocks: [{ kind: 'review', budgetSec: 420, spentSec: 0, status: 'pending', conceptId: null, reason: '', notice: null, attemptUuids: [] }],
    });
    expect(suggestSessionKind([untouched(2), untouched(1)], T0).kind).toBe('study');
    const used = (daysAgo: number): SessionRecord => ({ ...untouched(daysAgo), blocks: [{ ...untouched(daysAgo).blocks[0]!, spentSec: 300, status: 'active' }] });
    expect(suggestSessionKind([used(2), used(1)], T0).kind).toBe('play');
  });
});

describe('which session is "the" session right now', () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
  const sess = (id: string, createdAt: number, over: Partial<SessionRecord> = {}): SessionRecord => ({
    id, kind: 'study', date: localDate(createdAt), createdAt, updatedAt: createdAt, budgetMin: 30, plannerVersion: PLANNER_VERSION, status: 'active',
    blocks: [{ kind: 'review', budgetSec: 420, spentSec: 60, status: 'active', conceptId: null, reason: '', notice: null, attemptUuids: [] }], ...over,
  });

  it('a session still being used when midnight passes stays the running session', () => {
    const s = sess('late', at(2026, 10, 9, 23, 40), { updatedAt: at(2026, 10, 9, 23, 59) });
    expect(currentSession([s], at(2026, 10, 10, 0, 2))?.id).toBe('late');
  });

  it('yesterday\'s abandoned or finished session is not today\'s', () => {
    const abandoned = sess('old', at(2026, 10, 9, 18, 0), { updatedAt: at(2026, 10, 9, 18, 20) });
    expect(currentSession([abandoned], at(2026, 10, 10, 8, 0))).toBeNull();
    const finishedLate = sess('done', at(2026, 10, 9, 23, 40), { updatedAt: at(2026, 10, 10, 0, 5), status: 'done' });
    expect(currentSession([finishedLate], at(2026, 10, 10, 0, 6))).toBeNull();
  });

  it('an unfinished session wins over another session of the same day, whatever the row order', () => {
    const done = sess('zz-done', at(2026, 10, 10, 7, 0), { status: 'done' });
    const active = sess('aa-active', at(2026, 10, 10, 9, 0));
    expect(currentSession([done, active], at(2026, 10, 10, 10, 0))?.id).toBe('aa-active');
    expect(currentSession([active, done], at(2026, 10, 10, 10, 0))?.id).toBe('aa-active');
    // With nothing unfinished, the most recent one of today is shown (its summary).
    expect(currentSession([done, sess('later-done', at(2026, 10, 10, 9, 0), { status: 'done' })], at(2026, 10, 10, 10, 0))?.id).toBe('later-done');
  });
});

describe('games actually played count as play days', () => {
  const DAY = 86_400_000;
  const study = (daysAgo: number): SessionRecord => ({
    id: `s${daysAgo}`, kind: 'study', date: localDate(T0 - daysAgo * DAY), createdAt: T0 - daysAgo * DAY, updatedAt: T0 - daysAgo * DAY,
    budgetMin: 30, plannerVersion: PLANNER_VERSION, status: 'done',
    blocks: [{ kind: 'review', budgetSec: 420, spentSec: 300, status: 'done', conceptId: null, reason: '', notice: null, attemptUuids: [] }],
  });
  it('two fetched games in the last week mean no further play day is prescribed, even though no play session was logged', () => {
    const history = [study(3), study(2), study(1)];
    expect(suggestSessionKind(history, T0).kind).toBe('play');
    const played = [localDate(T0 - 2 * DAY), localDate(T0 - 1 * DAY)];
    const s = suggestSessionKind(history, T0, played);
    expect(s.kind).toBe('study');
    expect(s.reason).toContain('played');
  });
  it('a game played after the last study sessions restarts the count', () => {
    const history = [study(4), study(3)];
    expect(suggestSessionKind(history, T0, [localDate(T0 - 2 * DAY)]).kind).toBe('study');
    // Several games on one day are one play day; a game today is not yet "past".
    expect(suggestSessionKind([study(2), study(1)], T0, [localDate(T0)]).kind).toBe('play');
  });
});

