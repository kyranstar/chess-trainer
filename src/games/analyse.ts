/**
 * Analysis of one of the owner's games, on the device (analysis v3). The engine name and
 * node budget are recorded with every analysis; records made with different settings are
 * never pooled silently.
 */
import { makeSanVariation } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { applyUci, type Color, fenOf, legalDests, positionFromFen, sanOf } from '../chess/rules';
import type { PvLine, UciEngine } from '../engine/uci';
import { winPercent } from '../engine/uci';
import type { DecisionFact, GameAnalysis, GameEvent, PipelineGame } from './types';

export const ANALYSIS_VERSION = 'game-analysis-v3';
export const RULES = { majorLoss: 20, missLoss: 10, materialSwing: 2, pvPlies: 5, uniqueGap: 20 };
/** Node budget for the small in-app engine: enough to see a 20-point drop, light on battery. */
export const DEVICE_NODES = 60_000;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VALUES = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 } as const;
type Pos = ReturnType<typeof positionFromFen>;

/** In an undecided position (expected score inside this range) a real loss shows in the score. */
export const UNDECIDED = { lo: 10, hi: 90 };
/** Below this expected-score loss, in an undecided position, lost material is treated as a sacrifice the engine accepts. */
export const SOUND_WITHIN = 2;

/**
 * The target behaviour, defined by what happens on the board rather than by a score drop:
 * the move allowed an avoidable mate, or lost at least two points of material in a short
 * line that the best move would not have lost. The expected-score scale flattens out in
 * positions that are already won or lost, so a piece hung there barely moves the score; it
 * is still counted. A sacrifice the engine accepts in an undecided position is not.
 */
export function targetKind(f: DecisionFact, loss: number): 'mate' | 'material' | null {
  if (f.mated) return 'mate';
  if (f.unsure) return null; // a line cut off mid-exchange proves nothing about material
  const loses = f.played <= -RULES.materialSwing && f.best - f.played >= RULES.materialSwing;
  if (!loses) return null;
  if (f.wp >= UNDECIDED.lo && f.wp <= UNDECIDED.hi && loss < SOUND_WITHIN) return null;
  return 'material';
}

/** What the analysis needs from an engine (the real one, or a scripted one in tests). */
export type Evaluator = Pick<UciEngine, 'analyse'>;

export function material(pos: Pos, color: Color): number {
  const other: Color = color === 'white' ? 'black' : 'white';
  let total = 0;
  for (const [role, v] of Object.entries(VALUES) as [keyof typeof VALUES, number][]) {
    total += v * (pos.board[role].intersect(pos.board[color]).size() - pos.board[role].intersect(pos.board[other]).size());
  }
  return total;
}

function isCapture(pos: Pos, uci: string): boolean {
  const to = uci.slice(2, 4);
  const toSq = to.charCodeAt(0) - 97 + (Number(to[1]) - 1) * 8;
  const fromSq = uci.charCodeAt(0) - 97 + (Number(uci[1]) - 1) * 8;
  return pos.board.occupied.has(toSq) || (pos.board.pawn.has(fromSq) && pos.epSquare === toSq);
}

/**
 * Balance for `color` after the first plies of a line, ending on a non-capture where
 * possible, and whether the line is settled there. It is not settled when it stops right
 * after a capture (the recapture may be pending): the engine's line ran out, or captures
 * were still going on at the cut-off.
 */
export function lineEnd(fen: string, pv: string[], color: Color): { balance: number; settled: boolean } {
  let pos = positionFromFen(fen);
  let last = material(pos, color);
  let lastWasCapture = false;
  for (let i = 0; i < pv.length; i++) {
    const uci = pv[i]!;
    let capture: boolean;
    try {
      capture = isCapture(pos, uci);
      if (i >= RULES.pvPlies && !capture) return { balance: last, settled: true };
      if (i >= RULES.pvPlies + 2) return { balance: last, settled: false };
      pos = applyUci(pos, uci);
    } catch {
      return { balance: last, settled: false }; // an engine line that our rules library rejects
    }
    lastWasCapture = capture;
    last = material(pos, color);
  }
  return { balance: last, settled: !lastWasCapture || pos.isEnd() };
}

export function materialAfter(fen: string, pv: string[], color: Color): number {
  return lineEnd(fen, pv, color).balance;
}

export function lineSan(fen: string, pv: string[]): string {
  const pos = positionFromFen(fen);
  const moves = pv.slice(0, RULES.pvPlies).map((u) => parseUci(u)).filter((m): m is NonNullable<typeof m> => !!m);
  try {
    return makeSanVariation(pos, moves);
  } catch {
    return pv.slice(0, RULES.pvPlies).join(' ');
  }
}

const mateIn = (line: PvLine) => ('mate' in line.score ? line.score.mate : null);

export interface AnalyseOptions {
  nodes?: number;
  /** Called between decisions; return false to stop early (the partial result is discarded). */
  keepGoing?: () => boolean;
}

