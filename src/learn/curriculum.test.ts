import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { Attempt, LessonEvent } from '../db/types';
import { CHECK, conceptStatuses, gradeCheck, nextToLearn } from './curriculum';

const T0 = Date.UTC(2026, 10, 10, 12);
let k = 0;
const ev = (conceptId: string, type: LessonEvent['type'], ts = T0 + ++k, detail?: LessonEvent['detail']): LessonEvent => ({
  uuid: `e${++k}`, deviceId: 'd', ts, tzOffsetMin: 0, conceptId, lessonId: null, url: null, type, detail,
});
const att = (over: Partial<Attempt>): Attempt => ({
  uuid: `a${++k}`, deviceId: 'd', sessionId: null, context: 'test', exerciseId: `lichess:${k}`, exerciseKind: 'puzzle',
  contentVersion: 'p@1', conceptId: null, themes: ['fork'], rating: 1000, ts: T0 + k, tzOffsetMin: 0, elapsedMs: 1,
  firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false, fresh: true,
  scheduledReview: false, daysSinceLast: null, schedulerVersion: 's', ...over,
});
const get = (ss: ReturnType<typeof conceptStatuses>, id: string) => ss.find((s) => s.concept.id === id)!;

describe('concept status', () => {
  it('starts every concept new and untested, not weak', () => {
    const ss = conceptStatuses(CONCEPTS, [], []);
    for (const s of ss) {
      expect(s.stage).toBe('new');
      expect(s.evidenceState).toBe('untested');
      expect(s.evidence.rate).toBeNull();
    }
  });

  it('opening a link is not completion; marking it done is self-reported teaching', () => {
    let s = get(conceptStatuses(CONCEPTS, [ev('tactics.pin', 'link-opened')], []), 'tactics.pin');
    expect(s.stage).toBe('started');
    expect(s.taughtVia).toBeNull();
    s = get(conceptStatuses(CONCEPTS, [ev('tactics.pin', 'link-opened'), ev('tactics.pin', 'link-marked-done')], []), 'tactics.pin');
    expect(s.stage).toBe('taught');
    expect(s.taughtVia).toBe('self-reported-link');
  });

  it('finishing a local lesson teaches; only a passed independent check demonstrates', () => {
    const taught = [ev('tactics.double-attack', 'local-started'), ev('tactics.double-attack', 'local-completed')];
    let s = get(conceptStatuses(CONCEPTS, taught, []), 'tactics.double-attack');
    expect(s.stage).toBe('taught');
    expect(s.taughtVia).toBe('local-lesson');
    s = get(conceptStatuses(CONCEPTS, [...taught, ev('tactics.double-attack', 'check-failed')], []), 'tactics.double-attack');
    expect(s.stage).toBe('taught');
    expect(s.lastCheck?.passed).toBe(false);
    s = get(conceptStatuses(CONCEPTS, [...taught, ev('tactics.double-attack', 'check-passed')], []), 'tactics.double-attack');
    expect(s.stage).toBe('demonstrated');
    expect(s.demonstratedVia).toBe('check');
  });

  it('a check passed without any lesson is a pre-test skip', () => {
    const s = get(conceptStatuses(CONCEPTS, [ev('mate.in-one', 'check-passed')], []), 'mate.in-one');
    expect(s.stage).toBe('demonstrated');
    expect(s.demonstratedVia).toBe('pretest');
  });

  it('prerequisites are met only by demonstration', () => {
    let s = get(conceptStatuses(CONCEPTS, [], []), 'tactics.double-attack');
    expect(s.prereqsMet).toBe(false);
    expect(s.unmetPrereqs).toEqual(['safety.hanging-pieces']);
    s = get(conceptStatuses(CONCEPTS, [ev('safety.hanging-pieces', 'check-passed')], []), 'tactics.double-attack');
    expect(s.prereqsMet).toBe(true);
  });

  it('evidence uses unseen attempts on the concept themes; a few observations are provisional', () => {
    const s = get(conceptStatuses(CONCEPTS, [], [att({}), att({ outcome: 'fail' }), att({ themes: ['pin'] })]), 'tactics.double-attack');
    expect(s.evidence.n).toBe(2);
    expect(s.evidenceState).toBe('provisional');
  });
});

describe('check-understanding rubric', () => {
  it(`passes at ${CHECK.pass} of ${CHECK.size} first-try solves without hints`, () => {
    const mk = (good: number) => Array.from({ length: CHECK.size }, (_, i) => att({ outcome: i < good ? 'success' : 'fail' }));
    expect(gradeCheck(mk(CHECK.pass)).passed).toBe(true);
    expect(gradeCheck(mk(CHECK.pass - 1)).passed).toBe(false);
    expect(gradeCheck(mk(CHECK.size).map((a, i) => (i < 2 ? { ...a, outcome: 'assisted' as const } : a))).passed).toBe(false);
  });
  it('is incomplete until enough puzzles were attempted', () => {
    expect(gradeCheck([att({})]).complete).toBe(false);
  });
});

describe('next concept to learn', () => {
  it('picks the first concept in order whose prerequisites are met', () => {
    const r = nextToLearn(conceptStatuses(CONCEPTS, [], []), { online: true });
    expect(r.pick?.concept.id).toBe('safety.hanging-pieces');
  });

  it('offline, skips link-only concepts, says so, and offers a local lesson instead', () => {
    const events = [ev('safety.hanging-pieces', 'check-passed')];
    const r = nextToLearn(conceptStatuses(CONCEPTS, events, []), { online: false });
    expect(r.deferred?.concept.id).toBe('safety.counting'); // link-only, first in order
    expect(r.pick?.concept.id).toBe('tactics.double-attack'); // has a local lesson
    expect(r.pick?.offlineLesson).toBe(true);
  });

  it('never returns a demonstrated concept or one already taught', () => {
    const events = CONCEPTS.flatMap((c) => [ev(c.id, 'link-marked-done')]);
    expect(nextToLearn(conceptStatuses(CONCEPTS, events, []), { online: true }).pick).toBeNull();
  });
});
