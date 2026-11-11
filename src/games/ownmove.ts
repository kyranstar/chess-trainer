/**
 * "Your move": the learner plays his own move in an ordinary position from one of his own
 * games, and the app reports what is exactly true of the position that results.
 *
 * Every other exercise shows a move or announces that something is there. His games are lost
 * on moves he chose himself, at moves 10 to 19, with time on the clock. This exercise is the
 * check he does not yet make: after my move, what of mine can be taken, and am I mated?
 *
 * What is reported is found by generating legal moves, not by an engine's opinion:
 *   - a piece of his that can be captured and not recaptured ("undefended");
 *   - a piece of his that can be captured by a cheaper piece, defended or not;
 *   - a mate in one for the opponent.
 * These are facts about captures, not verdicts: a piece can be left to be taken on purpose.
 * So the result is graded with abstention. A mate in one allowed is a failure. A loose piece
 * is a failure only if the engine's line also shows a settled loss of material and a large
 * drop in its score. Everything else is either clean or unresolved, and unresolved is never
 * recorded against him.
 */
import { parseSquare } from 'chessops/util';
import { applyUci, type Color, fenOf, isCheckmate, legalDests, needsPromotion, positionFromFen, sanOf } from '../chess/rules';
import { RULES, UNDECIDED } from './analyse';
import type { GameRecord } from './types';

type Role = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface Loose {
  square: string;
  piece: Role;
  by: { from: string; piece: Role };
  reason: 'undefended' | 'cheaper-attacker';
}
export interface MoveFacts {
  loose: Loose[];
  mateInOne: { uci: string; san: string } | null;
  /** Position after the learner's move, opponent to move. */
  afterFen: string;
}

/** Exact facts about the position after `uci` is played in `fen`. */
export function looseAfter(fen: string, uci: string): MoveFacts {
  const after = applyUci(positionFromFen(fen), uci);
  const afterFen = fenOf(after);
  const me: Color = after.turn === 'white' ? 'black' : 'white';
  const found = new Map<string, Loose>();
  let mateInOne: MoveFacts['mateInOne'] = null;
  for (const [from, tos] of legalDests(after)) {
    for (const to of tos) {
      const move = needsPromotion(after, from, to) ? `${from}${to}q` : `${from}${to}`;
      const next = applyUci(after, move);
      if (!mateInOne && isCheckmate(next)) mateInOne = { uci: move, san: sanOf(after, move) };
      const target = after.board.get(parseSquare(to)!);
      const capturer = after.board.get(parseSquare(from)!);
      if (!target || !capturer || target.color !== me || target.role === 'king') continue;
      // Can the capturing piece be taken back on that square? (Legal moves only: pins count.)
      const recapture = [...legalDests(next).values()].some((dests) => dests.includes(to));
      const reason: Loose['reason'] | null = !recapture ? 'undefended' : VALUE[capturer.role as Role] < VALUE[target.role as Role] ? 'cheaper-attacker' : null;
      if (!reason) continue;
      const entry: Loose = { square: to, piece: target.role as Role, by: { from, piece: capturer.role as Role }, reason };
      const had = found.get(to);
      // One line per piece: "undefended" before "cheaper attacker", then the cheapest capturer.
      const better = !had || (had.reason !== 'undefended' && reason === 'undefended') || (had.reason === reason && VALUE[entry.by.piece] < VALUE[had.by.piece]);
      if (better) found.set(to, entry);
    }
  }
  const loose = [...found.values()].sort((a, b) => VALUE[b.piece] - VALUE[a.piece] || (a.square < b.square ? -1 : 1));
  return { loose, mateInOne, afterFen };
}

/** What the engine's line after the learner's move shows, when there is one. */
export interface MoveEvidence {
  /** Expected-score points lost against the stored best move of the position. */
  loss: number;
  /** Material at the end of the line, relative to before the move. */
  swing: number;
  settled: boolean;
}

export type MoveVerdict = 'clean' | 'failed' | 'unresolved';

export function gradeOwnMove(facts: MoveFacts, engine: MoveEvidence | null): MoveVerdict {
  if (facts.mateInOne) return 'failed';
  if (facts.loose.length > 0) {
    const confirmed = !!engine && engine.settled && engine.swing <= -RULES.materialSwing && engine.loss >= RULES.majorLoss;
    return confirmed ? 'failed' : 'unresolved';
  }
  if (engine && engine.loss >= RULES.majorLoss) return 'unresolved';
  return 'clean';
}

export interface MoveItem {
  id: string;
  gameId: string;
  ply: number;
  /** Position with the learner to move. */
  fen: string;
  color: Color;
  date: string;
  /** What he played in the game. */
  played: string;
  /** Expected score of the best move here, from the game's measurement record. */
  bestWp: number;
}

/** Positions are taken this many plies apart at least, so neighbours of one moment are not all asked. */
const SPACING = 8;

/**
 * Ordinary positions from the learner's own games: his move, moves 10 to 19 by default (where
 * his error rate doubles), the game still undecided. Not only positions where he went wrong:
 * the point is the check, whatever the position holds.
 */
export function moveItems(games: GameRecord[], opts: { fromMove?: number; toMove?: number; build?: boolean } = {}): MoveItem[] {
  const lo = ((opts.fromMove ?? 10) - 1) * 2;
  const hi = (opts.toMove ?? 19) * 2;
  const out: MoveItem[] = [];
  for (const g of games) {
    const facts = g.measure?.facts;
    if (!facts) continue;
    let fens: string[] | null = null;
    if (opts.build !== false) {
      try {
        fens = [];
        let pos = positionFromFen(START);
        for (const u of g.moves) {
          fens.push(fenOf(pos));
          pos = applyUci(pos, u);
        }
      } catch {
        continue;
      }
    }
    let last = -100;
    for (const f of facts) {
      if (f.ply < lo || f.ply >= hi || f.wp < UNDECIDED.lo || f.wp > UNDECIDED.hi || f.ply - last < SPACING) continue;
      const fen = fens ? fens[f.ply] : '';
      const played = g.moves[f.ply];
      if (fen === undefined || !played) continue;
      last = f.ply;
      out.push({ id: `move:${g.id}:${f.ply}`, gameId: g.id, ply: f.ply, fen, color: g.color, date: g.endDate, played, bestWp: f.wp });
    }
  }
  return out;
}

const NAME: Record<Role, string> = { pawn: 'pawn', knight: 'knight', bishop: 'bishop', rook: 'rook', queen: 'queen', king: 'king' };

/** One plain sentence per fact. These are statements about captures, not advice. */
export function describeLoose(l: Loose): string {
  return l.reason === 'undefended'
    ? `Your ${NAME[l.piece]} on ${l.square} can be taken by the ${NAME[l.by.piece]} on ${l.by.from}, and nothing takes back.`
    : `Your ${NAME[l.piece]} on ${l.square} can be taken by the ${NAME[l.by.piece]} on ${l.by.from}, a cheaper piece.`;
}
