import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import type { GameRecord } from '../games/types';
import type { OpeningNames } from '../openings/names';
import { openingOf } from '../openings/names';
import {
  afterOpening, castlingOf, clockCurves, cohortGames, conversion, endings, endOf, lossMap, mainLine, nodeAt, openingFamilies, openingTree, puzzleBands, puzzleThemes, resultsOf, ribbonOf, ribbons,
  standingAfter, tacticsBothWays, thinkTime, topMotif, turningMove,
} from './deep';

// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O Nf6 5.d3 d6 6.c3 O-O (castling written king-takes-rook)
const ITALIAN = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1h1', 'g8f6', 'd2d3', 'd7d6', 'c2c3', 'e8h8'];
// 1.e4 c6 2.d4 d5
const CARO = ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4'];
const key = (sans: string) => sans; // keys below are the app's positionKey strings
const NAMES: OpeningNames = {
  manifest: { id: 'opening-names', version: 't', source: { url: '', commit: 't', license: 'CC0-1.0' }, counts: { names: 3, positions: 3 } },
  names: ['Italian Game', 'Italian Game: Giuoco Piano', 'Caro-Kann Defense'],
  positions: {
    [key('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -')]: 0,
    [key('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -')]: 1,
    [key('rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -')]: 2,
  },
};

let n = 0;
function game(p: Partial<GameRecord> & { wps?: number[]; losses?: number[] }): GameRecord {
  n++;
  const color = p.color ?? 'white';
  const moves = p.moves ?? ITALIAN;
  const myPlies = moves.map((_, i) => i).filter((i) => (i % 2 === 0) === (color === 'white'));
  const wps = p.wps ?? myPlies.map(() => 50);
  const losses = p.losses ?? myPlies.map(() => 0);
  const decisions = myPlies.slice(0, wps.length).map((ply, i) => [ply, losses[i] ?? 0, p.clocks ? p.clocks[ply] ?? null : null] as [number, number, number | null]);
  const measure = { decisions, events: [], facts: decisions.map(([ply], i) => ({ ply, wp: wps[i]!, played: 0, best: 0 })) };
  return {
    id: `g${n}`, source: 'chess.com', url: null, date: `2026-10-${String(n % 28 + 1).padStart(2, '0')}`, endDate: `2026-10-${String(n % 28 + 1).padStart(2, '0')}`, endTime: null,
    timeControl: '600+5', timeClass: 'rapid', color, result: 'win', termination: 'me won by resignation', playerRating: 500, opponentRating: 500, opponent: 'x', moves, clocks: null,
    analysis: measure, rated: true, importedAt: 1, updatedAt: 1, analysisKey: 'k', majorLoss: 20, measure, measureKey: 'k', ...p,
  } as GameRecord;
}

describe('openings', () => {
  it('names a game by the deepest named position it reached', () => {
    expect(openingOf(ITALIAN, NAMES)).toEqual({ name: 'Italian Game: Giuoco Piano', family: 'Italian Game', ply: 6 });
    expect(openingOf(CARO, NAMES)?.family).toBe('Caro-Kann Defense');
    expect(openingOf(['g2g4'], NAMES)).toBeNull();
  });

  it('builds a tree of his first moves with one colour, most played first, with results and names on the way', () => {
    const gs = [game({ result: 'win' }), game({ result: 'loss' }), game({ moves: CARO, result: 'draw' }), game({ color: 'black', moves: CARO })];
    const t = openingTree(gs, 'white', NAMES);
    expect(t.games).toHaveLength(3);
    expect(t.children.map((c) => [c.san, c.games.length])).toEqual([['e4', 3]]);
    expect(t.children[0]!.children.map((c) => c.san)).toEqual(['e5', 'c6']);
    expect(nodeAt(t, ['e4', 'c6'])).toMatchObject({ name: 'Caro-Kann Defense', results: { n: 1, d: 1, score: 0.5 } });
    expect(nodeAt(t, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])).toMatchObject({ name: 'Italian Game: Giuoco Piano', results: { w: 1, l: 1 } });
    expect(mainLine(t).map((x) => x.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    expect(nodeAt(t, ['d4'])).toBeNull();
  });

  it('families most played first; past the top ones the rest are one row', () => {
    const gs = [game({}), game({}), game({ moves: CARO }), game({ moves: ['g2g4', 'e7e5'] })];
    expect(openingFamilies(gs, 'white', NAMES).map((r) => [r.family, r.games.length])).toEqual([['Italian Game', 2], ['Caro-Kann Defense', 1], ['Unnamed opening', 1]]);
    expect(openingFamilies(gs, 'white', NAMES, 1).map((r) => [r.family, r.games.length])).toEqual([['Italian Game', 2], ['Other openings', 2]]);
  });

  it('the standing after move 10 is his expected score before move 11; a game over before it has none', () => {
    const long = [...ITALIAN, 'a2a3', 'a7a6', 'b2b3', 'b7b6', 'h2h3', 'h7h6', 'g2g3', 'g7g6', 'a3a4', 'a6a5', 'b3b4', 'a5b4'];
    const g = game({ moves: long, wps: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 71, 30] });
    expect(standingAfter(g)).toBe(71);
    expect(standingAfter(game({}))).toBeNull();
    const rows = afterOpening([g, game({ moves: long, wps: Array(12).fill(35) }), game({ moves: long })], 'white', NAMES, 4, 2);
    expect(rows.all).toMatchObject({ ahead: 1, behind: 1 });
    expect(rows.all.points).toHaveLength(3);
    expect(rows.families.map((f) => [f.label, f.points.length])).toEqual([['Italian Game', 3]]);
  });
});

