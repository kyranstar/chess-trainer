export interface Source {
  id: string;
  title: string;
  author: string;
  provider: string;
  url: string;
  permission: 'link' | 'cc0' | 'licensed' | 'user-authored' | 'public-domain-reviewed';
  licenseNotes: string;
  jurisdiction?: string;
  onlineRequired: boolean;
}

export interface LessonLink {
  sourceId: 'lichess-practice' | 'chesscom-lessons' | 'chessreps';
  title: string;
  author?: string;
  level?: string;
  url: string;
  fallbackUrl?: string;
  access: string;
  verified: string;
  note?: string;
}

export type Assessment =
  | { kind: 'unseen-puzzles'; themes: string[] }
  | { kind: 'opening-puzzles'; openings: string[]; note?: string }
  | { kind: 'none-yet'; reason?: string };

export interface Concept {
  id: string;
  title: string;
  area: string;
  order: number;
  week: number | null;
  prereqs: string[];
  descriptionTheme: string | null;
  themes: string[];
  localLessons: string[];
  links: LessonLink[];
  assessment: Assessment;
  stepsMethod: string | null;
  revision: number;
}

interface PositionStep {
  fen: string;
  orientation: 'white' | 'black';
  diagram?: number;
  fromMoves?: string[];
}
export type LessonStep =
  | { type: 'text'; paragraphs: string[] }
  | ({ type: 'board' } & PositionStep)
  | ({ type: 'try'; moves: string[]; before?: string[]; after: string[] } & PositionStep);

export interface Lesson {
  id: string;
  conceptId: string;
  sourceId: string;
  title: string;
  locator: string;
  revision: number;
  estMinutes: number;
  notationNote?: string;
  review: { textCheck: string; moveCheck: string; ownerReview: 'pending' | 'approved' };
  steps: LessonStep[];
}
