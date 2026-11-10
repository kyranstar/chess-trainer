import { describe, expect, it } from 'vitest';
import { fenAfter, positionKey } from '../chess/rules';
import { classifyMove, drillId, entryId, makeEntry, type OpeningBook, type RepertoireEntry, START_FEN, walkRepertoire } from './repertoire';

const START = START_FEN;
const key = (ucis: string[]) => positionKey(fenAfter(START, ucis));
// Two rating bands: index 0 = lower, index 1 = higher.
const mv = (uci: string, san: string, n: [number, number], wp?: number) => ({ uci, san, n, wp });
const pos = (moves: ReturnType<typeof mv>[], bestWp?: number) => ({ n: [moves.reduce((t, m) => t + m.n[0]!, 0), moves.reduce((t, m) => t + m.n[1]!, 0)], moves, bestWp });

/** Tiny book: 1.e4 (80%) / 1.d4; after 1.e4: e5 60%, c6 20%, c5 20% (lower band); two move orders into the Italian. */
const book: OpeningBook = {
  manifest: { id: 'openings-lichess', version: 't', bands: [0, 1000], source: { month: 't', license: 'CC0-1.0', url: '' }, games: { used: 1000 }, filters: {} },
  positions: {
    [key([])]: pos([mv('e2e4', 'e4', [80, 60], 52), mv('d2d4', 'd4', [20, 40], 52), mv('g2g4', 'g4', [0, 0], 38)], 53),
    [key(['e2e4'])]: pos([mv('e7e5', 'e5', [60, 30]), mv('c7c6', 'c6', [20, 30]), mv('c7c5', 'c5', [20, 40])]),
    [key(['e2e4', 'e7e5'])]: pos([mv('g1f3', 'Nf3', [90, 95], 54), mv('f1c4', 'Bc4', [10, 5], 52), mv('d1h5', 'Qh5', [5, 0], 41)], 55),
    [key(['e2e4', 'e7e5', 'g1f3'])]: pos([mv('b8c6', 'Nc6', [80, 90]), mv('d7d6', 'd6', [20, 10])]),
    [key(['e2e4', 'e7e5', 'f1c4'])]: pos([mv('b8c6', 'Nc6', [100, 100])]),
    [key(['e2e4', 'e7e5', 'g1f3', 'b8c6'])]: pos([mv('f1c4', 'Bc4', [70, 50], 53), mv('f1b5', 'Bb5', [30, 50], 55)], 55),
    [key(['e2e4', 'e7e5', 'f1c4', 'b8c6'])]: pos([mv('g1f3', 'Nf3', [100, 100], 53)], 55),
    [key(['e2e4', 'c7c6'])]: pos([mv('d2d4', 'd4', [100, 100], 55)], 55),
  },
};

function entry(side: 'white' | 'black', line: string[], uci: string, san: string): RepertoireEntry {
  const fen = fenAfter(START, line);
  return { id: entryId(side, positionKey(fen)), side, positionKey: positionKey(fen), fen, uci, san, path: [], addedAt: 1, updatedAt: 1 };
}

