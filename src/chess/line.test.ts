import { describe, expect, it } from 'vitest';
import { lineSan } from '../games/analyse';
import { lineAt, ucisOfSanLine } from './line';

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