describe('tactics', () => {
  const event = (e: object) => ({ ply: 0, fen: '', played: '', playedSan: '', best: '', bestSan: '', bestLine: '', bestWp: 60, secondWp: 40, playedWp: 20, loss: 40, clock: null, opportunity: null, missed: false, majorError: false, errorLabel: null, refutation: null, drill: false, ...e });

  it('each motif both ways, and where the pieces fell with Black\'s squares mirrored so his side is at the bottom', () => {
    const hung = event({ fen: '4k3/8/8/8/8/8/8/3RK3 w - - 0 1', played: 'd1d7', majorError: true, errorLabel: 'loses-material', refutation: '1... Kxd7 2. Ke2' });
    const hungBlack = event({ fen: '3rk3/8/8/8/8/8/8/4K3 b - - 0 1', played: 'd8d2', majorError: true, errorLabel: 'loses-material', refutation: '2. Kxd2 Ke7' });
    const chance = event({ fen: '4k3/8/8/4n3/8/8/4R3/4K3 w - - 0 1', played: 'e1d1', best: 'e2e5', bestLine: '1. Rxe5+', opportunity: 'material', missed: true });
    const gs = [game({ analysis: { decisions: [], events: [hung, chance] } as never }), game({ color: 'black', analysis: { decisions: [], events: [hungBlack] } as never })];
    const { rows, events } = tacticsBothWays(gs);
    const h = rows.find((r) => r.motif === 'hanging')!;
    expect([h.against.length, h.taken.length, h.missed.length]).toEqual([2, 0, 1]);
    expect(topMotif(rows)?.motif).toBe('hanging');
    const map = lossMap(events);
    // White's rook on d7 and Black's rook on d2, which is Black's own seventh rank: both on d7.
    expect(map.squares).toEqual({ d7: 2 });
    expect(map.pieces.rook).toBe(2);
    expect(map.total).toBe(2);
  });

  it('puzzle themes and rating bands, first looks only, lowest share first', () => {
    const at = (themes: string[], rating: number, ok: boolean, i: number) => ({ uuid: `u${i}`, exerciseKind: 'puzzle', exerciseId: `lichess:p${i}`, fresh: true, outcome: ok ? 'success' : 'fail', themes, rating, ts: i, context: 'practice', hints: 0 }) as unknown as Attempt;
    const xs = [...Array(6)].map((_, i) => at(['fork', 'short'], 1210 + i, i < 2, i)).concat([...Array(5)].map((_, i) => at(['pin', 'middlegame'], 1450, i < 4, 10 + i)));
    const rows = puzzleThemes(xs, { fork: 1, pin: 1, short: 1 });
    expect(rows.map((r) => [r.theme, r.rate.k, r.rate.n])).toEqual([['fork', 2, 6], ['pin', 4, 5]]);
    expect(puzzleBands(xs).map((b) => [b.lo, b.rate.k, b.rate.n])).toEqual([[1200, 2, 6], [1400, 4, 5]]);
  });
});

