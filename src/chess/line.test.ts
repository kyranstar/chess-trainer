import { describe, expect, it } from 'vitest';
import { lineSan } from '../games/analyse';
import { consequenceOf, lineAt, ucisOfSanLine } from './line';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('a stored line can be played through on the board', () => {
  it('reads a printed line back into moves, whichever side starts', () => {
    const pv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
    expect(ucisOfSanLine(START, lineSan(START, pv))).toEqual(pv);
    const black = ['e7e5', 'g1f3', 'b8c6'];
    expect(ucisOfSanLine(BLACK_TO_MOVE, lineSan(BLACK_TO_MOVE, black))).toEqual(black);
  });

  it('reads castling, captures, promotion and check marks', () => {
    const fen = 'r3k2r/pP3ppp/8/8/8/8/5PPP/4K2R w Kkq - 0 1';
    const pv = ['b7a8q', 'e8e7', 'e1g1'];
    expect(ucisOfSanLine(fen, lineSan(fen, pv))).toEqual(pv);
  });

  it('stops at the first move it cannot read rather than guessing', () => {
    expect(ucisOfSanLine(START, '1. e4 e5 2. Qh8 Nc6')).toEqual(['e2e4', 'e7e5']);
    expect(ucisOfSanLine(START, '')).toEqual([]);
  });

  it('gives the position and the last move after any number of steps, and never runs past the end', () => {
    const pv = ['e2e4', 'e7e5'];
    expect(lineAt(START, pv, 0)).toEqual({ fen: START, last: null });
    expect(lineAt(START, pv, 1)).toEqual({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', last: 'e2e4' });
    expect(lineAt(START, pv, 9).last).toBe('e7e5');
    // An illegal move in the line: stay at the last position that could be reached.
    expect(lineAt(START, ['e2e4', 'e2e4'], 2).last).toBe('e2e4');
  });
});

describe('where a line is decided', () => {
  // After 1.e4 e5 2.Nf3 d6 3.Nxe5: the knight took a pawn and can be taken by the d-pawn.
  const BEFORE = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
  const AFTER = 'rnbqkbnr/ppp2ppp/3p4/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3';

  it('stops at the capture that settles it, names the piece and the square, and counts from before the learner’s own move', () => {
    const c = consequenceOf(AFTER, ['d6e5', 'b1c3', 'g8f6', 'f1c4'], 'white', BEFORE)!;
    expect(c).toMatchObject({ ply: 1, kind: 'material', square: 'e5' });
    // A pawn won, a knight lost: two points behind, not three.
    expect(c.text).toBe('Knight taken on e5. Over these moves you come out 2 points behind.');
    // The same line seen from the other side.
    expect(consequenceOf(AFTER, ['d6e5', 'b1c3', 'g8f6'], 'black', BEFORE)!.text).toBe('Knight taken on e5. Over these moves you come out 2 points ahead.');
  });

  it('claims nothing when the line stops on a capture: the recapture may be next', () => {
    expect(consequenceOf(AFTER, ['d6e5'], 'white', BEFORE)).toBeNull();
    expect(consequenceOf(AFTER, ['b8c6', 'e5c6'], 'white', BEFORE)).toBeNull();
  });

  it('claims nothing for an even exchange or a line with no capture', () => {
    // 1.e4 d5 2.exd5 Qxd5 3.Nc3: pawn for pawn.
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(consequenceOf(start, ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3'], 'white')).toBeNull();
    expect(consequenceOf(start, ['e2e4', 'e7e5', 'g1f3'], 'white')).toBeNull();
  });

  it('runs through a whole exchange to its last capture before saying who came out ahead', () => {
    // White takes a defended pawn with the knight, Black retakes, White retakes: knight and pawn for knight... 
    // 1.e4 e5 2.Nf3 Nc6 3.Nxe5 Nxe5 4.d4 (quiet): White gave a knight for a pawn.
    const start = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const c = consequenceOf(start, ['f3e5', 'c6e5', 'd2d4', 'e5c6'], 'white')!;
    expect(c).toMatchObject({ ply: 2, square: 'e5' });
    expect(c.text).toBe('Knight taken on e5. Over these moves you come out 2 points behind.');
  });

  it('stops at the capture that cost the piece, not at an even exchange that follows it', () => {
    // 3...dxe5 wins the knight; then bishop is exchanged for bishop on e6. The knight is the point.
    const c = consequenceOf(AFTER, ['d6e5', 'f1c4', 'c8e6', 'c4e6', 'f7e6', 'd2d3'], 'white', BEFORE)!;
    expect(c).toMatchObject({ ply: 1, square: 'e5' });
    expect(c.text).toBe('Knight taken on e5. Over these moves you come out 2 points behind.');
  });

  it('stops at checkmate and marks the king', () => {
    // Fool's mate: 1.f3 e5 2.g4 Qh4#.
    const start = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
    const c = consequenceOf(start, ['g2g4', 'd8h4'], 'white')!;
    expect(c).toMatchObject({ ply: 2, kind: 'mate', square: 'e1' });
    expect(c.text).toBe('Checkmate.');
  });

  it('counts a promotion, and an en passant capture as a pawn', () => {
    const promo = consequenceOf('8/4P1k1/8/8/8/8/6K1/8 w - - 0 1', ['e7e8q', 'g7f6', 'e8e4'], 'white')!;
    expect(promo).toMatchObject({ ply: 1, square: 'e8' });
    expect(promo.text).toBe('The pawn queens on e8. Over these moves you come out 8 points ahead.');
    // White pawn on e5, Black has just played d7-d5: exd6 e.p. takes the pawn on d5.
    const ep = consequenceOf('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', ['e5d6', 'e8d7', 'e1e2'], 'white')!;
    expect(ep).toMatchObject({ ply: 1, square: 'd6' });
    expect(ep.text).toBe('Pawn taken on d5. Over these moves you come out 1 point ahead.');
  });
});

