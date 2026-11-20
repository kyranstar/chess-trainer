import { describe, expect, it } from 'vitest';
import { firstLoss, motifEvents, motifOfMove } from './motifs';
import type { GameEvent, GameRecord } from './types';

describe('a move is named by what it does on the board', () => {
  it('takes a piece that could be taken for nothing', () => {
    expect(motifOfMove('4k3/8/8/4n3/8/8/4R3/4K3 w - - 0 1', 'e2e5')).toBe('hanging');
  });
  it('a defended piece taken with a piece worth more is not "hanging"', () => {
    expect(motifOfMove('4k3/3p4/4n3/8/8/8/4Q3/4K3 w - - 0 1', 'e2e6')).not.toBe('hanging');
  });
  it('a knight that attacks the king and a rook at once is a fork', () => {
    expect(motifOfMove('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')).toBe('fork');
  });
  it('two defended pieces worth no more than the attacker are not forked', () => {
    // The knight on c7 attacks two defended knights: nothing is won by attacking them.
    expect(motifOfMove('7k/1p3p2/n3n3/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')).toBe('other');
  });
  it('a bishop that holds a knight against its king is a pin', () => {
    expect(motifOfMove('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5')).toBe('pin');
  });
  it('a rook check with the queen behind the king is a skewer, counted with pins', () => {
    expect(motifOfMove('8/1k4q1/8/8/8/8/8/R3K3 w - - 0 1', 'a1a7')).toBe('pin');
  });
  it('a knight that steps off the bishop\'s line onto nothing is a discovered attack', () => {
    expect(motifOfMove('4k3/6q1/8/8/3N4/8/1B6/4K3 w - - 0 1', 'd4b5')).toBe('discovered');
  });
  it('anything else is "other", and an unreadable move too', () => {
    expect(motifOfMove('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1e2')).toBe('other');
    expect(motifOfMove('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1e5')).toBe('other');
  });
});

describe('the first piece of his taken along a line', () => {
  it('names the piece and the square, for either colour, en passant too', () => {
    expect(firstLoss('4k3/3R4/8/8/8/8/8/4K3 b - - 0 1', ['e8d7', 'e1e2'], 'white')).toEqual({ role: 'rook', square: 'd7' });
    expect(firstLoss('4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1', ['e4d3', 'e1e2'], 'white')).toEqual({ role: 'pawn', square: 'd4' });
    // On the last move of the line: not counted, the recapture may be next.
    expect(firstLoss('4k3/3R4/8/8/8/8/8/4K3 b - - 0 1', ['e8d7'], 'white')).toBeNull();
    expect(firstLoss('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['e1e2', 'e8e7'], 'white')).toBeNull();
  });
  it('a piece taken back at once is an exchange, not a loss', () => {
    // 1...Qxd1+ 2.Rxd1: queens traded. 1...Qxd1+ 2.Kf2: the queen is lost.
    expect(firstLoss('3qk3/8/8/8/8/8/8/R2QK3 b - - 0 1', ['d8d1', 'a1d1', 'e8e7'], 'white')).toBeNull();
    expect(firstLoss('3qk3/8/8/8/8/8/8/3Q1K2 b - - 0 1', ['d8d1', 'f1f2', 'e8e7'], 'white')).toEqual({ role: 'queen', square: 'd1' });
    // His game: 18.Be3?? Qxe3+ 19.Qxe3 Rxe3: the bishop is lost; the queens were traded.
    expect(firstLoss('4r1k1/pp3npp/2pp4/4q3/3r2P1/2Q1B3/PPP3PP/R4RK1 b - - 1 18', ['e5e3', 'c3e3', 'e8e3', 'g4g5'], 'white')).toEqual({ role: 'bishop', square: 'e3' });
  });
});

describe('big mistakes against him and chances for him, from a game\'s analysis', () => {
  const event = (e: Partial<GameEvent>): GameEvent => ({
    ply: 20, fen: '', played: '', playedSan: '', best: '', bestSan: '', bestLine: '', bestWp: 60, secondWp: 40, playedWp: 20, loss: 40, clock: null,
    opportunity: null, missed: false, majorError: false, errorLabel: null, refutation: null, drill: false, ...e,
  });
  const game = (events: GameEvent[]): GameRecord => ({ id: 'g', color: 'white', analysis: { decisions: [], events } } as unknown as GameRecord);

  it('a rook left where the king takes it is a hanging piece against him, the rook on d7 the piece lost', () => {
    const out = motifEvents([game([event({ fen: '4k3/8/8/8/8/8/8/3RK3 w - - 0 1', played: 'd1d7', playedSan: 'Rd7+', majorError: true, errorLabel: 'loses-material', refutation: '1... Kxd7 2. Ke2' })])]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ side: 'against', motif: 'hanging', lost: { role: 'rook', square: 'd7' } });
  });

  it('a check first and then the loose piece is still a hanging piece; the piece lost is the bishop, not the pawn on the way', () => {
    // His game: 6...Na5?? 7.Bxf7+ Kxf7 8.dxc5, the bishop on c5 was attacked by a pawn.
    const out = motifEvents([{ ...game([event({ fen: 'r1bqk1nr/1ppp1ppp/p1n5/2b5/2BPP3/5N2/PP3PPP/RNBQK2R b KQkq - 0 6', played: 'c6a5', playedSan: 'Na5', majorError: true, errorLabel: 'loses-material', refutation: '7. Bxf7+ Kxf7 8. dxc5 d5 9. exd5' })]), color: 'black' } as GameRecord]);
    expect(out[0]).toMatchObject({ side: 'against', motif: 'hanging', lost: { role: 'bishop', square: 'c5' } });
  });

  it('a free knight left on the board is a hanging-piece chance for him, missed', () => {
    const out = motifEvents([game([event({ fen: '4k3/8/8/4n3/8/8/4R3/4K3 w - - 0 1', played: 'e1d1', best: 'e2e5', bestLine: '1. Rxe5+', opportunity: 'material', missed: true })])]);
    expect(out).toEqual([expect.objectContaining({ side: 'for', motif: 'hanging', taken: false })]);
  });

  it('a mate allowed is "mate", whatever the first move of the line; a small mistake is not counted', () => {
    const out = motifEvents([game([
      event({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', played: 'g1f1', majorError: true, errorLabel: 'allows-mate', refutation: null }),
      event({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', played: 'g1h1', majorError: false, errorLabel: 'loses-material', refutation: null }),
    ])]);
    expect(out.map((x) => [x.side, x.motif])).toEqual([['against', 'mate']]);
  });
});