describe('strategy', () => {
  it('a game as a row of its standings, with the move that lost the most when it was a big mistake', () => {
    const r = ribbonOf(game({ wps: [50, 55, 60, 20, 15, 10], losses: [0, 0, 2, 38, 3, 1] }));
    expect(r.cells.map((c) => c.wp)).toEqual([50, 55, 60, 20, 15, 10]);
    expect(r.turn).toEqual({ move: 4, ply: 6, loss: 38 });
    expect(ribbonOf(game({ losses: [0, 0, 19, 0, 0, 0] })).turn).toBeNull();
    const rs = ribbons([game({ losses: [0, 0, 0, 30, 0, 0] }), game({ losses: [0, 25, 0, 0, 0, 0] }), game({})]);
    expect(rs.map((x) => x.turn?.move ?? null)).toEqual([null, 2, 4]);
    expect(turningMove(rs)).toEqual({ move: 3, games: 2 });
  });

  it('winning positions converted and lost positions saved', () => {
    const c = conversion([game({ wps: [50, 80], result: 'win' }), game({ wps: [50, 80, 20], result: 'loss' }), game({ wps: [10], result: 'draw' }), game({ wps: [50], result: 'loss' })]);
    expect([c.winning.games.length, c.winning.won.length]).toEqual([2, 1]);
    expect([c.losing.games.length, c.losing.saved.length]).toEqual([2, 1]);
  });

  it('when and where he castled; a castling move of the opponent does not count', () => {
    const cs = castlingOf([game({}), game({ color: 'black' }), game({ moves: CARO })]);
    expect(cs.map((c) => [c.move, c.side])).toEqual([[4, 'king'], [6, 'king'], [null, null]]);
  });

  it('clock left as a share of the start, his and his opponents\', while enough games go on', () => {
    const clocks = [590, 600, 570, 580, 560, 500];
    const gs = [game({ clocks }), game({ clocks }), game({ clocks: clocks.slice(0, 2) })];
    const c = clockCurves(gs, 2);
    expect(c.you.map((p) => [p.move, Math.round(p.median * 100), p.n])).toEqual([[1, 98, 3], [2, 95, 2], [3, 93, 2]]);
    expect(c.them.map((p) => p.move)).toEqual([1, 2, 3]);
    expect(clockCurves([game({ clocks, timeClass: 'daily' })], 1).games).toBe(0);
  });

  it('thinking time from move 11, undecided positions only, with the big mistakes in each group', () => {
    const long = [...ITALIAN, 'a2a3', 'a7a6', 'b2b3', 'b7b6', 'h2h3', 'h7h6', 'g2g3', 'g7g6', 'a3a4', 'a6a5', 'b3b4', 'a5b4'];
    const clocks = long.map((_, i) => 600 - 3 * i);
    // His move 11 (ply 20) took 30 s and lost 25 points; move 12 (ply 22) took 2 s in a won position.
    clocks[20] = clocks[18]! - 30 + 5;
    clocks[22] = clocks[20]! - 2 + 5;
    const wps = [...Array(10).fill(50), 50, 95];
    const losses = [...Array(10).fill(0), 25, 0];
    const t = thinkTime([game({ moves: long, clocks, wps, losses })]);
    expect(t.moves).toBe(1);
    expect(t.rows.map((r) => [r.key, r.decisions, r.errors])).toEqual([['u5', 0, 0], ['u15', 0, 0], ['u60', 1, 1], ['o60', 0, 0]]);
    expect(t.median).toBe(30);
  });

  it('how games ended, from Chess.com\'s words', () => {
    expect(endOf(game({ termination: 'opp won on time' }))).toBe('time');
    expect(endOf(game({ termination: 'me won by checkmate' }))).toBe('mate');
    expect(endOf(game({ termination: 'me won - game abandoned' }))).toBe('abandon');
    const e = endings([game({ result: 'loss', termination: 'opp won on time' }), game({}), game({ result: 'draw', termination: 'Game drawn by agreement' })]);
    expect(e.rows.map((r) => [r.key, r.wins.length, r.losses.length])).toEqual([['mate', 0, 0], ['resign', 1, 0], ['time', 0, 1], ['abandon', 0, 0]]);
    expect([e.wins, e.losses, e.draws.length]).toEqual([1, 1, 1]);
  });

  it('the cohorts: rated rapid only, or every game with moves; results count points', () => {
    const gs = [game({ timeClass: 'blitz' }), game({ rated: false }), game({}), game({ moves: [] })];
    expect(cohortGames(gs, 'rapid')).toHaveLength(1);
    expect(cohortGames(gs, 'all')).toHaveLength(3);
    expect(resultsOf([game({}), game({ result: 'draw' }), game({ result: 'loss' })])).toMatchObject({ n: 3, w: 1, d: 1, l: 1, score: 0.5 });
  });
});
