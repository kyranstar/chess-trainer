import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import { applyAttempt, dueItems, rebuildReviewStates, reviewCalibration, SCHEDULER_VERSION } from './review';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

function att(over: Partial<Attempt>): Attempt {
  return {
    uuid: over.uuid ?? `u-${over.exerciseId}-${over.ts}`,
    deviceId: 'd', sessionId: null, context: 'practice', exerciseId: 'lichess:a', exerciseKind: 'puzzle',
    contentVersion: 'p@1', conceptId: null, themes: [], rating: 1000, ts: T0, tzOffsetMin: 0, elapsedMs: 1000,
    firstMove: 'e2e4', played: [], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
    fresh: true, scheduledReview: false, daysSinceLast: null, schedulerVersion: SCHEDULER_VERSION, ...over,
  };
}

describe('review scheduling (FSRS via ts-fsrs)', () => {
  it('a puzzle solved cleanly first time does not enter the review queue', () => {
    expect(applyAttempt(undefined, att({ outcome: 'success' }))).toBeUndefined();
  });

  it('a failed puzzle enters the queue and is due at least a day later', () => {
    const s = applyAttempt(undefined, att({ outcome: 'fail' }))!;
    expect(s.itemId).toBe('lichess:a');
    expect(s.algo).toBe(SCHEDULER_VERSION);
    expect(s.due - T0).toBeGreaterThanOrEqual(DAY);
  });

  it('a hint counts as a failed recall', () => {
    const fail = applyAttempt(undefined, att({ outcome: 'fail' }))!;
    const assisted = applyAttempt(undefined, att({ outcome: 'assisted' }))!;
    expect(assisted.due).toBe(fail.due);
  });

  it('skips never change the schedule', () => {
    const s = applyAttempt(undefined, att({ outcome: 'fail' }))!;
    expect(applyAttempt(s, att({ outcome: 'skipped', ts: T0 + DAY }))).toEqual(s);
    expect(applyAttempt(undefined, att({ outcome: 'skipped' }))).toBeUndefined();
  });

  it('successful reviews push the due date further out each time', () => {
    let s = applyAttempt(undefined, att({ outcome: 'fail' }))!;
    const gaps: number[] = [];
    let now = s.due;
    for (let i = 0; i < 3; i++) {
      s = applyAttempt(s, att({ outcome: 'success', ts: now, uuid: `r${i}` }))!;
      gaps.push(s.due - now);
      now = s.due;
    }
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!);
    expect(gaps[2]!).toBeGreaterThan(gaps[1]!);
  });

  it('a lesson example found first time does not enter the queue; a missed one does (policy v2)', () => {
    expect(applyAttempt(undefined, att({ exerciseKind: 'lesson-try', exerciseId: 'lesson:x:2', outcome: 'success' }))).toBeUndefined();
    const s = applyAttempt(undefined, att({ exerciseKind: 'lesson-try', exerciseId: 'lesson:x:2', outcome: 'fail' }));
    expect(s).toBeDefined();
    expect(s!.due - T0).toBeGreaterThanOrEqual(DAY);
  });

  it('is deterministic and rebuildable from the attempt log in any input order', () => {
    const log = [
      att({ exerciseId: 'lichess:a', outcome: 'fail', ts: T0, uuid: '1' }),
      att({ exerciseId: 'lichess:b', outcome: 'success', ts: T0 + 1, uuid: '2' }),
      att({ exerciseId: 'lichess:a', outcome: 'success', ts: T0 + 2 * DAY, uuid: '3' }),
      att({ exerciseId: 'lichess:c', outcome: 'assisted', ts: T0 + 3, uuid: '4' }),
      att({ exerciseId: 'lichess:a', outcome: 'fail', ts: T0 + 9 * DAY, uuid: '5' }),
    ];
    const a = rebuildReviewStates(log);
    const b = rebuildReviewStates([...log].reverse());
    expect([...a.keys()].sort()).toEqual(['lichess:a', 'lichess:c']);
    expect(b).toEqual(a);
    // Incremental application gives the same result as a rebuild.
    let inc = applyAttempt(undefined, log[0]!);
    inc = applyAttempt(inc, log[2]!);
    inc = applyAttempt(inc, log[4]!);
    expect(a.get('lichess:a')).toEqual(inc);
    expect(a.get('lichess:a')!.lastAttemptUuid).toBe('5');
  });

  it('dueItems returns only items due now, most overdue first', () => {
    const states = [...rebuildReviewStates([
      att({ exerciseId: 'lichess:a', outcome: 'fail', ts: T0, uuid: '1' }),
      att({ exerciseId: 'lichess:b', outcome: 'fail', ts: T0 + DAY, uuid: '2' }),
    ]).values()];
    expect(dueItems(states, T0)).toEqual([]);
    const later = dueItems(states, T0 + 30 * DAY).map((s) => s.itemId);
    expect(later).toEqual(['lichess:a', 'lichess:b']);
  });
});

