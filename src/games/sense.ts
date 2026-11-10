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
import { UNDECIDED } from './analyse';
import type { GameRecord } from './types';

export type SenseKind = 'safe-or-not' | 'chance-or-not';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Material (in pawns) that counts as lost or won in a short line; the same threshold defines positives and controls. */
const LOSES = 2;
/** An own move counts as a safe control only if it lost at most this much expected score. */
export const SAFE_LOSS = 3;
/** An alternative answer is accepted when the engine puts it within this many points of the reference. */
export const ACCEPT_WITHIN = 10;
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
 *   safe    : the line after the move loses less than two points of material, no quick mate,
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
      } else if (!f.mated && !f.unsure && f.played > -LOSES && f.wp >= UNDECIDED.lo && f.wp <= UNDECIDED.hi && loss <= SAFE_LOSS && ply >= minPly) {
        out.push({ ...base, truth: false, proposedSan: sanOf(positionFromFen(fen), uci), loss });
      }
    }
  }
  return out;
}

/**
 *   a chance : the engine's best line mates or wins at least two points of material, and one
 *              move is clearly best (so the answer can be checked);
 *   nothing  : the best line wins less than two points of material and is not a mate.
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
        const clear = e.opportunity === 'mate' || e.secondWp === null || e.bestWp - e.secondWp >= CHANCE_GAP;
        if (clear) out.push({ ...base, truth: true, best: e.best, bestSan: e.bestSan, bestLine: e.bestLine, bestWp: e.bestWp });
      } else if (!f.mating && !f.unsure && f.best < LOSES && ply >= minPly) {
        out.push({ ...base, truth: false });
      }
    }
  }
  return out;
}

export type SenseResponse = 'hit' | 'miss' | 'wrong-reply' | 'unverified-reply' | 'correct-rejection' | 'false-alarm';
export interface SenseGrade {
  response: SenseResponse;
  correct: boolean;
  /** The learner's move differs from the stored line and the engine confirmed it. */
  alternative?: boolean;
  /** A different move was played and no engine value was supplied: ask the in-app engine. */
  needsEngine?: boolean;
}

/**
 * @param engineOpponentWp expected score (0-100) for the OPPONENT after the learner's reply,
 *   from the in-app engine, when the reply differs from the stored one.
 */
export function gradeSafety(item: SenseItem, answer: 'safe' | 'unsafe', replyUci: string | null, engineOpponentWp?: number): SenseGrade {
  if (!item.truth) return answer === 'safe' ? { response: 'correct-rejection', correct: true } : { response: 'false-alarm', correct: false };
  if (answer === 'safe') return { response: 'miss', correct: false };
  if (replyUci && replyUci === item.replyUci) return { response: 'hit', correct: true };
  if (engineOpponentWp === undefined) return { response: 'unverified-reply', correct: false, needsEngine: true };
  const reference = 100 - (item.playedWp ?? 0);
  return engineOpponentWp >= reference - ACCEPT_WITHIN ? { response: 'hit', correct: true, alternative: true } : { response: 'wrong-reply', correct: false };
}

/** @param engineWp expected score for the LEARNER after their move, when it differs from the stored best move. */
export function gradeChance(item: SenseItem, answer: 'something' | 'nothing', moveUci: string | null, engineWp?: number): SenseGrade {
  if (!item.truth) return answer === 'nothing' ? { response: 'correct-rejection', correct: true } : { response: 'false-alarm', correct: false };
  if (answer === 'nothing') return { response: 'miss', correct: false };
  if (moveUci && moveUci === item.best) return { response: 'hit', correct: true };
  if (engineWp === undefined) return { response: 'unverified-reply', correct: false, needsEngine: true };
  return engineWp >= (item.bestWp ?? 100) - ACCEPT_WITHIN ? { response: 'hit', correct: true, alternative: true } : { response: 'wrong-reply', correct: false };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Unseen items of one kind, half with something to find and half without, in a fixed pseudo-random order. */
export function pickSense(items: SenseItem[], kind: SenseKind, seen: Set<string>, n: number, seed: string): SenseItem[] {
  const pool = items.filter((i) => i.kind === kind && !seen.has(i.id));
  const order = (xs: SenseItem[]) => xs.slice().sort((a, b) => hash(`${seed}|${a.id}`) - hash(`${seed}|${b.id}`) || (a.id < b.id ? -1 : 1));
  const yes = order(pool.filter((i) => i.truth));
  const no = order(pool.filter((i) => !i.truth));
  const wantYes = Math.min(yes.length, Math.ceil(n / 2));
  const chosen = [...yes.slice(0, wantYes), ...no.slice(0, n - wantYes)];
  return order(chosen);
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
