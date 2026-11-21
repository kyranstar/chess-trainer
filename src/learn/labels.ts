/**
 * What Learn says about a concept (ADR-064): one of five plain labels for the list, and a short
 * line for the concept's page. They are read off the curriculum's stages (ADR-029) and never
 * claim more than the evidence: a failed re-check is "Check due", not "Learned".
 */
import { type ConceptStatus, needsRefresh } from './curriculum';

export type LearnLabel = 'Learned' | 'Check due' | 'Studied' | 'Started' | 'Not started';

export function learnLabel(s: ConceptStatus, now: number = Date.now()): LearnLabel {
  if (needsRefresh(s, now)) return 'Check due';
  if (s.stage === 'demonstrated') return 'Learned';
  if (s.stage === 'taught') return s.assessable ? 'Check due' : 'Studied';
  if (s.stage === 'started') return 'Started';
  return 'Not started';
}

export function statusLine(s: ConceptStatus, now: number = Date.now()): string {
  if (needsRefresh(s, now)) return s.lastCheck?.passed ? 'Learned · re-check due' : 'Check due · last re-check not passed';
  if (s.stage === 'demonstrated') {
    if (s.demonstratedVia === 'pretest') return 'Learned by pre-test';
    const c = s.lastCheck;
    return c?.total ? `Learned · passed the check, ${c.correct} of ${c.total}` : 'Learned';
  }
  if (s.stage === 'taught') {
    if (!s.assessable) return 'Studied';
    return s.taughtVia === 'self-reported-link' ? 'Marked done by you · check due' : 'Studied · check due';
  }
  return s.stage === 'started' ? 'Started' : 'Not started';
}

/** Concepts learned and not since failed on a re-check (a re-check merely due still counts). */
export function learnedCount(statuses: ConceptStatus[], now: number = Date.now()): number {
  return statuses.filter((s) => s.stage === 'demonstrated' && !(needsRefresh(s, now) && s.lastCheck && !s.lastCheck.passed)).length;
}