/** Returns null if stopped early. */
export async function analyseGame(game: Pick<PipelineGame, 'moves' | 'color' | 'clocks'>, engine: Evaluator, opts: AnalyseOptions = {}): Promise<GameAnalysis | null> {
  const nodes = opts.nodes ?? DEVICE_NODES;
  const color = game.color;
  const decisions: GameAnalysis['decisions'] = [];
  const events: GameEvent[] = [];
  const facts: DecisionFact[] = [];
  let pos = positionFromFen(START);
  let beforeOpponent = material(pos, color);
  for (let ply = 0; ply < game.moves.length; ply++) {
    const uci = game.moves[ply]!;
    if (pos.turn !== color) {
      pos = applyUci(pos, uci);
      continue;
    }
    if (opts.keepGoing && !opts.keepGoing()) return null;
    const fen = fenOf(pos);
    let legal = 0;
    for (const tos of legalDests(pos).values()) legal += tos.length;
    const lines = await engine.analyse(fen, nodes, legal > 1 ? 2 : 1);
    const best = lines[0];
    if (!best) {
      pos = applyUci(pos, uci);
      continue;
    }
    const bestWp = winPercent(best.score);
    const secondWp = lines[1] ? winPercent(lines[1].score) : null;
    const after = applyUci(pos, uci);
    const afterFen = fenOf(after);
    const samePlayed = positionKeyOf(applyUci(pos, best.move)) === positionKeyOf(after);
    let playedWp: number;
    let replyPv: string[] = [];
    let replyMate: number | null = null;
    if (samePlayed) playedWp = bestWp;
    else if (after.isCheckmate()) playedWp = 100;
    else if (after.isEnd()) playedWp = 50;
    else {
      const reply = (await engine.analyse(afterFen, nodes, 1))[0];
      // The reply is scored from the opponent's side.
      playedWp = reply ? 100 - winPercent(reply.score) : bestWp;
      replyPv = reply?.pv ?? [];
      replyMate = reply ? mateIn(reply) : null;
    }
    const loss = Math.max(0, bestWp - playedWp);
    const clock = game.clocks ? (game.clocks[ply] ?? null) : null;
    decisions.push([ply, round1(loss), clock]);

    const here = material(pos, color);
    const bestLine = lineEnd(fen, best.pv, color);
    const bestEnd = bestLine.balance;
    const playedLine = samePlayed ? bestLine : replyPv.length ? lineEnd(afterFen, replyPv, color) : { balance: material(after, color), settled: after.isEnd() };
    const playedEnd = playedLine.balance;
    const unsure = !(bestLine.settled && playedLine.settled);
    const bestMate = mateIn(best);
    let opportunity: GameEvent['opportunity'] = null;
    if (bestMate !== null && bestMate > 0) opportunity = 'mate';
    else if (bestEnd - beforeOpponent >= RULES.materialSwing && bestWp >= 60) opportunity = 'material';
    const missed = opportunity !== null && !samePlayed && loss >= RULES.missLoss;

    let label: GameEvent['errorLabel'] = null;
    if (!samePlayed && loss >= RULES.majorLoss) {
      if (!after.isEnd() && replyMate !== null && replyMate > 0 && replyMate <= 3) label = 'allows-mate';
      else if (playedEnd - here <= -RULES.materialSwing) label = 'loses-material';
      else if (bestEnd - playedEnd >= RULES.materialSwing) label = 'misses-material';
      else label = 'unclassified';
    }
    const mated = !samePlayed && !after.isEnd() && replyMate !== null && replyMate > 0 && replyMate <= 3 && !(bestMate !== null && bestMate < 0);
    const fact: DecisionFact = { ply, wp: round1(bestWp), played: playedEnd - here, best: bestEnd - here, ...(mated ? { mated: true as const } : {}), ...(bestMate !== null && bestMate > 0 ? { mating: true as const } : {}), ...(unsure ? { unsure: true as const } : {}) };
    facts.push(fact);
    const target = samePlayed ? null : targetKind(fact, loss);
    if (opportunity || label || target) {
      events.push({
        ply,
        fen,
        played: uci,
        playedSan: sanOf(pos, uci),
        best: best.move,
        bestSan: sanOf(pos, best.move),
        bestLine: lineSan(fen, best.pv),
        bestWp: round1(bestWp),
        secondWp: secondWp === null ? null : round1(secondWp),
        playedWp: round1(playedWp),
        loss: round1(loss),
        clock,
        opportunity,
        missed,
        majorError: label !== null,
        errorLabel: label,
        refutation: (label || target) && replyPv.length ? lineSan(afterFen, replyPv) : null,
        drill: !samePlayed && secondWp !== null && bestWp - secondWp >= RULES.uniqueGap && loss >= RULES.missLoss,
        target,
      });
    }
    pos = after;
    beforeOpponent = material(pos, color);
  }
  return { decisions, events, facts };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const positionKeyOf = (pos: Pos) => fenOf(pos).split(' ').slice(0, 4).join(' ');

export function analysisKeyFor(engineName: string, nodes: number): string {
  return `${ANALYSIS_VERSION}/${engineName}/${nodes}`;
}
