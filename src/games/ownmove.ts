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
 * The verdict on the move is the built-in engine's rating of it against its own first choice
 * (see gradeMove), shown with both numbers; the facts explain it.
 */
import { parseSquare } from 'chessops/util';
import { applyUci, type Color, fenOf, isCheckmate, legalDests, needsPromotion, positionFromFen, sanOf } from '../chess/rules';
import { UNDECIDED } from './analyse';
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
  /** Every capture (from+to) that takes one of the loose pieces on the terms above. */
  captures: string[];
  /** Every mating move the opponent has. */
  mates: string[];
}

/** Whether a reply the learner named is one that matters: a mate, or a capture of a loose piece on those terms. */
export function isPunishingReply(facts: MoveFacts, uci: string): boolean {
  return facts.mates.includes(uci) || facts.mates.includes(uci.slice(0, 4)) || facts.captures.includes(uci.slice(0, 4));
}

type Pos = ReturnType<typeof positionFromFen>;

/**
 * Pieces of the side NOT to move that the side to move can capture and keep the gain
 * (nothing takes back, or the capturer is cheaper), and a mate in one for the side to move.
 */
function scan(pos: Pos): { loose: Loose[]; mate: { uci: string; san: string } | null; captures: string[]; mates: string[] } {
  const victim: Color = pos.turn === 'white' ? 'black' : 'white';
  const found = new Map<string, Loose>();
  const captures: string[] = [];
  const mates: string[] = [];
  let mate: { uci: string; san: string } | null = null;
  for (const [from, tos] of legalDests(pos)) {
    for (const to of tos) {
      const move = needsPromotion(pos, from, to) ? `${from}${to}q` : `${from}${to}`;
      const next = applyUci(pos, move);
      if (isCheckmate(next)) {
        mates.push(move);
        mate ??= { uci: move, san: sanOf(pos, move) };
      }
      const capturer = pos.board.get(parseSquare(from)!);
      if (!capturer) continue;
      // The piece taken stands on the destination square, except en passant: there it is the
      // pawn beside the capturing pawn, on the capturer's rank and the destination's file.
      let square = to;
      let target = pos.board.get(parseSquare(to)!);
      if (!target && capturer.role === 'pawn' && from[0] !== to[0]) {
        square = `${to[0]}${from[1]}`;
        target = pos.board.get(parseSquare(square)!);
      }
      if (!target || target.color !== victim || target.role === 'king') continue;
      // Can the capturing piece be taken back at once on the square it lands on? (Legal moves only: pins count.)
      const recapture = [...legalDests(next).values()].some((dests) => dests.includes(to));
      const reason: Loose['reason'] | null = !recapture ? 'undefended' : VALUE[capturer.role as Role] < VALUE[target.role as Role] ? 'cheaper-attacker' : null;
      if (!reason) continue;
      captures.push(`${from}${to}`);
      const entry: Loose = { square, piece: target.role as Role, by: { from, piece: capturer.role as Role }, reason };
      const had = found.get(square);
      // One line per piece: "undefended" before "cheaper attacker", then the cheapest capturer.
      const better = !had || (had.reason !== 'undefended' && reason === 'undefended') || (had.reason === reason && VALUE[entry.by.piece] < VALUE[had.by.piece]);
      if (better) found.set(square, entry);
    }
  }
  const loose = [...found.values()].sort((x, y) => VALUE[y.piece] - VALUE[x.piece] || (x.square < y.square ? -1 : 1));
  return { loose, mate, captures, mates };
}

/** Exact facts about the position after `uci` is played in `fen`. */
export function looseAfter(fen: string, uci: string): MoveFacts {
  const after = applyUci(positionFromFen(fen), uci);
  const s = scan(after);
  return { loose: s.loose, mateInOne: s.mate, afterFen: fenOf(after), captures: s.captures, mates: s.mates };
}

/**
 * The whole picture of one move: the three things to look at before playing, each found by
 * generating legal moves.
 *   threatsBefore : what the opponent could already take (had it been their turn);
 *   freeBefore    : what the learner could take and keep, and any mate in one he had;
 *   loose         : what the opponent can take after the move (see looseAfter).
 */
export interface MovePicture extends MoveFacts {
  threatsBefore: Loose[];
  freeBefore: Loose[];
  mateBefore: { uci: string; san: string } | null;
  /** The move captured one of the pieces that could be taken for nothing. */
  tookFree: boolean;
  /** Squares of threatened pieces that are no longer loose after the move. */
  dealtWith: string[];
  /** A mate in one is allowed, and every legal move allowed one: it was not this move's doing. */
  mateUnavoidable: boolean;
}

