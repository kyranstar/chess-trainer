import { describe, expect, it } from 'vitest';
import { applyUci, fenAfter, isCheckmate, legalDests, positionFromFen, positionKey, sanOf, turnOf } from './rules';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('rules (chessops is the single source of truth)', () => {
  it('lists 20 legal moves from the initial position', () => {
    const dests = legalDests(positionFromFen(START));
    let n = 0;
    for (const v of dests.values()) n += v.length;
    expect(n).toBe(20);
  });

  it('rejects an invalid FEN', () => {
    expect(() => positionFromFen('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
  });

  it('rejects illegal moves and castling through check', () => {
    expect(() => applyUci(positionFromFen(START), 'e2e5')).toThrow(/illegal/i);
    // f1 is attacked by the bishop on a6: white may not castle short.
    const pos = positionFromFen('4k3/8/b7/8/8/8/8/4K2R w K - 0 1');
    expect(() => applyUci(pos, 'e1g1')).toThrow(/illegal/i);
  });

  it('accepts castling written king-two-squares or king-takes-rook', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(fenAfter(fen, ['e1g1'])).toBe(fenAfter(fen, ['e1h1']));
    expect(sanOf(positionFromFen(fen), 'e1g1')).toBe('O-O');
  });

  it('plays en passant only when legal', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3';
    const after = fenAfter(fen, ['d4e3']);
    expect(after.startsWith('rnbqkbnr/ppp1pppp/8/8/8/4p3/PPPP1PPP/RNBQKBNR w')).toBe(true);
  });

  it('supports underpromotion', () => {
    const fen = '8/5P1k/8/8/8/8/8/K7 w - - 0 1';
    expect(sanOf(positionFromFen(fen), 'f7f8n')).toBe('f8=N+');
    expect(() => applyUci(positionFromFen(fen), 'f7f8')).toThrow(/illegal/i);
  });

  it('detects checkmate and stalemate apart', () => {
    expect(isCheckmate(positionFromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe(false); // stalemate
    expect(isCheckmate(positionFromFen('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1'))).toBe(true);
  });

  it('positionKey ignores move counters and irrelevant en passant squares', () => {
    const a = positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const b = positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 5 9');
    expect(a).toBe(b); // no black pawn can capture on e3
    const c = positionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3');
    const d = positionKey('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
    expect(c).not.toBe(d); // here en passant is legally available
  });

  it('reports side to move', () => {
    expect(turnOf(START)).toBe('white');
  });
});
