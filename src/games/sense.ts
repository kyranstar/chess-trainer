/**
 * "Game sense" exercises built from the owner's own analysed games.
 *
 * Ordinary puzzles announce that a winning move exists. These do not. Each item is a real
 * position from the owner's games with a yes/no question whose true answer is often "no":
 *
 *   safe-or-not   : the move the owner actually played is proposed. Is it safe? If not, the
 *                   opponent's punishing reply must be played.
 *   chance-or-not : is there something to win here? If so it must be played.
 *
 * Truth comes from the game's measurement record (one fixed engine setting) and is kept
 * narrow: "unsafe" means the engine's reply mates or wins material in a short line; "a chance"
 * means the engine's best line does. "Safe" and "nothing special" mean only that the engine
 * found no such short line, and are asked only where that absence is meaningful. A different
 * answer from the learner is accepted when the in-app engine confirms it; without the engine
 * it is recorded as unverified, never as wrong.
 */
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { applyUci, type Color, fenOf, positionFromFen, sanOf } from '../chess/rules';
import type { Attempt } from '../db/types';
import { type Interval, wilson } from '../metrics/metrics';
import { lineEnd, material, UNDECIDED } from './analyse';
import type { GameRecord } from './types';

export type SenseKind = 'safe-or-not' | 'chance-or-not';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Material (in pawns) that counts as lost or won in a short line; the same threshold defines positives and controls. */
const LOSES = 2;
/** An own move counts as a safe control only if it lost at most this much expected score. */
export const SAFE_LOSS = 3;
/** A chance must be clearly better than the next move to be asked as a chance. */
export const CHANCE_GAP = 10;

export interface SenseItem {
  id: string;
  kind: SenseKind;
  gameId: string;
  ply: number;
  /** Position with the owner to move. */
  fen: string;
  color: Color;
  /** True when there IS something: the proposed move is unsafe, or a chance exists. */
  truth: boolean;
  date: string;
  // safe-or-not
  proposed?: string;
  proposedSan?: string;
  afterFen?: string;
  replyUci?: string;
  replyLine?: string;
  playedWp?: number;
  loss?: number;
  label?: string;
  // chance-or-not
  best?: string;
  bestSan?: string;
  bestLine?: string;
  bestWp?: number;
}

function fensOf(game: GameRecord): string[] {
  const out: string[] = [];
  let pos = positionFromFen(START);
  for (const uci of game.moves) {
    out.push(fenOf(pos));
    pos = applyUci(pos, uci);
  }
  return out;
}

function firstUciOfLine(fen: string, line: string): string | null {
  const san = line.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/)[0];
  if (!san) return null;
  const pos = positionFromFen(fen);
  const move = parseSan(pos, san);
  return move ? makeUci(move) : null;
}

/**
 * Positives and controls are defined by the same test, on the game's measurement record:
 *
 *   unsafe  : the move allowed an avoidable mate or an avoidable loss of at least two points
 *             of material in a short line (analysis v3 `target`), with the reply on record;
 *   safe    : the line after the move loses no material at all (a pawn given up is neither
 *             asked as unsafe nor passed off as safe), no quick mate,
 *             the position was undecided (so the score means something) and the move cost at
 *             most SAFE_LOSS points of expected score.
 *
 * Everything in between (a forced loss, a costly move that loses no material, a move in a
 * position already won or lost) is not asked at all.
 */
export function safetyItems(games: GameRecord[], opts: { minControlPly?: number } = {}): SenseItem[] {
  const minPly = opts.minControlPly ?? 2;
  const out: SenseItem[] = [];
  for (const g of games) {
    const m = g.measure;
    if (!m?.facts) continue;
    const fens = fensOf(g);
    const byPly = new Map(m.events.map((e) => [e.ply, e]));
    const factAt = new Map(m.facts.map((f) => [f.ply, f]));
    for (const [ply, loss] of m.decisions) {
      const fen = fens[ply];
      const uci = g.moves[ply];
      const f = factAt.get(ply);
      if (!fen || !uci || !f) continue;
      const e = byPly.get(ply);
      const base = { id: `sense:safe-or-not:${g.id}:${ply}`, kind: 'safe-or-not' as const, gameId: g.id, ply, fen, color: g.color, date: g.endDate, proposed: uci };
      if (e?.target) {
        if (!e.refutation) continue;
        const afterFen = fenOf(applyUci(positionFromFen(fen), uci));
        const replyUci = firstUciOfLine(afterFen, e.refutation);
        if (!replyUci) continue;
        out.push({ ...base, truth: true, proposedSan: e.playedSan, afterFen, replyUci, replyLine: e.refutation, playedWp: e.playedWp, loss: e.loss, label: e.target === 'mate' ? 'allows-mate' : 'loses-material' });
      } else if (!f.mated && !f.unsure && f.played >= 0 && f.wp >= UNDECIDED.lo && f.wp <= UNDECIDED.hi && loss <= SAFE_LOSS && ply >= minPly) {
        out.push({ ...base, truth: false, proposedSan: sanOf(positionFromFen(fen), uci), loss });
      }
    }
  }
  return out;
}

