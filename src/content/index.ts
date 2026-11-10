/** Curated content shipped inside the app bundle (available offline with the app shell). */
import conceptsJson from '../../content/concepts.json';
import sourcesJson from '../../content/sources.json';
import themesJson from '../../content/themes.json';
import lessonEvidence from '../../content/verification/lessons.json';
import type { Concept, Lesson, Source } from './types';

const lessonModules = import.meta.glob<Lesson>('../../content/lessons/*.json', { eager: true, import: 'default' });

export const CONCEPTS: Concept[] = (conceptsJson.concepts as unknown as Concept[]).slice().sort((a, b) => a.order - b.order);
export const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
export const LESSONS: Lesson[] = Object.values(lessonModules);
export const LESSON_BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
export const SOURCES = sourcesJson.sources as unknown as Source[];
export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const THEMES = themesJson.themes as Record<string, { name: string; description: string }>;

const boardKey = (fen: string) => fen.split(' ').slice(0, 3).join(' ');
export interface TryEvidence {
  /** Expected score (0-100) of the engine's best move in the position, from the build-time check. */
  bestWinPct: number;
  /** Other moves that passed the same engine test as the text's move (within five points of the best). */
  alternatives: { uci: string; san: string }[];
}
const EVIDENCE = new Map<string, TryEvidence>();
for (const l of (lessonEvidence as { lessons: { lesson: string; tries: { step: number; fen: string; bestWinPct: number; alternatives?: { uci: string; san: string }[] }[] }[] }).lessons) {
  for (const t of l.tries) EVIDENCE.set(`${l.lesson}|${t.step}|${boardKey(t.fen)}`, { bestWinPct: t.bestWinPct, alternatives: t.alternatives ?? [] });
}

/** Engine evidence for one asked move of a lesson example. `step` is the 1-based step number. */
export function lessonTryEvidence(lessonId: string, step: number, fen: string): TryEvidence | null {
  return EVIDENCE.get(`${lessonId}|${step}|${boardKey(fen)}`) ?? null;
}

/**
 * Moves the build-time engine check did not fault in a lesson example. The lesson still asks
 * for the text's move (the text may have its own reasons for preferring it), but playing one
 * of these is never recorded as a mistake.
 */
export function lessonAlternatives(lessonId: string, step: number, fen: string): { uci: string; san: string }[] {
  return lessonTryEvidence(lessonId, step, fen)?.alternatives ?? [];
}

/** A move within this many expected-score points of the best is not faulted (the same margin the text's own move had to meet). */
export const LESSON_MARGIN = 5;

/** Providers that are linked, never mirrored. */
export const LINK_PROVIDERS: Record<string, { name: string; note: string }> = {
  'lichess-practice': { name: 'Lichess Practice', note: 'Free. Opens lichess.org; needs a connection.' },
  'chesscom-lessons': { name: 'Chess.com Lessons', note: 'Opens chess.com; needs a connection and usually a membership.' },
  chessreps: { name: 'Chessreps', note: 'Opens chessreps.com; first line free, the rest needs your membership.' },
};

export function conceptThemes(c: Concept): string[] {
  return c.assessment.kind === 'unseen-puzzles' ? c.assessment.themes : [];
}
export function conceptOpenings(c: Concept): string[] {
  return c.assessment.kind === 'opening-puzzles' ? c.assessment.openings : [];
}
export function hasAssessment(c: Concept): boolean {
  return c.assessment.kind !== 'none-yet';
}
