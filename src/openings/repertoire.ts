/**
 * Opening repertoire model.
 *
 * The repertoire is the learner's own: for each position where it is their move, the move
 * THEY have chosen to play (for example from their Chessreps course, which stays on
 * Chessreps). The app adds two kinds of evidence and nothing else:
 *   - how often real players in a chosen rating band reach each position (Lichess game
 *     database, CC0), which orders what to learn first and weights the coverage metric;
 *   - a precomputed engine evaluation of the moves people play there, shown as evidence
 *     when a move is chosen. The engine never picks the repertoire.
 *
 * Positions are identified by `positionKey` (placement, side to move, castling rights,
 * legally relevant en passant), so transpositions are one decision.
 */
import { applyUci, fenOf, positionFromFen, positionKey, sanOf } from '../chess/rules';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export type Side = 'white' | 'black';

export interface BookMove {
  uci: string;
  san: string;
  /** Games in which this move was played, per rating band of the mover. */
  n: number[];
  /** Engine expected score (0-100) for the mover after this move. */
  wp?: number;
}
export interface BookPosition {
  n: number[];
  moves: BookMove[];
  /** Engine expected score of the engine's first choice here, and that move. */
  bestWp?: number;
  bestSan?: string;
}
export interface OpeningBook {
  manifest: {
    id: string;
    version: string;
    bands: number[];
    source: { month: string; license: string; url: string; note?: string };
    games: { used: number };
    filters: Record<string, unknown>;
    engine?: { name: string; nodes: number };
  };
  positions: Record<string, BookPosition>;
}

/** The learner's chosen move in one position. User-authored; included in backups. */
export interface RepertoireEntry {
  id: string;
  side: Side;
  positionKey: string;
  fen: string;
  uci: string;
  san: string;
  /** One SAN move order that reaches the position (for display). */
  path: string[];
  addedAt: number;
  updatedAt: number;
}

export function entryId(side: Side, key: string): string {
  return `${side}|${key}`;
}

const sum = (xs: number[], idx: number[]) => idx.reduce((t, i) => t + (xs[i] ?? 0), 0);

export interface Decision {
  positionKey: string;
  fen: string;
  path: string[];
  ply: number;
  /** Share of games (in the chosen bands) that reach this position, given the repertoire so far. */
  reach: number;
  entry: RepertoireEntry | null;
}
export interface Level {
  /** The learner's 1st, 2nd, ... move. */
  myMove: number;
  /** Share of games in which the learner has an answer at this move. */
  answered: number;
  /** Share that reaches a position at this move with no chosen answer. */
  gap: number;
  /** Share that leaves the data before this move (opponent position with no statistics). */
  beyondData: number;
  /** Share lost to opponent moves too rare to be listed. */
  rare: number;
}
export interface Walk {
  decisions: Decision[];
  /** Unanswered decisions, most frequently reached first. */
  gaps: Decision[];
  levels: Level[];
}

export const WALK_DEFAULTS = { maxMyMoves: 10, minReach: 0.002 };

/**
 * Follows the repertoire through the book: at the learner's moves it plays their chosen
 * move; at the opponent's moves it branches by how often each reply is played in `bands`.
 */
export function walkRepertoire(book: OpeningBook, entries: RepertoireEntry[], side: Side, bands: number[], opts = WALK_DEFAULTS): Walk {
  const mine = new Map(entries.filter((e) => e.side === side).map((e) => [e.positionKey, e]));
  type Node = { fen: string; path: string[]; reach: number };
  let frontier = new Map<string, Node>([[positionKey(START_FEN), { fen: START_FEN, path: [], reach: 1 }]]);
  const decisions: Decision[] = [];
  const levels: Level[] = [];
  const level = (n: number): Level => (levels[n - 1] ??= { myMove: n, answered: 0, gap: 0, beyondData: 0, rare: 0 });
  const push = (map: Map<string, Node>, fen: string, path: string[], reach: number) => {
    const key = positionKey(fen);
    const seen = map.get(key);
    if (seen) seen.reach += reach;
    else map.set(key, { fen, path, reach });
  };

  for (let ply = 0; frontier.size > 0 && ply < opts.maxMyMoves * 2; ply++) {
    const next = new Map<string, Node>();
    for (const [key, node] of frontier) {
      const pos = positionFromFen(node.fen);
      if (pos.turn === side) {
        const lv = level(Math.floor(ply / 2) + 1);
        const entry = mine.get(key) ?? null;
        decisions.push({ positionKey: key, fen: node.fen, path: node.path, ply, reach: node.reach, entry });
        if (!entry) {
          lv.gap += node.reach;
          continue;
        }
        lv.answered += node.reach;
        push(next, fenOf(applyUci(pos, entry.uci)), [...node.path, entry.san], node.reach);
      } else {
        const lv = level(Math.floor((ply + 1) / 2) + 1);
        const data = book.positions[key];
        const total = data ? sum(data.n, bands) : 0;
        if (!data || total === 0) {
          lv.beyondData += node.reach;
          continue;
        }
        let listed = 0;
        for (const m of data.moves) {
          const share = sum(m.n, bands) / total;
          const reach = node.reach * share;
          if (share === 0) continue;
          if (reach < opts.minReach) continue;
          listed += share;
          push(next, fenOf(applyUci(pos, m.uci)), [...node.path, m.san], reach);
        }
        lv.rare += node.reach * Math.max(0, 1 - listed);
      }
    }
    frontier = next;
  }
  const gaps = decisions.filter((d) => !d.entry).sort((a, b) => b.reach - a.reach || (a.path.join(' ') < b.path.join(' ') ? -1 : 1));
  return { decisions, gaps, levels };
}

/** Largest expected-score gap to the engine's first choice that still counts as a sound choice. */
export const SOUND_MARGIN = 8;

export interface MoveEvidence {
  verdict: 'sound' | 'weaker' | 'unknown';
  wp?: number;
  bestWp?: number;
  bestSan?: string;
  /** Share of games in which players in the chosen bands play this move here. */
  played?: number;
}

/** Engine evidence for playing `uci` in a book position. Missing data is 'unknown', never 'bad'. */
export function classifyMove(book: OpeningBook, key: string, uci: string, bands?: number[]): MoveEvidence {
  const pos = book.positions[key];
  const move = pos?.moves.find((m) => m.uci === uci);
  const played = pos && move && bands ? sum(move.n, bands) / Math.max(1, sum(pos.n, bands)) : undefined;
  if (!pos || !move || move.wp === undefined || pos.bestWp === undefined) return { verdict: 'unknown', played };
  return { verdict: pos.bestWp - move.wp <= SOUND_MARGIN ? 'sound' : 'weaker', wp: move.wp, bestWp: pos.bestWp, bestSan: pos.bestSan, played };
}

export function makeEntry(side: Side, fen: string, path: string[], uci: string, now: number): RepertoireEntry {
  const key = positionKey(fen);
  return { id: entryId(side, key), side, positionKey: key, fen, uci, san: sanOf(positionFromFen(fen), uci), path, addedAt: now, updatedAt: now };
}

/** Review-queue id for recalling the repertoire move in a position. */
export function drillId(entry: RepertoireEntry): string {
  return `opening:${entry.id}`;
}

/** "1. e4 e5 2. Nf3" from a SAN list. */
export function pathNumbered(path: string[]): string {
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');
}