function allMovesAllowMate(pos: Pos): boolean {
  for (const [from, tos] of legalDests(pos)) {
    for (const to of tos) {
      const move = needsPromotion(pos, from, to) ? `${from}${to}q` : `${from}${to}`;
      if (scan(applyUci(pos, move)).mate === null) return false;
    }
  }
  return true;
}

export function movePicture(fen: string, uci: string): MovePicture {
  const pos = positionFromFen(fen);
  const mine = scan(pos);
  let threatsBefore: Loose[] = [];
  if (!pos.isCheck()) {
    // As if it were the opponent's turn. (In check there is no such position: the check is the threat.)
    const passed = pos.clone();
    passed.turn = pos.turn === 'white' ? 'black' : 'white';
    passed.epSquare = undefined;
    threatsBefore = scan(passed).loose;
  }
  const after = looseAfter(fen, uci);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const stillLoose = (square: string) => after.loose.some((l) => l.square === square);
  const givesCheck = positionFromFen(after.afterFen).isCheck();
  return {
    ...after,
    threatsBefore,
    freeBefore: mine.loose,
    mateBefore: mine.mate,
    // The capture actually played must be one of those that were free; taking the same piece
    // with something that is then lost is not it.
    tookFree: mine.captures.includes(`${from}${to}`),
    mateUnavoidable: !!after.mateInOne && allMovesAllowMate(pos),
    dealtWith: threatsBefore.filter((t) => {
      const moved = t.square === from;
      // A check only puts the capture off by a move: the opponent must answer it first, so
      // the piece does not show as takeable, and it is taken a move later all the same. With
      // a check the threat counts as met only if the piece itself left or its attacker was taken.
      if (givesCheck && !moved && to !== t.by.from) return false;
      return moved ? !stillLoose(to) : !stillLoose(t.square);
    }).map((t) => t.square),
  };
}

/**
 * How the learner's move compares with the engine's first choice in the same position, both
 * searched on the device at the same budget.
 */
export interface MoveRating {
  /** Expected-score points below the engine's first choice (0 if it is the first choice). */
  loss: number;
  isBest: boolean;
}

export type MoveGrade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'unrated';
/** Upper bounds, in expected-score points below the engine's first choice. */
export const GRADE_BANDS = { good: 5, inaccuracy: 10, mistake: 20 };

/**
 * The owner asked for moves to be judged harder and for the result to be plain (2026-11-11):
 * a move that leaves nothing to take but is far below the best move used to pass. Every
 * move is now rated against the engine's first choice, in the bands players know: best,
 * good (under 5 points below), inaccuracy (under 10), mistake (under 20), blunder. These are
 * the built-in engine's ratings, and the screen says so and shows both numbers; a small
 * engine can be wrong. Two things are exact and override it: a move that allows mate in one
 * is a blunder, and a move that passes up a mate in one is at least a mistake. With no
 * engine answer a move is not rated.
 */
export function gradeMove(facts: MovePicture, rating: MoveRating | null, uci: string): MoveGrade {
  // Allowing a mate in one is a blunder, unless every legal move allowed one.
  if (facts.mateInOne && !facts.mateUnavoidable) return 'blunder';
  const missedMate = !!facts.mateBefore && uci !== facts.mateBefore.uci;
  if (!rating) return missedMate ? 'mistake' : 'unrated';
  if (rating.isBest && !missedMate) return 'best';
  const byScore: MoveGrade = rating.loss < GRADE_BANDS.good ? 'good' : rating.loss < GRADE_BANDS.inaccuracy ? 'inaccuracy' : rating.loss < GRADE_BANDS.mistake ? 'mistake' : 'blunder';
  return missedMate && (byScore === 'good' || byScore === 'inaccuracy') ? 'mistake' : byScore;
}

/** Mistakes and blunders are recorded as misses and come back in review; an unrated move counts for nothing. */
export function outcomeOfGrade(g: MoveGrade): 'success' | 'fail' | 'skipped' {
  return g === 'mistake' || g === 'blunder' ? 'fail' : g === 'unrated' ? 'skipped' : 'success';
}

export const GRADE_LABEL: Record<MoveGrade, string> = { best: 'Best move', good: 'Good move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', unrated: 'Not rated' };

