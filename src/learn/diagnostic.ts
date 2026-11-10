/**
 * Baseline diagnostic and the curriculum projection.
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

export interface PlanDay {
  date: string; // local YYYY-MM-DD
  kind: 'study' | 'play';
  /** New concept for a study day; null when nothing new is ready. */
  concept: Concept | null;
  lesson: 'on-device' | 'online' | null;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A projection, not a promise: one new concept per study day in curriculum order, assuming
 * each check is passed on the day, with play days on the chosen weekdays (0 = Sunday).
 * Concepts with no lesson anywhere are left out.
 */
export function projectPlan(statuses: ConceptStatus[], opts: { startDate: string; days: number; playWeekdays: number[] }): PlanDay[] {
  const done = new Set(statuses.filter((s) => s.stage === 'taught' || s.stage === 'demonstrated').map((s) => s.concept.id));
  const queue = statuses.filter((s) => !done.has(s.concept.id) && s.hasAnyLesson).map((s) => s.concept);
  const out: PlanDay[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.startDate, i);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    if (opts.playWeekdays.includes(weekday)) {
      out.push({ date, kind: 'play', concept: null, lesson: null });
      continue;
    }
    const idx = queue.findIndex((c) => c.prereqs.every((p) => done.has(p) || !statuses.find((s) => s.concept.id === p)?.hasAnyLesson));
    const concept = idx >= 0 ? queue.splice(idx, 1)[0]! : null;
    if (concept) done.add(concept.id);
    out.push({ date, kind: 'study', concept, lesson: concept ? (concept.localLessons.length ? 'on-device' : 'online') : null });
  }
  return out;
}
