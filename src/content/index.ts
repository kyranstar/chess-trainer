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
const ALTERNATIVES = new Map<string, { uci: string; san: string }[]>();
for (const l of (lessonEvidence as { lessons: { lesson: string; tries: { step: number; fen: string; alternatives?: { uci: string; san: string }[] }[] }[] }).lessons) {
  for (const t of l.tries) ALTERNATIVES.set(`${l.lesson}|${t.step}|${boardKey(t.fen)}`, t.alternatives ?? []);
}

/**
 * Moves the engine check found as good as the text's move in a lesson example (same test the
 * text's move had to pass). The lesson asks for the text's move, but one of these is not a
 * mistake and is never recorded as one. `step` is the 1-based step number.
 */
export function lessonAlternatives(lessonId: string, step: number, fen: string): { uci: string; san: string }[] {
  return ALTERNATIVES.get(`${lessonId}|${step}|${boardKey(fen)}`) ?? [];
}

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
