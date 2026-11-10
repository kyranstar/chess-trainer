/** Curated content shipped inside the app bundle (available offline with the app shell). */
import conceptsJson from '../../content/concepts.json';
import sourcesJson from '../../content/sources.json';
import themesJson from '../../content/themes.json';
import type { Concept, Lesson, Source } from './types';

const lessonModules = import.meta.glob<Lesson>('../../content/lessons/*.json', { eager: true, import: 'default' });

export const CONCEPTS: Concept[] = (conceptsJson.concepts as unknown as Concept[]).slice().sort((a, b) => a.order - b.order);
export const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
export const LESSONS: Lesson[] = Object.values(lessonModules);
export const LESSON_BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
export const SOURCES = sourcesJson.sources as unknown as Source[];
export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const THEMES = themesJson.themes as Record<string, { name: string; description: string }>;

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
