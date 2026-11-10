/**
 * King and pawn against king, exact.
 *
 * `content/kpk.json` holds the theoretical result of every such position, computed by
 * retrograde analysis on the Mac (pipeline/trainer_pipeline/kpk.py) and cross-checked
 * there against Stockfish. With it the app can say, for any move, whether the win or the
 * draw was kept, and can defend or attack perfectly, with no engine and no network.
 */
import { makeSquare } from 'chessops/util';
import kpk from '../../content/kpk.json';
import { applyUci, type Color, fenOf, legalDests, positionFromFen, type Uci } from '../chess/rules';

/** One byte per position: 0 = draw; k = win, safe promotion in k half-moves with best play. */
const DIST = Uint8Array.from(atob(kpk.distanceBase64), (c) => c.charCodeAt(0));
export const KPK_DRILLS = kpk.drills as { win: string[]; hold: string[] };
export const KPK_VERSION = `kpk@${kpk.version}`;
/** A draw counts as held after this many correct defensive moves in a row. */
export const HOLD_MOVES = 10;
/** The table knows win or draw, not how fast: a win must be converted within this many moves. */
export const WIN_MOVE_CAP = 30;

export type KpkResult = 'win' | 'draw';
type Pos = ReturnType<typeof positionFromFen>;

interface Parts {
  strong: Color;
  pawn: number;
  strongKing: number;
  weakKing: number;
}

function parts(pos: Pos): Parts | null {
  const b = pos.board;
  if (b.occupied.size() !== 3 || b.pawn.size() !== 1 || b.king.size() !== 2) return null;
  const pawn = b.pawn.first()!;
  const strong: Color = b.white.has(pawn) ? 'white' : 'black';
  const weak: Color = strong === 'white' ? 'black' : 'white';
  const strongKing = b.king.intersect(b[strong]).first();
  const weakKing = b.king.intersect(b[weak]).first();
  if (strongKing === undefined || weakKing === undefined) return null;
  return { strong, pawn, strongKing, weakKing };
}

const flipRank = (sq: number) => sq ^ 56;
const flipFile = (sq: number) => sq ^ 7;

function distancePos(pos: Pos): number | null {
  const p = parts(pos);
  if (!p) return null;
  let { pawn, strongKing, weakKing } = p;
  if (p.strong === 'black') [pawn, strongKing, weakKing] = [flipRank(pawn), flipRank(strongKing), flipRank(weakKing)];
  if ((pawn & 7) > 3) [pawn, strongKing, weakKing] = [flipFile(pawn), flipFile(strongKing), flipFile(weakKing)];
  const rank = pawn >> 3;
  if (rank < 1 || rank > 6) return null;
  const stm = pos.turn === p.strong ? 0 : 1;
  return DIST[((stm * 24 + (pawn & 7) * 6 + (rank - 1)) * 64 + strongKing) * 64 + weakKing]!;
}

function probePos(pos: Pos): KpkResult | null {
  const d = distancePos(pos);
  return d === null ? null : d > 0 ? 'win' : 'draw';
}

/** Half-moves to a safe promotion with best play, 0 for a draw, null if not K+P v K. */
export function distanceKpk(fen: string): number | null {
  return distancePos(positionFromFen(fen));
}

/** Theoretical result for the side with the pawn, or null if this is not K+P v K. */
export function probeKpk(fen: string): KpkResult | null {
  return probePos(positionFromFen(fen));
}

function legalUcis(pos: Pos): Uci[] {
  const out: Uci[] = [];
  for (const [from, tos] of legalDests(pos)) {
    for (const to of tos) {
      const promo = pos.board.pawn.has(squareOf(from)) && (to[1] === '8' || to[1] === '1');
      if (promo) out.push(`${from}${to}q`, `${from}${to}r`);
      else out.push(`${from}${to}`);
    }
  }
  return out.sort();
}
function squareOf(name: string): number {
  return (name.charCodeAt(0) - 97) + (Number(name[1]) - 1) * 8;
}

/** Result for the pawn's side after a move, including promotions and captures of the pawn. */
function resultAfter(pos: Pos, uci: Uci, strong: Color): KpkResult {
  const after = applyUci(pos, uci);
  if (uci.length === 5) {
    // Promotion. A bishop or knight cannot mate a lone king: that throws the win away.
    if (uci[4] !== 'q' && uci[4] !== 'r') return 'draw';
    // A queen or rook wins if it cannot be taken at once and the position is not stalemate.
    const weakCanCapture = [...legalDests(after)].some(([, tos]) => tos.includes(uci.slice(2, 4)));
    return !after.isStalemate() && !weakCanCapture ? 'win' : 'draw';
  }
  const r = probePos(after);
  if (r === null) return after.board.pawn.isEmpty() || after.isStalemate() ? 'draw' : 'win';
  void strong;
  return r;
}

