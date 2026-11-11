import { describe, expect, it } from 'vitest';
import { fenAfter, positionKey } from '../chess/rules';
import { type GameLine, repertoireFromGames, suggestForGaps } from './fromGames';
import { entryId, type OpeningBook, type RepertoireEntry, START_FEN } from './repertoire';

const key = (ucis: string[]) => positionKey(fenAfter(START_FEN, ucis));
const mv = (uci: string, san: string, n: [number, number], wp?: number) => ({ uci, san, n, wp });
const pos = (moves: ReturnType<typeof mv>[], bestWp?: number, bestSan?: string) => ({ n: [moves.reduce((t, m) => t + m.n[0]!, 0), moves.reduce((t, m) => t + m.n[1]!, 0)], moves, bestWp, bestSan });

const book: OpeningBook = {
  manifest: { id: 'openings-lichess', version: 't', bands: [0, 1000], source: { month: 't', license: 'CC0-1.0', url: '' }, games: { used: 1000 }, filters: {} },
  positions: {
    [key([])]: pos([mv('e2e4', 'e4', [80, 60], 52), mv('d2d4', 'd4', [20, 40], 52)], 53),
    [key(['e2e4'])]: pos([mv('e7e5', 'e5', [60, 30], 48), mv('c7c6', 'c6', [20, 30], 47), mv('c7c5', 'c5', [20, 40], 48)], 48),
    [key(['e2e4', 'e7e5'])]: pos([mv('g1f3', 'Nf3', [70, 95], 54), mv('d1h5', 'Qh5', [25, 0], 41), mv('f1c4', 'Bc4', [5, 5], 52)], 55, 'Nf3'),
    [key(['e2e4', 'e7e5', 'g1f3'])]: pos([mv('b8c6', 'Nc6', [80, 90]), mv('d7d6', 'd6', [20, 10])]),
    [key(['e2e4', 'e7e5', 'g1f3', 'b8c6'])]: pos([mv('f1c4', 'Bc4', [70, 50], 53), mv('f1b5', 'Bb5', [30, 50], 55)], 55),
    [key(['e2e4', 'c7c6'])]: pos([mv('b1c3', 'Nc3', [60, 20], 50), mv('d2d4', 'd4', [40, 80], 55)], 55),
    // A position where the move most played at this level is a mistake by the engine check.
    [key(['e2e4', 'e7e5', 'g1f3', 'd7d6'])]: pos([mv('f1c4', 'Bc4', [30, 30], 55), mv('f3g5', 'Ng5', [70, 5], 40)], 56),
  },
};

const g = (color: 'white' | 'black', moves: string, date = '2026-11-01'): GameLine => ({ color, moves: moves.split(' '), date });
const sans = (es: RepertoireEntry[]) => es.map((e) => `${e.path.join(' ')}${e.path.length ? ' ' : ''}→ ${e.san}`).sort();

