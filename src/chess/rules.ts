/**
 * Thin wrapper over chessops, the app's single authoritative rules library.
 * Nothing in the app decides legality, check, mate or draw status itself.
 */
import { Chess, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Color, Move, NormalMove } from 'chessops/types';
import { makeSquare, makeUci, moveEquals, parseUci } from 'chessops/util';

export type { Color };
export type Uci = string;

export function positionFromFen(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`Invalid FEN "${fen}": ${setup.error.message}`);
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw new Error(`Illegal position "${fen}": ${pos.error.message}`);
  return pos.value;
}

export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

export function turnOf(fen: string): Color {
  return positionFromFen(fen).turn;
}

function parseLegal(pos: Chess, uci: Uci): Move {
  const move = parseUci(uci);
  if (!move) throw new Error(`Illegal move: cannot parse "${uci}"`);
  if (!pos.isLegal(move)) throw new Error(`Illegal move ${uci} in ${fenOf(pos)}`);
  return move;
}

/** Plays `uci` on a copy and returns the new position. Throws if the move is not legal. */
export function applyUci(pos: Chess, uci: Uci): Chess {
  const move = parseLegal(pos, uci);
  const next = pos.clone();
  next.play(move);
  return next;
}

export function fenAfter(fen: string, ucis: Uci[]): string {
  let pos = positionFromFen(fen);
  for (const u of ucis) pos = applyUci(pos, u);
  return fenOf(pos);
}

export function sanOf(pos: Chess, uci: Uci): string {
  return makeSan(pos, parseLegal(pos, uci));
}

/** True when two UCI strings denote the same move here (e.g. e1g1 and e1h1 castling). */
export function sameMove(pos: Chess, a: Uci, b: Uci): boolean {
  const ma = parseUci(a);
  const mb = parseUci(b);
  if (!ma || !mb) return false;
  return moveEquals(normalizeMove(pos, ma), normalizeMove(pos, mb));
}

/** Canonical UCI (castling as king-takes-rook is normalised to the king's two-square form). */
export function canonicalUci(pos: Chess, uci: Uci): Uci {
  const move = parseLegal(pos, uci);
  const norm = normalizeMove(pos, move) as NormalMove;
  // chessops normalises castling to king-takes-rook; UCI convention is the king's destination.
  const king = pos.board.king.has(norm.from);
  const ownRook = pos.board.rook.has(norm.to) && pos.board[pos.turn].has(norm.to);
  if (king && ownRook) {
    const kingTo = norm.to > norm.from ? norm.from + 2 : norm.from - 2;
    return makeSquare(norm.from) + makeSquare(kingTo);
  }
  return makeUci(norm);
}

export function isLegalUci(pos: Chess, uci: Uci): boolean {
  const move = parseUci(uci);
  return !!move && pos.isLegal(move);
}

export function isCheckmate(pos: Chess): boolean {
  return pos.isCheckmate();
}

export function isCheck(pos: Chess): boolean {
  return pos.isCheck();
}

/** Legal destinations in chessground's format. */
export function legalDests(pos: Chess): Map<string, string[]> {
  return chessgroundDests(pos) as Map<string, string[]>;
}

/** Does moving from->to require choosing a promotion piece? */
export function needsPromotion(pos: Chess, from: string, to: string): boolean {
  return isLegalUci(pos, `${from}${to}q`) && !isLegalUci(pos, `${from}${to}`);
}

/**
 * Identity of a position for repertoire/transposition purposes: piece placement, side to
 * move, castling rights and the en passant square only when a capture is legally possible.
 * Move counters are excluded.
 */
export function positionKey(fen: string): string {
  return fenOf(positionFromFen(fen)).split(' ').slice(0, 4).join(' ');
}
