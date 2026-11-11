/** A line of moves played through on the board, a move at a time. */
import { parseSan } from 'chessops/san';
import type { Chess } from 'chessops/chess';
import type { Color, Role } from 'chessops/types';
import { makeSquare, makeUci, parseUci } from 'chessops/util';
import { applyUci, canonicalUci, fenOf, positionFromFen } from './rules';

/**
 * A printed line ("12. Nf3 Nc6 13. Bd3" or "12... Nc6 13. Bd3") back into moves from `fen`.
 * Stops at the first move it cannot read: a shorter line is shown rather than a guessed one.
 */
export function ucisOfSanLine(fen: string, sanLine: string): string[] {
  const out: string[] = [];
  let pos;
  try {
    pos = positionFromFen(fen);
  } catch {
    return out;
  }
  for (const token of sanLine.split(/\s+/)) {
    if (!token || /^\d+\.(\.\.)?$/.test(token) || token === '…') continue;
    const move = parseSan(pos, token.replace(/^\d+\.(\.\.)?/, ''));
    if (!move) break;
    out.push(canonicalUci(pos, makeUci(move)));
    pos.play(move);
  }
  return out;
}

/** The position `step` moves into the line, and the move that led to it. */
export function lineAt(fromFen: string, pv: string[], step: number): { fen: string; last: string | null } {
  let fen = fromFen;
  let last: string | null = null;
  try {
    let pos = positionFromFen(fromFen);
    for (const u of pv.slice(0, Math.max(0, step))) {
      pos = applyUci(pos, u);
      fen = fenOf(pos);
      last = u;
    }
  } catch {
    // an illegal move in the line: stay at the last position reached
  }
  return { fen, last };
}

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const NAME: Record<Role, string> = { pawn: 'Pawn', knight: 'Knight', bishop: 'Bishop', rook: 'Rook', queen: 'Queen', king: 'King' };
const PROMOTED: Record<string, string> = { queen: 'queens', rook: 'becomes a rook', bishop: 'becomes a bishop', knight: 'becomes a knight' };

/** White's material minus Black's, in points. */
function balance(pos: Chess): number {
  let total = 0;
  for (const [, piece] of pos.board) total += (piece.color === 'white' ? 1 : -1) * VALUE[piece.role];
  return total;
}

export interface Consequence {
  /** How many moves of the line lead to it. */
  ply: number;
  kind: 'mate' | 'material';
  /** The square to mark: where the piece was taken or the pawn promoted, or the mated king. */
  square: string;
  /** The fact, in words. */
  text: string;
}

/**
 * Where a line is decided, so a replay can stop there and show it: checkmate, or the capture
 * or promotion that brings the material to where the line leaves it, one side ahead.
 *
 * It claims nothing when it cannot: a line that stops on a capture (the recapture may be
 * next), an even exchange, or a line with no capture. `beforeFen` is the position before the
 * learner's own move when the line starts after it, so that what that move took is counted.
 * This is a count of material along one continuation, not a judgement of the position.
 */
export function consequenceOf(fromFen: string, pv: string[], me: Color, beforeFen?: string): Consequence | null {
  let pos: Chess;
  let start: number;
  try {
    pos = positionFromFen(fromFen);
    start = balance(beforeFen ? positionFromFen(beforeFen) : pos);
  } catch {
    return null;
  }
  let now = balance(pos);
  const changes: { ply: number; square: string; what: string; balance: number }[] = [];
  let played = 0;
  for (const uci of pv) {
    const move = parseUci(uci);
    if (!move || !('from' in move)) break;
    const mover = pos.board.get(move.from);
    const target = pos.board.get(move.to);
    // A pawn that changes file onto an empty square takes en passant: the pawn beside it goes.
    const enPassant = mover?.role === 'pawn' && !target && move.from % 8 !== move.to % 8;
    let next: Chess;
    try {
      next = applyUci(pos, uci);
    } catch {
      break;
    }
    played++;
    if (next.isCheckmate()) {
      const king = next.board.kingOf(next.turn);
      return king === undefined ? null : { ply: played, kind: 'mate', square: makeSquare(king), text: 'Checkmate.' };
    }
    const after = balance(next);
    if (after !== now) {
      const to = makeSquare(move.to);
      const what = target
        ? `${NAME[target.role]} taken on ${to}`
        : enPassant
          ? `Pawn taken on ${makeSquare((move.from - (move.from % 8)) + (move.to % 8))}`
          : `The pawn ${PROMOTED[move.promotion ?? 'queen']} on ${to}`;
      changes.push({ ply: played, square: to, what, balance: after });
    }
    now = after;
    pos = next;
  }
  // Nothing changed hands, or the line stops on a capture (the recapture may be next).
  const final = changes[changes.length - 1];
  if (!final || final.ply >= played) return null;
  const net = (now - start) * (me === 'white' ? 1 : -1);
  if (net === 0) return null;
  // The decisive capture is the first one that brings the material to where it ends: what
  // follows it is an even exchange, and the replay should not run on through that.
  const it = changes.find((c) => c.balance === now)!;
  const points = Math.abs(net);
  return { ply: it.ply, kind: 'material', square: it.square, text: `${it.what}. Over these moves you come out ${points} point${points === 1 ? '' : 's'} ${net > 0 ? 'ahead' : 'behind'}.` };
}