describe('the moves you already play, read from your own games', () => {
  const games = [
    g('white', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5'),
    g('white', 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6'),
    g('white', 'e2e4 e7e5 g1f3 b8c6 f1c4'),
    g('white', 'e2e4 e7e5 g1f3 b8c6 f1b5'),
    g('white', 'e2e4 c7c6 d2d4 d7d5'),
    g('white', 'e2e4 c7c6 d2d4'),
    g('white', 'd2d4 d7d5 c2c4'),
    g('black', 'e2e4 e7e5 g1f3 b8c6'),
    g('black', 'e2e4 e7e5 f1c4 g8f6'),
    g('black', 'e2e4 c7c5'),
    g('black', 'd2d4 d7d5 c2c4 d5c4'),
    g('black', 'd2d4 d7d5 g1f3'),
  ];

  it('takes the move played most in each position that the chosen moves lead to, when it was played at least twice', () => {
    const r = repertoireFromGames(games, book, [], 7);
    expect(sans(r.entries.filter((e) => e.side === 'white'))).toEqual(['e4 c6 → d4', 'e4 e5 Nf3 Nc6 → Bc4', 'e4 e5 → Nf3', '→ e4']);
    // As Black: an answer to each first move met at least twice. One game with 1...c5 does not count against 1...e5.
    expect(sans(r.entries.filter((e) => e.side === 'black'))).toEqual(['d4 → d5', 'e4 → e5']);
    const first = r.entries.find((e) => e.side === 'white' && e.path.length === 0)!;
    expect(first).toMatchObject({ source: 'own-games', games: { played: 6, reached: 7 }, uci: 'e2e4', addedAt: 7, id: entryId('white', key([])) });
    // The single game with 1.d4 is not followed, and one game is not a habit: nothing after 1.d4 d5 for White, nothing on move 2 for Black.
    expect(r.entries.some((e) => e.path[0] === 'd4' && e.side === 'white')).toBe(false);
  });

  it('never replaces a move you recorded yourself, and follows it instead of the games', () => {
    const fen = START_FEN;
    const mine: RepertoireEntry = { id: entryId('white', key([])), side: 'white', positionKey: key([]), fen, uci: 'd2d4', san: 'd4', path: [], addedAt: 1, updatedAt: 1 };
    const r = repertoireFromGames(games, book, [mine], 7);
    expect(r.entries.filter((e) => e.side === 'white')).toEqual([]); // only one game follows 1.d4
  });

  it('does not take over a habit that the engine check rates clearly below the best move; it is listed for you instead', () => {
    const qh5 = [g('white', 'e2e4 e7e5 d1h5 b8c6'), g('white', 'e2e4 e7e5 d1h5 g8f6'), g('white', 'e2e4 e7e5 g1f3')];
    const r = repertoireFromGames(qh5, book, [], 7);
    expect(sans(r.entries)).toEqual(['→ e4']);
    expect(r.doubtful).toEqual([{ side: 'white', positionKey: key(['e2e4', 'e7e5']), path: ['e4', 'e5'], san: 'Qh5', played: 2, reached: 3, bestSan: 'Nf3' }]);
  });

  it('reads castling as written in the games', () => {
    const line = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1 g8f6';
    const r = repertoireFromGames([g('white', line), g('white', line)], null, [], 7);
    expect(r.entries.find((e) => e.san === 'O-O')).toMatchObject({ uci: 'e1g1', path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] });
  });
});

describe('suggestions for the positions you will meet most and have no move for', () => {
  const e = (line: string[], uci: string, san: string): RepertoireEntry => {
    const fen = fenAfter(START_FEN, line);
    return { id: entryId('white', positionKey(fen)), side: 'white', positionKey: positionKey(fen), fen, uci, san, path: [], addedAt: 1, updatedAt: 1 };
  };
  const mine = [e([], 'e2e4', 'e4'), e(['e2e4', 'e7e5'], 'g1f3', 'Nf3')];

  it('fills the most frequent gaps first with the sound move most played at this level, and marks each as a suggestion', () => {
    const r = suggestForGaps(book, mine, 'white', [0], 9);
    // After 1.e4 e5 2.Nf3: Nc6 (48% of games) then d6 (12%); after 1.e4: c6 (20%). 1...c5 has no data: nothing is made up.
    expect(r.map((x) => `${x.path.join(' ')} → ${x.san}`)).toEqual(['e4 e5 Nf3 Nc6 → Bc4', 'e4 c6 → d4', 'e4 e5 Nf3 d6 → Bc4']);
    expect(r.every((x) => x.source === 'suggested' && x.addedAt === 9)).toBe(true);
  });

  it('never suggests the popular move when the engine check rates it below the best by more than a small margin', () => {
    const r = suggestForGaps(book, mine, 'white', [0], 9);
    // After 1.e4 e5 2.Nf3 d6, Ng5 is played in 70% of games at this level and loses 16 points: Bc4 is suggested.
    expect(r.find((x) => x.path.join(' ') === 'e4 e5 Nf3 d6')!.san).toBe('Bc4');
    // After 1.e4 c6, Nc3 is the most played and 5 points below the best: good enough to keep as your own
    // habit, not good enough to be recommended. The suggestion is d4.
    expect(r.find((x) => x.path.join(' ') === 'e4 c6')!.san).toBe('d4');
  });

  it('stops at positions reached too rarely to matter, and at the cap', () => {
    expect(suggestForGaps(book, mine, 'white', [0], 9, { minReach: 0.15, max: 40 }).map((x) => x.san)).toEqual(['Bc4', 'd4']);
    expect(suggestForGaps(book, mine, 'white', [0], 9, { minReach: 0.01, max: 1 })).toHaveLength(1);
  });
});