/**
 * How open a position must be to be used. The lower limit is higher than for game statistics:
 * the ratings are bands of expected score lost, and from 16 out of 100 no move can lose the 20
 * points that make a blunder, so a nearly lost position cannot tell a good move from a bad one
 * (found by the practice audit, ADR-049: a position at 7 out of 100 was rated "good").
 */
export const OWN_MOVE_OPEN = { lo: 25, hi: UNDECIDED.hi };

/**
 * Whether a capture that was free for the taking counts as taken, missed, or passed up.
 * It is a miss only when taking was the engine's own first choice (or a mate in one was
 * there). The first audit found "you could have taken the rook" counted against a move the
 * engine rated best; the second found it shown beside a blunder where taking was no better
 * than the move played (49 against 50 out of 100, with the best move at 90). `bestUci` is the
 * engine's first choice in the position, or null when it did not answer.
 */
export function freeTag(facts: MovePicture, uci: string, bestUci: string | null): 'free-taken' | 'free-left' | 'free-declined' | null {
  if (!facts.mateBefore && facts.freeBefore.length === 0) return null;
  if (facts.tookFree || uci === facts.mateBefore?.uci) return 'free-taken';
  // A mate in one passed up is a miss whatever else was played.
  if (facts.mateBefore) return 'free-left';
  const bestIsFree = !!bestUci && facts.freeBefore.some((l) => l.by.from === bestUci.slice(0, 2) && captureSquare(l, bestUci));
  return bestIsFree ? 'free-left' : 'free-declined';
}

/** Whether `uci` is the capture of that loose piece (en passant lands beside the pawn it takes). */
function captureSquare(l: Loose, uci: string): boolean {
  const to = uci.slice(2, 4);
  return to === l.square || (l.piece === 'pawn' && l.by.piece === 'pawn' && to[0] === l.square[0] && to[1] !== l.square[1]);
}

/**
 * Whether a piece that can be taken after the move is marked on the board. A piece that
 * "can be taken" is not always hanging: the audit found two where taking would have been the
 * opponent's mistake. It is marked when the engine's own reply takes it, when taking costs
 * the opponent under ten points against his best reply, or when that could not be checked.
 */
export function reallyLoose(x: { engineTakes: boolean; captureCost: number | null }): boolean {
  return x.engineTakes || x.captureCost === null || x.captureCost < 10;
}

/** The standard annotation for each rating, and whether it reads as good, middling or bad. */
export const GRADE_MARK: Record<MoveGrade, { text: string; tone: 'good' | 'mid' | 'bad' } | null> = {
  best: { text: '★', tone: 'good' },
  good: { text: '✓', tone: 'good' },
  inaccuracy: { text: '?!', tone: 'mid' },
  mistake: { text: '?', tone: 'bad' },
  blunder: { text: '??', tone: 'bad' },
  unrated: null,
};

/**
 * The rating of a move in a word. What was better, and by how much, is shown by the moves
 * side by side and their bars, not said (owner decision, 2026-11-12).
 */
export function gradeHeadline(x: { grade: MoveGrade; late: number | null }): string {
  const late = x.late ? ` Late: over ${x.late} s.` : '';
  if (x.grade === 'unrated') return `Not rated: the engine did not answer.${late}`;
  return `${{ best: 'Best move', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' }[x.grade]}.${late}`;
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
      if (f.ply < lo || f.ply >= hi || f.wp < OWN_MOVE_OPEN.lo || f.wp > OWN_MOVE_OPEN.hi || f.ply - last < SPACING) continue;
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
    ? `Your ${NAME[l.piece]} on ${l.square} can be taken by the ${NAME[l.by.piece]} on ${l.by.from}, and nothing can take back at once.`
    : `Your ${NAME[l.piece]} on ${l.square} can be taken by the ${NAME[l.by.piece]} on ${l.by.from}, a cheaper piece.`;
}

/** A capture the learner had and did not make. A fact about the position, not a verdict on his move. */
export function describeFree(l: Loose): string {
  return l.reason === 'undefended'
    ? `You could have taken the ${NAME[l.piece]} on ${l.square} with the ${NAME[l.by.piece]} on ${l.by.from}, and nothing could take back at once.`
    : `You could have taken the ${NAME[l.piece]} on ${l.square} with the ${NAME[l.by.piece]} on ${l.by.from}, a cheaper piece.`;
}

