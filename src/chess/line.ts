/** A line of moves played through on the board, a move at a time. */
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
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