describe('forecast against outcome (scheduler baseline)', () => {
  it('replays the log and compares predicted recall with what happened at each scheduled review', () => {
    const first = att({ exerciseId: 'lichess:a', outcome: 'fail', ts: T0, uuid: '1' });
    const due1 = applyAttempt(undefined, first)!.due;
    const log = [
      first,
      att({ exerciseId: 'lichess:a', outcome: 'success', ts: due1, uuid: '2', fresh: false, scheduledReview: true }),
      att({ exerciseId: 'lichess:b', outcome: 'fail', ts: T0, uuid: '3' }),
      att({ exerciseId: 'lichess:b', outcome: 'fail', ts: T0 + 40 * DAY, uuid: '4', fresh: false, scheduledReview: true }),
      att({ exerciseId: 'lichess:b', outcome: 'success', ts: T0 + 41 * DAY - 1000, uuid: '5', fresh: false, scheduledReview: false }), // early repeat: ignored
    ];
    const c = reviewCalibration(log);
    expect(c.n).toBe(2);
    expect(c.observed).toBe(0.5);
    // After a first miss the earliest review is a day later, which FSRS forecasts below its 90%
    // target (the memory is still weak); 40 days late the forecast is far lower again.
    expect(c.rows[0]!.predicted).toBeGreaterThan(0.7);
    expect(c.rows[0]!.predicted).toBeLessThanOrEqual(0.9);
    expect(c.rows[1]!.predicted).toBeLessThan(c.rows[0]!.predicted - 0.2);
    expect(c.predicted).toBeCloseTo((c.rows[0]!.predicted + c.rows[1]!.predicted) / 2);
    expect(c.schedulerVersion).toBe(SCHEDULER_VERSION);
  });

  it('is empty, not zero, when there are no scheduled reviews, and ignores input order', () => {
    expect(reviewCalibration([])).toMatchObject({ n: 0, predicted: null, observed: null });
    const log = [att({ exerciseId: 'lichess:a', outcome: 'fail', ts: T0, uuid: '1' }), att({ exerciseId: 'lichess:a', outcome: 'success', ts: T0 + 3 * DAY, uuid: '2', fresh: false, scheduledReview: true })];
    expect(reviewCalibration([...log].reverse())).toEqual(reviewCalibration(log));
  });
});

describe('due means due today', () => {
  it('a position missed in the evening is due the next day from the morning, not only after the same clock time', () => {
    const evening = new Date(2026, 10, 9, 20, 30).getTime();
    const s = applyAttempt(undefined, att({ outcome: 'fail', ts: evening }))!;
    const nextMorning = new Date(2026, 10, 10, 8, 0).getTime();
    expect(s.due).toBeGreaterThan(nextMorning); // stored due time is still 24 h later
    expect(dueItems([s], nextMorning).map((x) => x.itemId)).toEqual(['lichess:a']);
    expect(dueItems([s], new Date(2026, 10, 9, 23, 59).getTime())).toEqual([]); // but not on the same day
  });
});

describe('repertoire drills from before the move was part of the id', () => {
  it('are never offered again: the entry is re-learned under its new id instead of blocking the queue forever', () => {
    const old = applyAttempt(undefined, att({ exerciseId: 'opening:white|rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', exerciseKind: 'opening', outcome: 'fail', ts: T0 }))!;
    const current = applyAttempt(undefined, att({ exerciseId: 'opening:white|rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -:e2e4', exerciseKind: 'opening', outcome: 'fail', ts: T0 }))!;
    expect(dueItems([old, current], T0 + 3 * 86_400_000).map((x) => x.itemId)).toEqual([current.itemId]);
  });
});

describe('what enters the review queue, and what leaves it (policy v2)', () => {
  const DAY = 86_400_000;
  const run = (steps: [number, Attempt['outcome'], Partial<Attempt>?][], base: Partial<Attempt>) => {
    let state: ReturnType<typeof applyAttempt>;
    let last: number | null = null;
    for (const [day, outcome, over] of steps) {
      const ts = T0 + day * DAY;
      const scheduledReview = !!state && state.due <= ts + DAY;
      state = applyAttempt(state, att({ ...base, outcome, ts, scheduledReview, daysSinceLast: last === null ? null : day - last, ...over }));
      last = day;
    }
    return state;
  };

  it('only a miss puts a lesson example, an own-game position or an ending into the queue; a repertoire move always goes in', () => {
    for (const kind of ['lesson-try', 'own-game', 'endgame'] as const) {
      expect(run([[0, 'success']], { exerciseId: `x:${kind}`, exerciseKind: kind }), kind).toBeUndefined();
      expect(run([[0, 'fail']], { exerciseId: `x:${kind}`, exerciseKind: kind }), kind).toBeDefined();
      expect(run([[0, 'assisted']], { exerciseId: `x:${kind}`, exerciseKind: kind }), kind).toBeDefined();
    }
    expect(run([[0, 'success']], { exerciseId: 'opening:white|k:e2e4', exerciseKind: 'opening' })).toBeDefined();
  });

  it('a missed position leaves the queue once it has been recalled after two weeks or more, and comes back if it is missed again', () => {
    const base = { exerciseId: 'lichess:zz', exerciseKind: 'puzzle' as const };
    const early = run([[0, 'fail'], [1, 'success'], [5, 'success']], base)!;
    expect(early.retired).toBeUndefined();
    const graduated = run([[0, 'fail'], [1, 'success'], [5, 'success'], [21, 'success']], base)!;
    expect(graduated.retired).toBe('graduated');
    expect(dueItems([graduated], T0 + 400 * DAY)).toEqual([]);
    const back = run([[0, 'fail'], [1, 'success'], [5, 'success'], [21, 'success'], [60, 'fail']], base)!;
    expect(back.retired).toBeUndefined();
    expect(dueItems([back], T0 + 62 * DAY).map((s) => s.itemId)).toEqual(['lichess:zz']);
  });

  it('a repertoire move is never graduated: recalling it is the point', () => {
    const s = run([[0, 'success'], [3, 'success'], [30, 'success']], { exerciseId: 'opening:white|k:e2e4', exerciseKind: 'opening' })!;
    expect(s.retired).toBeUndefined();
  });

  it('a position missed four times is set aside instead of coming back every day', () => {
    const s = run([[0, 'fail'], [1, 'fail'], [2, 'fail'], [3, 'fail']], { exerciseId: 'lichess:hard', exerciseKind: 'puzzle' })!;
    expect(s.retired).toBe('set-aside');
    expect(dueItems([s], T0 + 10 * DAY)).toEqual([]);
  });
});

