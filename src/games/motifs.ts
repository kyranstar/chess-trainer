/**
 * The tactic a move carries out, named by what it does on the board (ADR-062). Worked out by
 * generating attacks with chessops from the position after the move, never from an engine
 * score or a guess at intent; a move that fits none of the tests below is "other".
 *
 * Tests, from the side that plays the move, in this order:
 *   hanging    : the move takes a piece that could be taken for nothing (nothing takes back,
 *                or the capturer is worth less): the test of "Your move" (src/games/ownmove.ts);
 *                for a line, one of the mover's first three moves takes such a piece
 *   fork       : afterwards the moved piece attacks two or more pieces of the other side, each
 *                the king, undefended, or worth more than the attacker
 *   pin        : afterwards the moved piece (bishop, rook, queen) attacks a piece with the king
 *                behind it on the same line, or a minor piece or more with a more valuable piece
 *                behind it; a skewer (king or queen in front, a minor piece or more behind) too
 *   discovered : afterwards another piece of the mover's attacks, through the square the move
 *                left, the king or a piece that is undefended or worth more than it
 * Mate is told by the caller from the analysis (a mate allowed, or a chance that was a mate).
 */
import { attacks } from 'chessops/attacks';
import type { Chess } from 'chessops/chess';
import type { Color, Piece, Role, Square } from 'chessops/types';
import { makeSquare, opposite, parseSquare } from 'chessops/util';
import { ucisOfSanLine } from '../chess/line';
import { applyUci, fenAfter, positionFromFen } from '../chess/rules';
import { clearChances } from './metrics';
import { movePicture } from './ownmove';
import type { GameEvent, GameRecord } from './types';

export type Motif = 'hanging' | 'fork' | 'pin' | 'discovered' | 'mate' | 'other';
export const MOTIFS: Motif[] = ['hanging', 'fork', 'pin', 'discovered', 'mate', 'other'];
export const MOTIF_NAME: Record<Motif, string> = {
  hanging: 'Hanging piece',
  fork: 'Fork',
  pin: 'Pin or skewer',
  discovered: 'Discovered attack',
  mate: 'Mate',
  other: 'Other',
};
/** The concept in Learn that teaches each motif. */
export const MOTIF_CONCEPT: Record<Motif, string | null> = {
  hanging: 'safety.hanging-pieces',
  fork: 'tactics.double-attack',
  pin: 'tactics.pin',
  discovered: 'tactics.discovered-attack',
  mate: 'mate.in-one',
  other: null,
};

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const SLIDERS: Role[] = ['bishop', 'rook', 'queen'];

const defended = (pos: Chess, square: Square, owner: Color) => pos.kingAttackers(square, owner, pos.board.occupied.without(square)).nonEmpty();

/** Pieces of `victim` that the piece on `from` attacks and that are worth attacking: the king, undefended, or worth more. */
function targetsOf(pos: Chess, from: Square, piece: Piece, victim: Color): Square[] {
  const out: Square[] = [];
  for (const sq of attacks(piece, from, pos.board.occupied).intersect(pos.board[victim])) {
    const t = pos.board.get(sq)!;
    if (t.role === 'king' || VALUE[t.role] > VALUE[piece.role] || !defended(pos, sq, victim)) out.push(sq);
  }
  return out;
}

/** The first piece met walking from `from` past `front`, square by square along the same line. */
function behind(pos: Chess, from: Square, front: Square): Square | null {
  const df = Math.sign((front % 8) - (from % 8));
  const dr = Math.sign(Math.floor(front / 8) - Math.floor(from / 8));
  let f = (front % 8) + df;
  let r = Math.floor(front / 8) + dr;
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    const sq = r * 8 + f;
    if (pos.board.occupied.has(sq)) return sq;
    f += df;
    r += dr;
  }
  return null;
}

