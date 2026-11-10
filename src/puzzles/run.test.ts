import { describe, expect, it } from 'vitest';
import { hintSquare, startRun, submitMove, wrongMoveFor } from './run';
import type { Puzzle } from './types';

// Verbatim rows from the Lichess puzzle database (CC0).
const HANGING: Puzzle = {
  id: '00008',
  fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
  moves: 'f2g3 e6e7 b2b1 b3c1 b1c1 h6c1',
  rating: 1819, rd: 77, pop: 95, plays: 10446,
  themes: ['crushing', 'hangingPiece', 'long', 'middlegame'],
  game: 'game/787zsVup/black#48',
};
const MATE1: Puzzle = {
  id: '0000H',
  fen: 'r4rk1/pp3ppp/8/2bqp2b/3N4/P2Bn2P/1PPN1P2/R1BQ1RK1 w - - 1 15',
  moves: 'd1h5 d5g2',
  rating: 1032, rd: 78, pop: 100, plays: 92,
  themes: ['mate', 'mateIn1', 'middlegame', 'oneMove'],
  game: 'game/EwHRkfas#29',
};

describe('puzzle run', () => {
  it('plays the opponent setup move first; the solver is the other side', () => {
    const run = startRun(HANGING);
    expect(run.solver).toBe('white');
    expect(run.setupMove).toBe('f2g3');
    expect(run.fen.split(' ')[1]).toBe('w');
    expect(run.fen.startsWith('r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2b1/PqP3PP/7K')).toBe(true);
  });

  it('advances through solver moves and forced replies to solved', () => {
    let run = startRun(HANGING);
    let r = submitMove(run, 'e6e7');
    expect(r.verdict).toBe('correct');
    expect(r.reply).toBe('b2b1');
    run = r.run;
    r = submitMove(run, 'b3c1');
    expect(r.verdict).toBe('correct');
    expect(r.reply).toBe('b1c1');
    r = submitMove(r.run, 'h6c1');
    expect(r.verdict).toBe('solved');
    expect(r.run.done).toBe(true);
    expect(r.run.mistakes).toBe(0);
  });

  it('marks a different legal move wrong and leaves the position unchanged', () => {
    const run = startRun(HANGING);
    const r = submitMove(run, 'h6f6');
    expect(r.verdict).toBe('wrong');
    expect(r.run.fen).toBe(run.fen);
    expect(r.run.mistakes).toBe(1);
    expect(r.run.firstMove).toBe('h6f6');
    expect(r.run.done).toBe(false);
  });

  it('accepts any move that delivers checkmate, not only the source move', () => {
    const twoMates: Puzzle = {
      ...MATE1, id: 'two-mates',
      fen: '6k1/5ppp/8/8/8/8/8/RR4K1 b - - 0 1', moves: 'g8h8 a1a8',
    };
    const run = startRun(twoMates);
    const alt = submitMove(run, 'b1b8'); // also checkmate
    expect(alt.verdict).toBe('solved');
    expect(alt.run.acceptedAlternative).toBe(true);
    expect(submitMove(run, 'a1a8').verdict).toBe('solved');
  });

  it('solves the source mate in one', () => {
    const r = submitMove(startRun(MATE1), 'd5g2');
    expect(r.verdict).toBe('solved');
    expect(r.run.acceptedAlternative).toBe(false);
  });

  it('treats both castling spellings as the same answer', () => {
    const legal: Puzzle = {
      ...MATE1, id: 'castle',
      fen: 'r3k2r/7p/8/8/8/8/8/R3K2R b KQkq - 0 1', moves: 'h7h6 e1g1 h6h5 a1a8',
    };
    const run = startRun(legal);
    expect(submitMove(run, 'e1h1').verdict).toBe('correct');
  });

  it('throws on an illegal submission rather than scoring it', () => {
    expect(() => submitMove(startRun(HANGING), 'h1h3')).toThrow(/illegal/i);
  });

  it('hint names the origin square of the expected move and is counted', () => {
    const run = startRun(HANGING);
    const h = hintSquare(run);
    expect(h.square).toBe('e6');
    expect(h.run.hints).toBe(1);
  });

  it('wrongMoveFor returns a legal move that is scored wrong', () => {
    const run = startRun(HANGING);
    expect(submitMove(run, wrongMoveFor(run)).verdict).toBe('wrong');
    const mate = startRun(MATE1);
    expect(submitMove(mate, wrongMoveFor(mate)).verdict).toBe('wrong');
  });
});