describe('repertoire walk (White, lower band)', () => {
  it('with no repertoire the only gap is the first move, reached in every game', () => {
    const w = walkRepertoire(book, [], 'white', [0]);
    expect(w.gaps).toHaveLength(1);
    expect(w.gaps[0]!.reach).toBe(1);
    expect(w.gaps[0]!.ply).toBe(0);
    expect(w.levels[0]).toMatchObject({ myMove: 1, answered: 0, gap: 1 });
  });

  it('weights the next gaps by how often opponents actually play into them', () => {
    const w = walkRepertoire(book, [entry('white', [], 'e2e4', 'e4')], 'white', [0]);
    expect(w.gaps.map((g) => [g.path.join(' '), Number(g.reach.toFixed(2))])).toEqual([
      ['e4 e5', 0.6],
      ['e4 c5', 0.2], // still a decision to make, even though the data ends after it
      ['e4 c6', 0.2],
    ]);
    expect(w.levels[1]).toMatchObject({ myMove: 2, answered: 0, beyondData: 0 });
    expect(w.levels[1]!.gap).toBeCloseTo(1);
  });

  it('uses the chosen rating band: stronger players answer 1.e4 differently', () => {
    const w = walkRepertoire(book, [entry('white', [], 'e2e4', 'e4')], 'white', [1]);
    expect(Number(w.gaps.find((g) => g.path.join(' ') === 'e4 e5')!.reach.toFixed(2))).toBe(0.3);
  });

  it('counts answered share per move number and follows the repertoire deeper', () => {
    const rep = [entry('white', [], 'e2e4', 'e4'), entry('white', ['e2e4', 'e7e5'], 'g1f3', 'Nf3'), entry('white', ['e2e4', 'c7c6'], 'd2d4', 'd4')];
    const w = walkRepertoire(book, rep, 'white', [0]);
    expect(w.levels[0]).toMatchObject({ myMove: 1, answered: 1 });
    expect(w.levels[1]!.answered).toBeCloseTo(0.8); // e5 and c6 answered
    expect(w.levels[1]!.gap).toBeCloseTo(0.2); // c5 not answered
    // After 1.e4 c6 2.d4 the data has nothing on Black's replies: that share is reported, not hidden.
    expect(w.levels[2]!.beyondData).toBeCloseTo(0.2);
    const third = w.gaps.find((g) => g.path.join(' ') === 'e4 e5 Nf3 Nc6')!;
    expect(third.reach).toBeCloseTo(0.6 * 0.8);
    expect(w.decisions.filter((d) => d.entry).length).toBe(3);
  });

  it('merges transpositions: one position, one decision, combined reach', () => {
    // An (artificial) repertoire that reaches the Italian position by two move orders is still one decision there.
    const rep = [entry('white', [], 'e2e4', 'e4'), entry('white', ['e2e4', 'e7e5'], 'f1c4', 'Bc4'), entry('white', ['e2e4', 'e7e5', 'f1c4', 'b8c6'], 'g1f3', 'Nf3')];
    const w = walkRepertoire(book, rep, 'white', [0]);
    const italianKey = key(['e2e4', 'e7e5', 'f1c4', 'b8c6']);
    expect(w.decisions.filter((d) => d.positionKey === italianKey)).toHaveLength(1);
  });
});

describe('repertoire walk (Black)', () => {
  it('starts from the opponent’s first move and asks for replies in order of frequency', () => {
    const w = walkRepertoire(book, [], 'black', [0]);
    expect(w.gaps.map((g) => [g.path.join(' '), g.reach])).toEqual([['e4', 0.8], ['d4', 0.2]]);
  });
});

describe('engine evidence for a chosen move', () => {
  it('a move close to the best listed evaluation is sound', () => {
    expect(classifyMove(book, key(['e2e4', 'e7e5', 'g1f3', 'b8c6']), 'f1c4')).toMatchObject({ verdict: 'sound', wp: 53, bestWp: 55 });
  });
  it('a move far below it is flagged as weaker, with the numbers', () => {
    expect(classifyMove(book, key(['e2e4', 'e7e5']), 'd1h5')).toMatchObject({ verdict: 'weaker', wp: 41, bestWp: 55 });
  });
  it('a move with no data or no evaluation is unknown, never called bad', () => {
    expect(classifyMove(book, key(['e2e4', 'e7e5']), 'a2a3').verdict).toBe('unknown');
    expect(classifyMove(book, key(['e2e4']), 'e7e5').verdict).toBe('unknown');
    expect(classifyMove(book, 'nope', 'e2e4').verdict).toBe('unknown');
  });
});

describe('audit regressions', () => {
  it('a changed repertoire move gets its own review identity, so it starts unlearned', () => {
    const e4 = makeEntry('white', START_FEN, [], 'e2e4', 1);
    const d4 = makeEntry('white', START_FEN, [], 'd2d4', 2);
    expect(e4.id).toBe(d4.id); // same position, one decision
    expect(drillId(e4)).not.toBe(drillId(d4));
  });

  it('castling is stored and looked up in one spelling', () => {
    const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(makeEntry('white', fen, [], 'e1h1', 1).uci).toBe('e1g1');
    expect(makeEntry('white', fen, [], 'e1g1', 1).san).toBe('O-O');
    const k = positionKey(fen);
    const castleBook: OpeningBook = { ...book, positions: { [k]: pos([mv('e1g1', 'O-O', [10, 10], 52)], 53) } };
    expect(classifyMove(castleBook, k, 'e1h1').verdict).toBe('sound');
  });
});