function isPinOrSkewer(pos: Chess, from: Square, piece: Piece, victim: Color): boolean {
  if (!SLIDERS.includes(piece.role)) return false;
  for (const front of attacks(piece, from, pos.board.occupied).intersect(pos.board[victim])) {
    const back = behind(pos, from, front);
    if (back === null) continue;
    const x = pos.board.get(front)!;
    const y = pos.board.get(back)!;
    if (y.color !== victim) continue;
    // A pawn in front of a rook is not held by anything worth a name; a pawn in front of the king is.
    const pin = y.role === 'king' || (VALUE[x.role] >= 3 && VALUE[y.role] > VALUE[x.role]);
    const skewer = (x.role === 'king' || x.role === 'queen') && VALUE[y.role] >= 3 && y.role !== x.role;
    if (pin || skewer) return true;
  }
  return false;
}

function isDiscovered(before: Chess, after: Chess, to: Square, mover: Color, victim: Color): boolean {
  // Only the square the move left can open a line: what it lands on can only close one.
  for (const sq of after.board[mover].intersect(after.board.bishop.union(after.board.rook).union(after.board.queen))) {
    if (sq === to) continue;
    const s = after.board.get(sq)!;
    const now = attacks(s, sq, after.board.occupied).diff(attacks(s, sq, before.board.occupied));
    for (const t of now.intersect(after.board[victim])) {
      const p = after.board.get(t)!;
      if (p.role === 'king' || VALUE[p.role] > VALUE[s.role] || (VALUE[p.role] >= 3 && !defended(after, t, victim))) return true;
    }
  }
  return false;
}

/** The motif of `uci` played in `fen` (the mover is the side to move). Mate is not told here. */
export function motifOfMove(fen: string, uci: string): Exclude<Motif, 'mate'> {
  let before: Chess;
  let after: Chess;
  try {
    before = positionFromFen(fen);
    after = applyUci(before, uci);
  } catch {
    return 'other';
  }
  const mover = before.turn;
  const victim = opposite(mover);
  try {
    if (movePicture(fen, uci).tookFree) return 'hanging';
  } catch {
    // An illegal or unreadable move falls through to the board tests, which fail safe.
  }
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) return 'other';
  const piece = after.board.get(to);
  if (!piece) return 'other';
  if (targetsOf(after, to, piece, victim).length >= 2) return 'fork';
  if (isPinOrSkewer(after, to, piece, victim)) return 'pin';
  if (isDiscovered(before, after, to, mover, victim)) return 'discovered';
  return 'other';
}

/**
 * The motif of a line from `fen` (the mover is the side to move): "hanging" when one of the
 * mover's first three moves takes a piece that could already be taken for nothing in `fen`
 * (a check first, then the loose piece, is still a loose piece), with that piece; otherwise
 * the first move's.
 */
export function motifOfLine(fen: string, line: string[]): Exclude<Motif, 'mate'> {
  return looseTaken(fen, line).motif;
}

function looseTaken(fen: string, line: string[]): { motif: Exclude<Motif, 'mate'>; taken: { role: Role; square: string } | null } {
  const other = { motif: 'other' as const, taken: null };
  if (!line[0]) return other;
  let free: Set<string>;
  try {
    free = new Set(movePicture(fen, line[0]).freeBefore.map((l) => `${l.square}:${l.piece}`));
  } catch {
    return other;
  }
  let pos: Chess;
  try {
    pos = positionFromFen(fen);
  } catch {
    return other;
  }
  const mover = pos.turn;
  for (let i = 0; i < Math.min(line.length, 5); i++) {
    const taken = captureOf(pos, line[i]!);
    if (i % 2 === 0 && taken && taken.color !== mover && free.has(`${taken.square}:${taken.role}`)) return { motif: 'hanging', taken: { role: taken.role, square: taken.square } };
    try {
      pos = applyUci(pos, line[i]!);
    } catch {
      break;
    }
  }
  return { motif: motifOfMove(fen, line[0]), taken: null };
}

