/**
 * Baseline diagnostic.
 *
 * The baseline is not a separate exam with its own score. It is a short sampler that puts a
 * couple of unseen positions in front of the learner for every early concept, so the
 * dashboard moves from "untested" to "provisional" quickly. Two positions per concept is
 * far too few to call anything strong or weak, and the UI never does.
 */
import { conceptOpenings, conceptThemes } from '../content';
import type { Concept } from '../content/types';
import type { ConceptStatus } from './curriculum';

export const DIAGNOSTIC = { perConcept: 2, version: 'baseline-v1' };

function assessableByPositions(c: Concept): boolean {
  return conceptThemes(c).length > 0 || conceptOpenings(c).length > 0;
}

/** Concepts from the first four weeks that can be sampled with unseen positions. */
export function baselineConcepts(concepts: Concept[]): Concept[] {
  return concepts.filter((c) => c.week !== null && assessableByPositions(c));
}

export interface BaselineProgress {
  total: number;
  sampled: number;
  complete: boolean;
  positionsLeft: number;
  rows: { concept: Concept; n: number; successes: number; state: ConceptStatus['evidenceState'] }[];
}

export function baselineProgress(statuses: ConceptStatus[]): BaselineProgress {
  const rows = statuses
    .filter((s) => s.concept.week !== null && assessableByPositions(s.concept))
    .map((s) => ({ concept: s.concept, n: s.evidence.n, successes: s.evidence.successes, state: s.evidenceState }));
  const sampled = rows.filter((r) => r.n >= DIAGNOSTIC.perConcept).length;
  return {
    total: rows.length,
    sampled,
    complete: rows.length > 0 && sampled === rows.length,
    positionsLeft: rows.reduce((t, r) => t + Math.max(0, DIAGNOSTIC.perConcept - r.n), 0),
    rows,
  };
}

/** The next concept to sample: fewest unseen observations first, never the same twice in a row. */
export function nextBaselineConcept(statuses: ConceptStatus[], previousId: string | null): Concept | null {
  const open = baselineProgress(statuses).rows.filter((r) => r.n < DIAGNOSTIC.perConcept);
  const ranked = open.slice().sort((a, b) => a.n - b.n || a.concept.order - b.concept.order);
  return (ranked.find((r) => r.concept.id !== previousId) ?? ranked[0])?.concept ?? null;
}
