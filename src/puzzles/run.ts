/**
 * Pure state machine for solving one puzzle.
 *
 * Answer policy (see pipeline/trainer_pipeline/puzzles.py for the matching pack gate):
 *  - the source move is correct;
 *  - any move that delivers checkmate is also correct (and ends the puzzle);
 *  - anything else is wrong. Packs only contain puzzles where the engine found the source
 *    move to be the only good move by a wide margin, so a sound alternative is not mis-scored.
 */
import { applyUci, canonicalUci, type Color, fenOf, isCheckmate, positionFromFen, sameMove, type Uci } from '../chess/rules';
import type { Puzzle } from './types';

export interface PuzzleRun {
  puzzleId: string;
  line: Uci[];
  /** Index into `line` of the solver move now expected. */
  ply: number;
  solver: Color;
  setupMove: Uci;
  /** Current position (solver to move unless done). */
  fen: string;
  /** Moves actually played from the solver's first position, canonical UCI. */
  played: Uci[];
  /** The solver's very first submission, right or wrong. */
  firstMove: Uci | null;
  mistakes: number;
  hints: number;
  acceptedAlternative: boolean;
  done: boolean;
}

export type Verdict = 'correct' | 'solved' | 'wrong';

export interface MoveResult {
  verdict: Verdict;
  /** Opponent's forced reply that was played automatically, if any. */
  reply?: Uci;
  run: PuzzleRun;
}

export function startRun(puzzle: Puzzle): PuzzleRun {
  const line = puzzle.moves.split(' ');
  const setupMove = line[0];
  if (!setupMove || line.length < 2) throw new Error(`Puzzle ${puzzle.id} has no solver move`);
  const pos = applyUci(positionFromFen(puzzle.fen), setupMove);
  return {
    puzzleId: puzzle.id,
    line,
    ply: 1,
    solver: pos.turn,
    setupMove,
    fen: fenOf(pos),
    played: [],
    firstMove: null,
    mistakes: 0,
    hints: 0,
    acceptedAlternative: false,
    done: false,
  };
}

export function expectedMove(run: PuzzleRun): Uci {
  const m = run.line[run.ply];
  if (!m) throw new Error('Puzzle already finished');
  return m;
}

export function submitMove(run: PuzzleRun, uci: Uci): MoveResult {
  if (run.done) throw new Error('Puzzle already finished');
  const pos = positionFromFen(run.fen);
  const after = applyUci(pos, uci); // throws on illegal input: never scored
  const canon = canonicalUci(pos, uci);
  const firstMove = run.firstMove ?? canon;
  const expected = expectedMove(run);
  const isSource = sameMove(pos, uci, expected);

  if (!isSource && !isCheckmate(after)) {
    return { verdict: 'wrong', run: { ...run, firstMove, mistakes: run.mistakes + 1 } };
  }

  const played = [...run.played, canon];
  const replyUci = run.line[run.ply + 1];
  if (isCheckmate(after) || replyUci === undefined) {
    return {
      verdict: 'solved',
      run: { ...run, firstMove, played, fen: fenOf(after), ply: run.line.length, done: true, acceptedAlternative: !isSource },
    };
  }
  const afterReply = applyUci(after, replyUci);
  return {
    verdict: 'correct',
    reply: replyUci,
    run: { ...run, firstMove, played: [...played, replyUci], fen: fenOf(afterReply), ply: run.ply + 2 },
  };
}

/** Reveals which piece to move. Using it makes the attempt 'assisted'. */
export function hintSquare(run: PuzzleRun): { square: string; run: PuzzleRun } {
  return { square: expectedMove(run).slice(0, 2), run: { ...run, hints: run.hints + 1 } };
}

/** Remaining solution from the current position (solver move, reply, ...). */
export function remainingLine(run: PuzzleRun): Uci[] {
  return run.line.slice(run.ply);
}