/** The piece a move takes, and its square (en passant: the pawn beside), or null. */
function captureOf(pos: Chess, uci: string): { role: Role; color: Color; square: string } | null {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) return null;
  const mover = pos.board.get(from);
  if (!mover) return null;
  let square = to;
  let target = pos.board.get(to);
  if (!target && mover.role === 'pawn' && from % 8 !== to % 8) {
    square = to + (mover.color === 'white' ? -8 : 8);
    target = pos.board.get(square);
  }
  // Castling is written king-takes-rook: not a capture.
  if (!target || target.color === mover.color) return null;
  return { role: target.role, color: target.color, square: makeSquare(square) };
}

export interface MotifEvent {
  game: GameRecord;
  event: GameEvent;
  motif: Motif;
  /** Against him (a big mistake the opponent could punish) or for him (a clear chance he had). */
  side: 'against' | 'for';
  /** For a chance: he took it. */
  taken?: boolean;
  /** For a big mistake that cost material: the loose piece taken, else the piece of his lost on balance along the line (firstLoss), and where. */
  lost?: { role: Role; square: string } | null;
}

/**
 * The piece of `me` lost along `line` from `fen`, and where: his pieces the other side takes,
 * less one of equal value for each piece he takes back (an exchange is not a loss), the most
 * valuable left. A capture on the last move of the line is not counted: the recapture may be
 * next. Null if nothing is left.
 */
export function firstLoss(fen: string, line: string[], me: Color): { role: Role; square: string } | null {
  let pos: Chess;
  try {
    pos = positionFromFen(fen);
  } catch {
    return null;
  }
  const lostBy: { role: Role; square: string }[] = [];
  const won: Role[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const c = captureOf(pos, line[i]!);
    if (c) (c.color === me ? lostBy.push({ role: c.role, square: c.square }) : won.push(c.role));
    try {
      pos = applyUci(pos, line[i]!);
    } catch {
      break;
    }
  }
  const left = [...lostBy];
  for (const r of won) {
    // The same kind first, else another of the same value (a knight for a bishop).
    const at = left.findIndex((x) => x.role === r) >= 0 ? left.findIndex((x) => x.role === r) : left.findIndex((x) => VALUE[x.role] === VALUE[r]);
    if (at >= 0) left.splice(at, 1);
  }
  return left.sort((a, b) => VALUE[b.role] - VALUE[a.role])[0] ?? null;
}

/**
 * Against him: each big mistake that lost material or allowed mate, named by the opponent's
 * refutation. For him: each clear chance (one move clearly best, counted once while it stood:
 * the "Chances taken" card's unit, src/games/metrics.ts), named by the engine's best line.
 * From the game's best analysis.
 */
export function motifEvents(games: GameRecord[]): MotifEvent[] {
  const out: MotifEvent[] = [];
  for (const game of games) {
    for (const event of game.analysis?.events ?? []) {
      if (!event.majorError || (event.errorLabel !== 'loses-material' && event.errorLabel !== 'allows-mate')) continue;
      let afterFen: string | null = null;
      try {
        afterFen = fenAfter(event.fen, [event.played]);
      } catch {
        afterFen = null;
      }
      const line = afterFen && event.refutation ? ucisOfSanLine(afterFen, event.refutation) : [];
      const found = afterFen ? looseTaken(afterFen, line) : { motif: 'other' as const, taken: null };
      const motif: Motif = event.errorLabel === 'allows-mate' ? 'mate' : found.motif;
      // A loose piece taken is the piece that fell; otherwise what is lost on balance.
      const lost = event.errorLabel !== 'loses-material' || !afterFen ? null : found.taken ?? firstLoss(afterFen, line, game.color);
      out.push({ game, event, motif, side: 'against', lost });
    }
    for (const c of clearChances(game)) {
      const e = c.event;
      const line = ucisOfSanLine(e.fen, e.bestLine);
      const motif: Motif = e.opportunity === 'mate' ? 'mate' : motifOfLine(e.fen, line.length ? line : [e.best]);
      out.push({ game, event: e, motif, side: 'for', taken: c.taken });
    }
  }
  return out;
}
