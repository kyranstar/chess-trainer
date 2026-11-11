import { describe, expect, it } from 'vitest';
import { fenAfter, positionKey } from '../chess/rules';
import { COURSES, courseFor, leftRepertoire, needsConfirming } from './courses';
import { suggestForGaps } from './fromGames';
import { entryId, type OpeningBook, type RepertoireEntry, START_FEN } from './repertoire';

const key = (ucis: string[]) => positionKey(fenAfter(START_FEN, ucis));
const e = (side: 'white' | 'black', line: string[], path: string[], uci: string, san: string, source?: RepertoireEntry['source']): RepertoireEntry => {
  const fen = fenAfter(START_FEN, line);
  return { id: entryId(side, positionKey(fen)), side, positionKey: positionKey(fen), fen, uci, san, path, addedAt: 1, updatedAt: 1, ...(source ? { source } : {}) };
};

describe('the openings his courses cover', () => {
  it('every course has a link, a side and the moves that define its opening', () => {
    expect(COURSES.length).toBeGreaterThan(0);
    for (const c of COURSES) {
      expect(c.url).toMatch(/^https:\/\/www\.chessreps\.com\//);
      expect(c.root.length).toBeGreaterThan(0);
      expect(['white', 'black']).toContain(c.side);
    }
  });

  it('a position belongs to the course whose opening it is in, the most specific one first, and only for the side the course is for', () => {
    expect(courseFor('white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])?.id).toBe('italian');
    expect(courseFor('white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'])?.id).toBe('fried-liver');
    expect(courseFor('white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5'])?.id).toBe('fried-liver');
    expect(courseFor('white', ['e4', 'c6'])?.id).toBe('caro-kann');
    expect(courseFor('black', ['d4', 'd5', 'c4'])?.id).toBe('qga');
    // The move that enters the opening is his own choice, not the course's territory.
    expect(courseFor('white', ['e4', 'e5', 'Nf3', 'Nc6'])).toBeNull();
    expect(courseFor('white', ['e4', 'c5'])).toBeNull();
    expect(courseFor('black', ['e4', 'c6'])).toBeNull();
  });

  it('a move the app put in is not drilled inside a course’s opening until he has confirmed it', () => {
    const habit = e('white', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], 'd2d3', 'd3', 'own-games');
    expect(needsConfirming(habit)).toBe(true);
    expect(needsConfirming({ ...habit, source: undefined })).toBe(false); // recorded by him: it is his move
    expect(needsConfirming(e('white', ['e2e4', 'c7c5'], ['e4', 'c5'], 'g1f3', 'Nf3', 'suggested'))).toBe(false); // no course there
  });
});

describe('no suggestions of the app’s own inside a course’s opening', () => {
  const mv = (uci: string, san: string, n: [number, number], wp?: number) => ({ uci, san, n, wp });
  const pos = (moves: ReturnType<typeof mv>[], bestWp?: number) => ({ n: [moves.reduce((t, m) => t + m.n[0]!, 0), moves.reduce((t, m) => t + m.n[1]!, 0)], moves, bestWp });
  const book: OpeningBook = {
    manifest: { id: 'openings-lichess', version: 't', bands: [0, 1000], source: { month: 't', license: 'CC0-1.0', url: '' }, games: { used: 1000 }, filters: {} },
    positions: {
      [key([])]: pos([mv('e2e4', 'e4', [100, 100], 52)], 53),
      [key(['e2e4'])]: pos([mv('c7c6', 'c6', [50, 50], 47), mv('c7c5', 'c5', [50, 50], 48)], 48),
      [key(['e2e4', 'c7c6'])]: pos([mv('d2d4', 'd4', [100, 100], 55)], 55),
      [key(['e2e4', 'c7c5'])]: pos([mv('g1f3', 'Nf3', [100, 100], 54)], 54),
    },
  };
  it('the Caro-Kann is left to the course; the Sicilian, which no course of his covers, gets a suggestion', () => {
    const mine = [e('white', [], [], 'e2e4', 'e4')];
    const r = suggestForGaps(book, mine, 'white', [0], 9, undefined, undefined, (gap) => !!courseFor('white', gap.path));
    expect(r.map((x) => `${x.path.join(' ')} → ${x.san}`)).toEqual(['e4 c5 → Nf3']);
  });
});

describe('where recent games left the repertoire', () => {
  const confirmed = [
    e('white', [], [], 'e2e4', 'e4'),
    e('white', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], 'c2c3', 'c3'),
    // Not confirmed: says nothing about what he should have played.
    e('white', ['e2e4', 'e7e5'], ['e4', 'e5'], 'g1f3', 'Nf3', 'own-games'),
  ];
  const g = (id: string, date: string, moves: string, color: 'white' | 'black' = 'white') => ({ id, date, color, moves: moves.split(' ') });

  it('names the first move of a game that differs from a move he recorded or confirmed, newest game first, with the course to review', () => {
    const r = leftRepertoire([
      g('a', '2026-11-01', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 d2d3 g8f6'),
      g('b', '2026-11-03', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3'), // followed it
      g('c', '2026-11-05', 'd2d4 d7d5'), // left it on move one
      g('d', '2026-11-04', 'e2e4 e7e5 g1f3', 'black'), // no black repertoire recorded
    ], confirmed);
    expect(r.map((x) => [x.gameId, x.date, x.path.join(' '), x.playedSan, x.mineSan, x.course?.id ?? null])).toEqual([
      ['c', '2026-11-05', '', 'd4', 'e4', null],
      ['a', '2026-11-01', 'e4 e5 Nf3 Nc6 Bc4 Bc5', 'd3', 'c3', 'italian'],
    ]);
  });

  it('is empty when the games follow the repertoire', () => {
    expect(leftRepertoire([g('b', '2026-11-03', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3')], confirmed)).toEqual([]);
  });
});