/**
 *   a chance : the engine's best line mates or wins at least two points of material, and one
 *              move is clearly best (so the answer can be checked);
 *   nothing  : the best line wins no material at all and is not a mate (a pawn that can be
 *              won is neither asked as a chance nor passed off as nothing).
 *
 * A position where several moves win about as much is not asked as a chance and is never
 * passed off as "nothing".
 */
export function chanceItems(games: GameRecord[], opts: { minControlPly?: number } = {}): SenseItem[] {
  const minPly = opts.minControlPly ?? 2;
  const out: SenseItem[] = [];
  for (const g of games) {
    const m = g.measure;
    if (!m?.facts) continue;
    const fens = fensOf(g);
    const byPly = new Map(m.events.map((e) => [e.ply, e]));
    for (const f of m.facts) {
      const ply = f.ply;
      const fen = fens[ply];
      if (!fen) continue;
      const e = byPly.get(ply);
      const base = { id: `sense:chance-or-not:${g.id}:${ply}`, kind: 'chance-or-not' as const, gameId: g.id, ply, fen, color: g.color, date: g.endDate };
      if (e?.opportunity) {
        // Asked only where the evidence holds: a second move to compare with; for material, a
        // settled line and a clear margin; for mate, a short one (a mate in nine is not a chance
        // this learner can be said to take or miss). Another mating or winning move is still
        // accepted when it is played.
        const clear = e.secondWp !== null && (e.opportunity === 'mate' ? (f.mateIn === undefined || f.mateIn <= 3) : !f.unsure && e.bestWp - e.secondWp >= CHANCE_GAP);
        if (clear) out.push({ ...base, truth: true, best: e.best, bestSan: e.bestSan, bestLine: e.bestLine, bestWp: e.bestWp });
      } else if (!f.mating && !f.unsure && f.best <= 0 && ply >= minPly) {
        out.push({ ...base, truth: false });
      }
    }
  }
  return out;
}

export type SenseResponse = 'hit' | 'miss' | 'wrong-reply' | 'unverified-reply' | 'correct-rejection' | 'false-alarm' | 'label-disputed';
export interface SenseGrade {
  response: SenseResponse;
  correct: boolean;
  /** The learner's move differs from the stored line and the engine confirmed it. */
  alternative?: boolean;
  /** A different move was played and no engine value was supplied: ask the in-app engine. */
  needsEngine?: boolean;
}

/** Whether a move other than the stored one was shown, on the board, to do what the item is about. */
export type Verified = 'yes' | 'no' | 'unresolved';

/**
 * Judges a move that differs from the stored one by the same board test that made the item:
 * for an unsafe move, the learner's reply must mate or leave the mover at least two points
 * of material down at the end of a settled line; for a chance, the learner's move must mate
 * or end at least two points up. The expected score is not used: in a decided position it
 * barely moves, and any quiet move would pass. `line` is the engine's best line from the
 * position after the learner's move (expected score for the side then to move), or null.
 */
export function verifyReply(item: SenseItem, uci: string, line: { wp: number; pv: string[]; mate?: number | null } | null): Verified {
  const safety = item.kind === 'safe-or-not';
  // A control carries no stored reply position: it is the position after the proposed move.
  let from = item.fen;
  if (safety) {
    try {
      from = item.afterFen ?? fenOf(applyUci(positionFromFen(item.fen), item.proposed!));
    } catch {
      return 'unresolved';
    }
  }
  let after;
  try {
    after = applyUci(positionFromFen(from), uci);
  } catch {
    return 'no';
  }
  if (after.isCheckmate()) return 'yes';
  if (!line || line.pv.length === 0) return 'unresolved';
  // A forced mate decides before any material is counted. The engine's own mate score is
  // used where it is given; the percentage only where it is not.
  // After a punishing reply the owner is to move and is being mated; after a chance the opponent is.
  const mate = line.mate ?? (line.wp === 0 ? -1 : line.wp === 100 ? 1 : null);
  if (mate !== null && mate < 0) return 'yes';
  // The side to move has the forced mate instead: the learner's move did the opposite of its
  // job, whatever material it picked up on the way.
  if (mate !== null && mate > 0) return 'no';
  // A chance taken must leave the learner at least level by the engine's score.
  if (!safety && 100 - line.wp < 50) return 'no';
  const base = material(positionFromFen(item.fen), item.color);
  const end = lineEnd(fenOf(after), line.pv, item.color);
  if (!end.settled) return 'unresolved';
  const swing = end.balance - base;
  return (safety ? swing <= -LOSES : swing >= LOSES) ? 'yes' : 'no';
}

/** @param verified the outcome of `verifyReply` when the reply differs from the stored one; omitted when it has not been checked yet. */
export function gradeSafety(item: SenseItem, answer: 'safe' | 'unsafe', replyUci: string | null, verified?: Verified): SenseGrade {
  if (!item.truth) return answer === 'safe' ? { response: 'correct-rejection', correct: true } : gradeClaimOnControl(replyUci, verified);
  if (answer === 'safe') return { response: 'miss', correct: false };
  if (replyUci && replyUci === item.replyUci) return { response: 'hit', correct: true };
  return gradeOther(verified);
}

