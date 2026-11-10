import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { Attempt, LessonEvent } from '../db/types';
import { CHECK, checkForSession, conceptStatuses, gradeCheck, needsRefresh, nextToLearn, REFRESH_AFTER_DAYS } from './curriculum';

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
    const events = CONCEPTS.slice(0, 7).map((c) => ev(c.id, 'check-passed'));
    const r = nextToLearn(conceptStatuses(CONCEPTS, events, []), { online: false });
    expect(r.deferred?.concept.id).toBe('defense.basics'); // link-only, first in order
    expect(r.pick?.concept.id).toBe('conversion.trade-when-ahead'); // has a local lesson
    expect(r.pick?.offlineLesson).toBe(true);
    // At the very start nothing has to be deferred: the first concepts are on the device.
    const fresh = nextToLearn(conceptStatuses(CONCEPTS, [], []), { online: false });
    expect(fresh.deferred).toBeNull();
    expect(fresh.pick?.concept.id).toBe('safety.hanging-pieces');
  });

  it('never returns a demonstrated concept or one already taught', () => {
    const events = CONCEPTS.flatMap((c) => [ev(c.id, 'link-marked-done')]);
    expect(nextToLearn(conceptStatuses(CONCEPTS, events, []), { online: true }).pick).toBeNull();
  });
});

describe('a concept assessed by exact endgame play-outs', () => {
  const kpk = (over: Partial<Attempt>) => att({ exerciseKind: 'endgame', themes: ['kpk', 'win'], rating: null, ...over });
  it('takes its evidence from endgame play-outs, not from puzzles tagged as pawn endgames', () => {
    const s = get(conceptStatuses(CONCEPTS, [], [kpk({}), kpk({ outcome: 'fail' }), att({ themes: ['pawnEndgame'] })]), 'endgame.opposition');
    expect(s.assessable).toBe(true);
    expect(s.evidence.n).toBe(2);
    expect(s.evidence.successes).toBe(1);
    expect(s.evidenceState).toBe('provisional');
  });
  it('is untested until an ending has been played out', () => {
    expect(get(conceptStatuses(CONCEPTS, [], [att({ themes: ['pawnEndgame'] })]), 'endgame.opposition').evidenceState).toBe('untested');
  });
});

describe('when a check is given inside a session', () => {
  const DAY = 86_400_000;
  const morning = new Date(2026, 10, 10, 9, 0).getTime();
  const statuses = (events: LessonEvent[]) => conceptStatuses(CONCEPTS, events, []);

  it('is not given on the day the lesson was studied: solving the same idea minutes later shows little', () => {
    const ss = statuses([ev('tactics.skewer', 'local-completed', morning)]);
    expect(checkForSession(ss, morning + 3_600_000)).toBeNull();
    expect(checkForSession(ss, new Date(2026, 10, 10, 23, 50).getTime())).toBeNull();
    const next = checkForSession(ss, new Date(2026, 10, 11, 0, 30).getTime());
    expect(next?.concept.id).toBe('tactics.skewer');
    // A new calendar day alone is not a delay: a lesson at 23:55 is not checked at 00:05.
    const late = statuses([ev('tactics.skewer', 'local-completed', new Date(2026, 10, 10, 23, 55).getTime())]);
    expect(checkForSession(late, new Date(2026, 10, 11, 0, 5).getTime())).toBeNull();
    expect(checkForSession(late, new Date(2026, 10, 11, 8, 0).getTime())?.concept.id).toBe('tactics.skewer');
    expect(next?.why).toBe('first');
  });

  it('takes the concept that has waited longest first', () => {
    const ss = statuses([ev('tactics.pin', 'local-completed', morning - 2 * DAY), ev('tactics.skewer', 'local-completed', morning - 5 * DAY)]);
    expect(checkForSession(ss, morning)?.concept.id).toBe('tactics.skewer');
  });

  it('a passed check is not permanent: it is asked again after a few weeks, and a later miss shows as needing a refresh', () => {
    const passedAt = morning - (REFRESH_AFTER_DAYS + 1) * DAY;
    const base = [ev('tactics.skewer', 'local-completed', passedAt - DAY), ev('tactics.skewer', 'check-passed', passedAt)];
    let ss = statuses(base);
    const fork = () => get(ss, 'tactics.skewer');
    expect(fork().stage).toBe('demonstrated');
    expect(needsRefresh(fork(), passedAt + 5 * DAY)).toBe(false);
    expect(checkForSession(ss, passedAt + 5 * DAY)).toBeNull();
    expect(needsRefresh(fork(), morning)).toBe(true);
    expect(checkForSession(ss, morning)).toMatchObject({ why: 'refresh' });
    expect(checkForSession(ss, morning)?.concept.id).toBe('tactics.skewer');

    // The re-check is failed: still counted as demonstrated for what it unlocks, but flagged, and asked again on a later day.
    ss = statuses([...base, ev('tactics.skewer', 'check-failed', morning)]);
    expect(fork().stage).toBe('demonstrated');
    expect(needsRefresh(fork(), morning + 1000)).toBe(true);
    expect(checkForSession(ss, morning + 1000)).toBeNull(); // not twice on one day
    expect(checkForSession(ss, morning + DAY)?.concept.id).toBe('tactics.skewer');

    // Passed again: fresh for another period.
    ss = statuses([...base, ev('tactics.skewer', 'check-failed', morning), ev('tactics.skewer', 'check-passed', morning + DAY)]);
    expect(needsRefresh(fork(), morning + 2 * DAY)).toBe(false);
    expect(checkForSession(ss, morning + 2 * DAY)).toBeNull();
  });

  it('a first check comes before a refresh', () => {
    const old = morning - 40 * DAY;
    const ss = statuses([
      ev('tactics.skewer', 'local-completed', old - DAY), ev('tactics.skewer', 'check-passed', old),
      ev('tactics.pin', 'local-completed', morning - DAY),
    ]);
    expect(checkForSession(ss, morning)).toMatchObject({ why: 'first' });
    expect(checkForSession(ss, morning)?.concept.id).toBe('tactics.pin');
  });
});

describe('lessons stored on the phone come first', () => {
  it('online too: a concept with only linked lessons does not hold up the on-device lessons behind it', () => {
    const events = CONCEPTS.slice(0, 7).map((c) => ev(c.id, 'check-passed'));
    const r = nextToLearn(conceptStatuses(CONCEPTS, events, []), { online: true });
    expect(r.pick?.offlineLesson).toBe(true);
    expect(r.pick?.concept.id).toBe('conversion.trade-when-ahead');
    expect(r.deferred?.concept.id).toBe('defense.basics'); // said to be waiting, not silently skipped
  });
  it('a linked lesson is offered when online and nothing on the device is ready', () => {
    const done = CONCEPTS.filter((c) => c.localLessons.length > 0).map((c) => ev(c.id, 'check-passed'));
    const online = nextToLearn(conceptStatuses(CONCEPTS, done, []), { online: true });
    expect(online.pick).not.toBeNull();
    expect(online.pick!.offlineLesson).toBe(false);
    const offline = nextToLearn(conceptStatuses(CONCEPTS, done, []), { online: false });
    expect(offline.pick).toBeNull();
    expect(offline.deferred?.concept.id).toBe(online.pick!.concept.id);
  });
});