/**
 * Moves that keep the theoretical result for the side to move: the win for the side with
 * the pawn, the draw for the defender. Empty when there is nothing to keep.
 */
export function keepingMoves(fen: string): Uci[] {
  const pos = positionFromFen(fen);
  const p = parts(pos);
  const now = probePos(pos);
  if (!p || !now) return [];
  const strongToMove = pos.turn === p.strong;
  if (strongToMove && now !== 'win') return [];
  if (!strongToMove && now !== 'draw') return [];
  const want: KpkResult = strongToMove ? 'win' : 'draw';
  const keep = legalUcis(pos).filter((u) => resultAfter(pos, u, p.strong) === want);
  // A rook promotion is listed only when the queen promotion does not also keep the result.
  return keep.filter((u) => !(u.endsWith('r') && keep.includes(`${u.slice(0, 4)}q`)));
}

export function evaluateMove(fen: string, uci: Uci): { kept: boolean; keeping: Uci[]; result: KpkResult } {
  const pos = positionFromFen(fen);
  const p = parts(pos);
  if (!p) return { kept: false, keeping: [], result: 'draw' }; // not K+P v K: nothing this table can judge
  const keeping = keepingMoves(fen);
  const result = resultAfter(pos, uci, p.strong);
  const want: KpkResult = pos.turn === p.strong ? 'win' : 'draw';
  return { kept: keeping.length > 0 && result === want, keeping, result };
}

/** The fastest winning move for the side with the pawn (used for "show the move"). */
export function fastestWin(fen: string): Uci | null {
  const pos = positionFromFen(fen);
  const keep = keepingMoves(fen);
  if (keep.length === 0) return null;
  const dist = (u: Uci) => (u.length === 5 ? 0 : distancePos(applyUci(pos, u)) ?? 0);
  return keep.slice().sort((a, b) => dist(a) - dist(b) || (a < b ? -1 : 1))[0]!;
}

/**
 * The app's move, always deterministic. Defending a lost position it plays the longest
 * defence (best play by the table). Attacking a drawn one it keeps the pawn and picks the
 * move that leaves the defender the fewest drawing replies.
 */
export function opponentReply(fen: string, goal: 'win' | 'hold'): Uci {
  const pos = positionFromFen(fen);
  const moves = legalUcis(pos).filter((u) => !u.endsWith('r'));
  const scored = moves.map((u) => {
    const after = applyUci(pos, u);
    if (goal === 'win') {
      // Defender: taking the pawn or stalemate is best of all; otherwise maximise the distance.
      const d = after.board.pawn.isEmpty() ? 1000 : distancePos(after) === 0 ? 999 : distancePos(after) ?? 0;
      return { u, key: -d };
    }
    const promoted = u.length === 5;
    const pawnSq = after.board.pawn.first();
    const hangs = !promoted && pawnSq !== undefined && [...legalDests(after)].some(([, tos]) => tos.includes(makeSquare(pawnSq)));
    // In a drawn position a promotion can only be into a capture or stalemate: it ends the
    // game at once, so it is the attacker's last choice.
    if (promoted) return { u, key: 5000 };
    const options = keepingMoves(fenOf(after)).length;
    return { u, key: (hangs ? 1000 : 0) + (options === 0 ? 500 : options) };
  });
  scored.sort((a, b) => a.key - b.key || (a.u < b.u ? -1 : 1));
  return scored[0]!.u;
}

export type KpkOutcome = 'promoted' | 'held' | 'pawn-captured' | 'stalemate' | 'not-converted';

/** Whether the play-out has reached its end after the last move. */
export function outcomeAfter(fen: string, goal: 'win' | 'hold', learnerMoves: number): KpkOutcome | null {
  const pos = positionFromFen(fen);
  if (goal === 'win') {
    if (pos.board.pawn.isEmpty() && pos.board.occupied.size() === 3) return 'promoted';
    return learnerMoves >= WIN_MOVE_CAP ? 'not-converted' : null;
  }
  if (pos.board.occupied.size() === 2) return 'pawn-captured';
  if (pos.isStalemate()) return 'stalemate';
  if (pos.board.pawn.isEmpty()) {
    // The pawn promoted. If the new piece can be taken at once the draw is certain and the
    // play-out is over; otherwise the defence failed earlier and was reported then.
    const piece = [...pos.board.occupied].find((sq) => !pos.board.king.has(sq));
    const capturable = piece !== undefined && pos.board[pos.turn].has(piece) === false && [...legalDests(pos)].some(([, tos]) => tos.includes(makeSquare(piece)));
    return capturable ? 'held' : null;
  }
  return learnerMoves >= HOLD_MOVES ? 'held' : null;
}

/** Which colour the learner plays in a drill. */
export function learnerColor(fen: string, goal: 'win' | 'hold'): Color {
  const p = parts(positionFromFen(fen))!;
  return goal === 'win' ? p.strong : p.strong === 'white' ? 'black' : 'white';
}