export function gradeChance(item: SenseItem, answer: 'something' | 'nothing', moveUci: string | null, verified?: Verified): SenseGrade {
  if (!item.truth) return answer === 'nothing' ? { response: 'correct-rejection', correct: true } : gradeClaimOnControl(moveUci, verified);
  if (answer === 'nothing') return { response: 'miss', correct: false };
  if (moveUci && moveUci === item.best) return { response: 'hit', correct: true };
  return gradeOther(verified);
}

/**
 * "There is something" on an item stored as having nothing. A claim with no move is a false
 * alarm. A claim with a move is checked like any other answer: if the move does mate or win
 * material by the board test, the stored label was wrong and the item is not scored.
 */
function gradeClaimOnControl(moveUci: string | null, verified: Verified | undefined): SenseGrade {
  if (!moveUci) return { response: 'false-alarm', correct: false };
  if (verified === undefined) return { response: 'unverified-reply', correct: false, needsEngine: true };
  if (verified === 'yes') return { response: 'label-disputed', correct: false };
  if (verified === 'no') return { response: 'false-alarm', correct: false };
  return { response: 'unverified-reply', correct: false };
}

function gradeOther(verified: Verified | undefined): SenseGrade {
  if (verified === undefined) return { response: 'unverified-reply', correct: false, needsEngine: true };
  if (verified === 'yes') return { response: 'hit', correct: true, alternative: true };
  if (verified === 'no') return { response: 'wrong-reply', correct: false };
  return { response: 'unverified-reply', correct: false };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final mixing. Without it the lowest bit is just the parity of the characters, so a coin
  // toss on a seed ending in the turn number followed the turn's even/odd schedule.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Unseen items of one kind, half with something to find and half without, in a fixed pseudo-random order. */
export function pickSense(items: SenseItem[], kind: SenseKind, seen: Set<string>, n: number, seed: string): SenseItem[] {
  const pool = items.filter((i) => i.kind === kind && !seen.has(i.id));
  const order = (xs: SenseItem[]) => xs.slice().sort((a, b) => hash(`${seed}|${a.id}`) - hash(`${seed}|${b.id}`) || (a.id < b.id ? -1 : 1));
  const yes = order(pool.filter((i) => i.truth));
  const no = order(pool.filter((i) => !i.truth));
  // Both sorts are needed. A stream of controls only would make "safe" / "nothing" always
  // right, and a stream of real ones only would make "something" always right.
  if (yes.length === 0 || no.length === 0) return [];
  // Interleaved, starting with a real item or a control by a coin toss on the seed. (Sorting the
  // chosen ones together by hash put the control first almost every time: it is the smallest
  // hash of a much larger pool. Callers that take the first item then asked nine controls in ten.)
  const yesFirst = hash(`${seed}|first`) % 2 === 0;
  const out: SenseItem[] = [];
  for (let k = 0; out.length < n && (k < yes.length || k < no.length); k++) {
    const pair = yesFirst ? [yes[k], no[k]] : [no[k], yes[k]];
    for (const item of pair) if (item && out.length < n) out.push(item);
  }
  return out;
}

/** Attempt themes for a graded item: [kind, what was true, what the learner did]. */
export function senseThemes(item: SenseItem, grade: SenseGrade): string[] {
  const truth = item.kind === 'safe-or-not' ? (item.truth ? 'unsafe' : 'safe') : item.truth ? 'chance' : 'none';
  return [item.kind, truth, grade.response];
}

export interface Rate {
  n: number;
  successes: number;
  rate: number | null;
  interval: Interval | null;
}
const rate = (successes: number, n: number): Rate => ({ n, successes, rate: n ? successes / n : null, interval: n ? wilson(successes, n) : null });

export interface SenseStats {
  /** Something was there, and it was both noticed and played (or the punishing reply found). */
  detected: Rate;
  /** Something was there and the learner said so, whether or not they then found the move. */
  noticed: Rate;
  /** Nothing was there and the learner said so (1 - false-alarm rate). */
  quiet: Rate;
}

/** First-time-seen results only, per kind. Detection and false alarms are never merged into one number. */
export function senseStats(attempts: Attempt[], since?: number): Record<SenseKind, SenseStats> {
  const rows = attempts.filter((a) => a.exerciseKind === 'sense' && a.fresh && a.outcome !== 'skipped' && (since === undefined || a.ts >= since));
  const of = (kind: SenseKind): SenseStats => {
    const mine = rows.filter((a) => a.themes[0] === kind);
    const positives = mine.filter((a) => a.themes[1] === 'unsafe' || a.themes[1] === 'chance');
    const negatives = mine.filter((a) => a.themes[1] === 'safe' || a.themes[1] === 'none');
    return {
      detected: rate(positives.filter((a) => a.themes[2] === 'hit').length, positives.length),
      noticed: rate(positives.filter((a) => a.themes[2] !== 'miss').length, positives.length),
      quiet: rate(negatives.filter((a) => a.themes[2] === 'correct-rejection').length, negatives.length),
    };
  };
  return { 'safe-or-not': of('safe-or-not'), 'chance-or-not': of('chance-or-not') };
}
