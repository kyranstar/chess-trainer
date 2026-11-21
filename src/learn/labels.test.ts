import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../content';
import type { ConceptStatus } from './curriculum';
import { learnedCount, learnLabel, statusLine } from './labels';

const NOW = Date.UTC(2026, 10, 21);
const DAY = 86_400_000;
const base = (over: Partial<ConceptStatus>): ConceptStatus => ({
  concept: CONCEPTS[0]!, stage: 'new', taughtVia: null, taughtAt: null, demonstratedVia: null, lastCheck: null, prereqsMet: true, unmetPrereqs: [],
  assessable: true, offlineLesson: true, hasAnyLesson: true, evidence: { n: 0, successes: 0, rate: null, interval: null } as unknown as ConceptStatus['evidence'], evidenceState: 'untested', ...over,
});

describe("Learn's five labels (ADR-064)", () => {
  it('maps every stage to one plain label and a short line', () => {
    const cases: [Partial<ConceptStatus>, string, string][] = [
      [{ stage: 'new' }, 'Not started', 'Not started'],
      [{ stage: 'started' }, 'Started', 'Started'],
      [{ stage: 'taught', taughtVia: 'local-lesson' }, 'Check due', 'Studied · check due'],
      [{ stage: 'taught', taughtVia: 'self-reported-link' }, 'Check due', 'Marked done by you · check due'],
      [{ stage: 'taught', taughtVia: 'local-lesson', assessable: false }, 'Studied', 'Studied'],
      [{ stage: 'demonstrated', demonstratedVia: 'pretest', lastCheck: { passed: true, ts: NOW - DAY, correct: 5, total: 5 } }, 'Learned', 'Learned by pre-test'],
      [{ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: true, ts: NOW - DAY, correct: 4, total: 5 } }, 'Learned', 'Learned · passed the check, 4 of 5'],
      [{ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: true, ts: NOW - 30 * DAY, correct: 5, total: 5 } }, 'Check due', 'Learned · re-check due'],
      [{ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: false, ts: NOW - DAY, correct: 2, total: 5 } }, 'Check due', 'Check due · last re-check not passed'],
    ];
    for (const [over, label, line] of cases) {
      expect(learnLabel(base(over), NOW), JSON.stringify(over)).toBe(label);
      expect(statusLine(base(over), NOW), JSON.stringify(over)).toBe(line);
    }
  });

  it('counts as learned what was learned and not since failed', () => {
    const s = [
      base({ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: true, ts: NOW - DAY, correct: 5, total: 5 } }),
      base({ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: true, ts: NOW - 30 * DAY, correct: 5, total: 5 } }),
      base({ stage: 'demonstrated', demonstratedVia: 'check', lastCheck: { passed: false, ts: NOW - DAY, correct: 1, total: 5 } }),
      base({ stage: 'taught', taughtVia: 'local-lesson' }),
    ];
    expect(learnedCount(s, NOW)).toBe(2);
  });
});
