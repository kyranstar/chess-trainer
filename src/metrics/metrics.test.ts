import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import { bandOf, endgameAccuracy, estimateLevel, PROVISIONAL_N, retention, unseenAccuracy, wilson } from './metrics';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 12);
let k = 0;
function att(over: Partial<Attempt>): Attempt {
  k++;
  return {
    uuid: `u${k}`, deviceId: 'd', sessionId: null, context: 'test', exerciseId: `lichess:${k}`, exerciseKind: 'puzzle',
    contentVersion: 'p@1', conceptId: null, themes: ['fork'], rating: 1000, ts: T0, tzOffsetMin: 0, elapsedMs: 1000,
    firstMove: 'e2e4', played: [], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
    fresh: true, scheduledReview: false, daysSinceLast: null, schedulerVersion: 's', ...over,
  };
}

describe('wilson interval', () => {
  it('matches known values and stays inside [0,1]', () => {
    const w = wilson(8, 10);
    expect(w.lo).toBeCloseTo(0.49, 2);
    expect(w.hi).toBeCloseTo(0.943, 2);
    expect(wilson(0, 5).lo).toBe(0);
    expect(wilson(5, 5).hi).toBe(1);
  });
  it('is undefined-safe for n = 0', () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe('unseen puzzle accuracy', () => {
  it('counts only first-ever attempts; hints and wrong moves are not successes', () => {
    const log = [
      att({ outcome: 'success' }),
      att({ outcome: 'fail' }),
      att({ outcome: 'assisted', hints: 1 }),
      att({ outcome: 'success', fresh: false }), // a repeat: excluded
      att({ outcome: 'success', fresh: false, scheduledReview: true }), // a review: excluded
      att({ outcome: 'skipped' }), // excluded, reported separately
      att({ outcome: 'success', exerciseKind: 'lesson-try' }), // guided lesson example: excluded
    ];
    const m = unseenAccuracy(log);
    expect(m.n).toBe(3);
    expect(m.successes).toBe(1);
    expect(m.rate).toBeCloseTo(1 / 3);
    expect(m.excluded).toEqual({ repeats: 2, skipped: 1, guided: 1 });
    expect(m.attemptUuids).toHaveLength(3);
  });

  it('reports insufficient data instead of a rate when nothing qualifies', () => {
    const m = unseenAccuracy([att({ fresh: false })]);
    expect(m.n).toBe(0);
    expect(m.rate).toBeNull();
    expect(m.confidence).toBe('none');
  });

  it(`is provisional below ${PROVISIONAL_N} observations`, () => {
    const few = unseenAccuracy(Array.from({ length: PROVISIONAL_N - 1 }, () => att({})));
    expect(few.confidence).toBe('provisional');
    const enough = unseenAccuracy(Array.from({ length: PROVISIONAL_N }, () => att({})));
    expect(enough.confidence).toBe('ok');
  });

  it('filters by theme, rating band and period', () => {
    const log = [
      att({ themes: ['fork'], rating: 900, ts: T0 }),
      att({ themes: ['pin'], rating: 900, ts: T0 }),
      att({ themes: ['fork', 'pin'], rating: 1500, ts: T0 - 40 * DAY, outcome: 'fail' }),
    ];
    expect(unseenAccuracy(log, { themes: ['fork'] }).n).toBe(2);
    expect(unseenAccuracy(log, { themes: ['fork'], band: bandOf(900) }).n).toBe(1);
    expect(unseenAccuracy(log, { since: T0 - 30 * DAY }).n).toBe(2);
  });
});

describe('retention', () => {
  it('uses only scheduled reviews and groups them by the gap since last seen', () => {
    const log = [
      att({ fresh: false, scheduledReview: true, daysSinceLast: 1, outcome: 'success' }),
      att({ fresh: false, scheduledReview: true, daysSinceLast: 5, outcome: 'fail' }),
      att({ fresh: false, scheduledReview: true, daysSinceLast: 30, outcome: 'success' }),
      att({ fresh: false, scheduledReview: false, daysSinceLast: 0, outcome: 'success' }), // early repeat: excluded
      att({ fresh: true }),
    ];
    const r = retention(log);
    expect(r.n).toBe(3);
    expect(r.successes).toBe(2);
    expect(r.buckets.map((b) => [b.label, b.n, b.successes])).toEqual([
      ['1–2 days', 1, 1],
      ['3–7 days', 1, 0],
      ['8–21 days', 0, 0],
      ['22+ days', 1, 1],
    ]);
  });
});

describe('practice level estimate', () => {
  it('starts at the prior with n = 0 and moves toward demonstrated difficulty', () => {
    expect(estimateLevel([])).toEqual({ level: 1200, n: 0 });
    const strong = estimateLevel(Array.from({ length: 12 }, (_, i) => att({ rating: 1700, ts: T0 + i })));
    expect(strong.level).toBeGreaterThan(1500);
    const weak = estimateLevel(Array.from({ length: 12 }, (_, i) => att({ rating: 900, outcome: 'fail', ts: T0 + i })));
    expect(weak.level).toBeLessThan(900);
  });
  it('ignores repeats, reviews, skips and unrated items, and is order-independent', () => {
    const log = [att({ rating: 1500, ts: T0 }), att({ rating: 1500, ts: T0 + 1, outcome: 'fail' })];
    const noise = [att({ fresh: false, rating: 2500 }), att({ outcome: 'skipped', rating: 2500 }), att({ rating: null })];
    expect(estimateLevel([...noise, ...log.slice().reverse()])).toEqual(estimateLevel(log));
  });
});

describe('theoretical endgame accuracy', () => {
  it('counts first-time play-outs only, split by task, and stays out of the puzzle metric', () => {
    const log = [
      att({ exerciseKind: 'endgame', themes: ['kpk', 'win'], rating: null, outcome: 'success' }),
      att({ exerciseKind: 'endgame', themes: ['kpk', 'win'], rating: null, outcome: 'fail' }),
      att({ exerciseKind: 'endgame', themes: ['kpk', 'hold'], rating: null, outcome: 'assisted', hints: 1 }),
      att({ exerciseKind: 'endgame', themes: ['kpk', 'hold'], rating: null, outcome: 'success', fresh: false }),
    ];
    const m = endgameAccuracy(log);
    expect(m.n).toBe(3);
    expect(m.successes).toBe(1);
    expect(m.win).toEqual({ n: 2, successes: 1 });
    expect(m.hold).toEqual({ n: 1, successes: 0 });
    expect(unseenAccuracy(log).n).toBe(0);
    expect(endgameAccuracy([]).confidence).toBe('none');
  });
});
