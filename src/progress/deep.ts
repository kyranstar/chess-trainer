/**
 * The data behind the deep dive (ADR-062): openings, tactics and strategy, read from the games
 * and attempts already on the device. Pure functions; every new definition is stated where it
 * is made and in docs/METRICS.md, and nothing here changes a definition of ADR-061's cards.
 */
import type { Role } from 'chessops/types';
import { applyUci, fenOf, positionFromFen, sanOf } from '../chess/rules';
import type { Attempt } from '../db/types';
import { motifEvents, type Motif, MOTIFS, type MotifEvent } from '../games/motifs';
import type { GameRecord } from '../games/types';
import { unseenAccuracy } from '../metrics/metrics';
import { clusterRatio, type ClusterRatio } from '../metrics/stats';
import { familyOf, type OpeningNames, openingOf } from '../openings/names';
import { rapidRows, rateOf, type Rate, timelineOf } from './series';

export type Cohort = 'rapid' | 'all';
export type DeepArea = 'openings' | 'tactics' | 'strategy';
export const DEEP_AREAS: { key: DeepArea; title: string }[] = [
  { key: 'openings', title: 'Openings' },
  { key: 'tactics', title: 'Tactics' },
  { key: 'strategy', title: 'Strategy' },
];
export type Side = 'white' | 'black';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const byDate = (a: GameRecord, b: GameRecord) => (a.endDate + (a.endTime ?? '') < b.endDate + (b.endTime ?? '') ? -1 : 1);
const moveOf = (ply: number) => Math.floor(ply / 2) + 1;
const mine = (g: GameRecord, ply: number) => (ply % 2 === 0) === (g.color === 'white');

/** Rated rapid games (the cohort of every game chart), or every game with moves; oldest first. */
export function cohortGames(games: GameRecord[], cohort: Cohort): GameRecord[] {
  if (cohort === 'rapid') return rapidRows(games).map((r) => r.game);
  return games.filter((g) => g.moves.length > 0).slice().sort(byDate);
}

/** "26 rated rapid games", or "26 games of every kind". */
export function gamesText(n: number, cohort: Cohort): string {
  return cohort === 'rapid' ? `${n} rated rapid game${n === 1 ? '' : 's'}` : `${n} game${n === 1 ? '' : 's'} of every kind`;
}

// ---------------------------------------------------------------- results

export interface Results {
  n: number;
  w: number;
  d: number;
  l: number;
  /** Points per game: a win 1, a draw ½. Null with no games. */
  score: number | null;
}
export function resultsOf(games: GameRecord[]): Results {
  const done = games.filter((g) => g.result);
  const w = done.filter((g) => g.result === 'win').length;
  const d = done.filter((g) => g.result === 'draw').length;
  const l = done.filter((g) => g.result === 'loss').length;
  return { n: done.length, w, d, l, score: done.length ? (w + d / 2) / done.length : null };
}

// ---------------------------------------------------------------- openings

export interface TreeNode {
  /** The moves from the start, in SAN. */
  path: string[];
  san: string;
  games: GameRecord[];
  results: Results;
  /** The opening's name when this very position is named, else null. */
  name: string | null;
  children: TreeNode[];
}

/** How many plies the opening tree goes down: three moves each. */
export const TREE_PLIES = 6;

/**
 * His games with one colour as a tree of their first moves: each node the games that went
 * that way, children most played first.
 */
export function openingTree(games: GameRecord[], side: Side, names: OpeningNames | null, plies = TREE_PLIES): TreeNode {
  const root: TreeNode = { path: [], san: '', games: [], results: resultsOf([]), name: null, children: [] };
  const mineGames = games.filter((g) => g.color === side);
  root.games = mineGames;
  root.results = resultsOf(mineGames);
  for (const g of mineGames) {
    let node = root;
    let pos = positionFromFen(START);
    for (let i = 0; i < Math.min(plies, g.moves.length); i++) {
      const uci = g.moves[i]!;
      let san: string;
      try {
        san = sanOf(pos, uci);
        pos = applyUci(pos, uci);
      } catch {
        break;
      }
      let child = node.children.find((c) => c.san === san);
      if (!child) {
        const key = fenOf(pos).split(' ').slice(0, 4).join(' ');
        const at = names?.positions[key];
        child = { path: [...node.path, san], san, games: [], results: resultsOf([]), name: at === undefined ? null : names!.names[at]!, children: [] };
        node.children.push(child);
      }
      child.games.push(g);
      node = child;
    }
  }
  const finish = (n: TreeNode) => {
    n.results = resultsOf(n.games);
    n.children.sort((a, b) => b.games.length - a.games.length || (a.san < b.san ? -1 : 1));
    n.children.forEach(finish);
  };
  finish(root);
  return root;
}

/** The line most played to the tree's depth: the first child at each level. */
export function mainLine(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  let n = root;
  while (n.children[0]) {
    n = n.children[0];
    out.push(n);
  }
  return out;
}

/** The node reached by a path of SAN moves, or null. */
export function nodeAt(root: TreeNode, path: string[]): TreeNode | null {
  let n: TreeNode | undefined = root;
  for (const san of path) {
    n = n?.children.find((c) => c.san === san);
    if (!n) return null;
  }
  return n;
}

export const UNNAMED = 'Unnamed opening';

export interface FamilyRow {
  family: string;
  games: GameRecord[];
  results: Results;
}

/** A game's opening family (the deepest named position in its first 40 plies), or UNNAMED. */
export function familyOfGame(g: GameRecord, names: OpeningNames): string {
  return openingOf(g.moves, names)?.family ?? UNNAMED;
}

/** Families he played with one colour, most played first; past `top`, the rest are one row, "Other openings". */
export function openingFamilies(games: GameRecord[], side: Side, names: OpeningNames, top = 6): FamilyRow[] {
  const by = new Map<string, GameRecord[]>();
  for (const g of games.filter((x) => x.color === side)) {
    const f = familyOfGame(g, names);
    by.set(f, [...(by.get(f) ?? []), g]);
  }
  const rows = [...by.entries()].map(([family, gs]) => ({ family, games: gs, results: resultsOf(gs) })).sort((a, b) => b.games.length - a.games.length || (a.family < b.family ? -1 : 1));
  if (rows.length <= top + 1) return rows;
  const rest = rows.slice(top).flatMap((r) => r.games);
  return [...rows.slice(0, top), { family: 'Other openings', games: rest, results: resultsOf(rest) }];
}

/** His expected score (0–100, best play) before his move `move + 1`: his standing when the opening is over. Null if the game ended before. */
export function standingAfter(g: GameRecord, move = 10): number | null {
  const at = timelineOf(g).find((p) => p.move > move);
  return at ? at.wp : null;
}
/** Expected score from which he counts as ahead (about a pawn better) or behind. */
export const AHEAD = 60;
export const BEHIND = 40;

export interface StandingRow {
  label: string;
  points: { game: GameRecord; wp: number }[];
  ahead: number;
  behind: number;
}

/**
 * His standing after move 10, one point per game: the most played families with at least
 * `min` games such points, then all his games with that colour.
 */
export function afterOpening(games: GameRecord[], side: Side, names: OpeningNames | null, rows = 4, min = 3): { families: StandingRow[]; all: StandingRow } {
  const pts = games.filter((g) => g.color === side).map((game) => ({ game, wp: standingAfter(game) })).filter((p): p is { game: GameRecord; wp: number } => p.wp !== null);
  const row = (label: string, ps: { game: GameRecord; wp: number }[]): StandingRow => ({ label, points: ps, ahead: ps.filter((p) => p.wp >= AHEAD).length, behind: ps.filter((p) => p.wp <= BEHIND).length });
  const all = row('All', pts);
  if (!names) return { families: [], all };
  const by = new Map<string, { game: GameRecord; wp: number }[]>();
  for (const p of pts) {
    const f = familyOfGame(p.game, names);
    if (f === UNNAMED) continue;
    by.set(f, [...(by.get(f) ?? []), p]);
  }
  const families = [...by.entries()].filter(([, ps]) => ps.length >= min).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, rows).map(([f, ps]) => row(f, ps));
  return { families, all };
}

// ---------------------------------------------------------------- tactics

export interface MotifRow {
  motif: Motif;
  against: MotifEvent[];
  taken: MotifEvent[];
  missed: MotifEvent[];
}

/** Each motif both ways: used against him (big mistakes), and the clear chances he had, taken or missed. */
export function tacticsBothWays(games: GameRecord[]): { rows: MotifRow[]; events: MotifEvent[] } {
  const events = motifEvents(games);
  const rows = MOTIFS.map((motif) => ({
    motif,
    against: events.filter((e) => e.side === 'against' && e.motif === motif),
    taken: events.filter((e) => e.side === 'for' && e.motif === motif && e.taken),
    missed: events.filter((e) => e.side === 'for' && e.motif === motif && !e.taken),
  }));
  return { rows, events };
}

/** The motif that came up most, both ways together; "other" only if nothing else came up. */
export function topMotif(rows: MotifRow[]): MotifRow | null {
  const total = (r: MotifRow) => r.against.length + r.taken.length + r.missed.length;
  const named = rows.filter((r) => r.motif !== 'other' && total(r) > 0).sort((a, b) => total(b) - total(a) || MOTIFS.indexOf(a.motif) - MOTIFS.indexOf(b.motif));
  return named[0] ?? (rows.find((r) => r.motif === 'other' && total(r) > 0) ?? null);
}

export interface LossMap {
  /** Count per square, his side at the bottom: Black's squares mirrored by rank (the kingside stays on the right). */
  squares: Record<string, number>;
  pieces: Record<Exclude<Role, 'king'>, number>;
  total: number;
  events: MotifEvent[];
}

/** Where his pieces were taken in the big mistakes that cost material, and which pieces. */
export function lossMap(events: MotifEvent[]): LossMap {
  const out: LossMap = { squares: {}, pieces: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 }, total: 0, events: [] };
  for (const e of events) {
    if (e.side !== 'against' || !e.lost || e.lost.role === 'king') continue;
    const sq = e.game.color === 'black' ? `${e.lost.square[0]}${9 - Number(e.lost.square[1])}` : e.lost.square;
    out.squares[sq] = (out.squares[sq] ?? 0) + 1;
    out.pieces[e.lost.role]++;
    out.total++;
    out.events.push(e);
  }
  return out;
}

/** Lichess themes that name a tactic or a mate (not a length or a kind of ending). */
const NOT_MOTIFS = new Set(['long', 'short', 'pawnEndgame', 'rookEndgame', 'opening', 'middlegame', 'endgame', 'oneMove', 'veryLong', 'advantage', 'crushing', 'equality', 'mate', 'master', 'masterVsMaster', 'superGM']);

export interface ThemeRow {
  theme: string;
  rate: Rate;
  uuids: string[];
}

/** First-look puzzle results by theme, for themes seen at least `min` times, lowest share solved first. */
export function puzzleThemes(attempts: Attempt[], known: Record<string, unknown>, min = 5): ThemeRow[] {
  const ids = new Set(unseenAccuracy(attempts).attemptUuids);
  const by = new Map<string, Attempt[]>();
  for (const a of attempts) {
    if (!ids.has(a.uuid)) continue;
    for (const t of new Set(a.themes)) {
      if (NOT_MOTIFS.has(t) || !(t in known)) continue;
      by.set(t, [...(by.get(t) ?? []), a]);
    }
  }
  return [...by.entries()]
    .filter(([, xs]) => xs.length >= min)
    .map(([theme, xs]) => ({ theme, rate: rateOf(xs.filter((a) => a.outcome === 'success').length, xs.length), uuids: xs.map((a) => a.uuid) }))
    .sort((a, b) => a.rate.rate! - b.rate.rate! || b.rate.n - a.rate.n || (a.theme < b.theme ? -1 : 1));
}

export interface BandRow {
  lo: number;
  hi: number;
  label: string;
  rate: Rate;
}

/** First-look puzzle results by Lichess rating in bands of `width`, lowest first; bands with no puzzle are left out. */
export function puzzleBands(attempts: Attempt[], width = 200): BandRow[] {
  const ids = new Set(unseenAccuracy(attempts).attemptUuids);
  const rows = attempts.filter((a) => ids.has(a.uuid) && typeof a.rating === 'number');
  const by = new Map<number, Attempt[]>();
  for (const a of rows) {
    const lo = Math.floor(a.rating! / width) * width;
    by.set(lo, [...(by.get(lo) ?? []), a]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([lo, xs]) => ({ lo, hi: lo + width - 1, label: `${lo}`, rate: rateOf(xs.filter((a) => a.outcome === 'success').length, xs.length) }));
}

// ---------------------------------------------------------------- strategy

export interface Ribbon {
  game: GameRecord;
  /** His expected score before each of his moves. */
  cells: { move: number; ply: number; wp: number }[];
  /** Moves of his big mistakes. */
  mistakes: number[];
  /** His move that lost the most, and how much, if it was a big mistake. */
  turn: { move: number; ply: number; loss: number } | null;
}

/** Big mistake: 20 expected-score points or more (the major-error threshold, ADR-027). */
const MAJOR = 20;

export function ribbonOf(g: GameRecord): Ribbon {
  const cells = timelineOf(g);
  const events = g.analysis?.events.filter((e) => e.majorError) ?? [];
  const decisions = g.measure?.decisions ?? g.analysis?.decisions ?? [];
  const worst = decisions.reduce<[number, number, number | null] | null>((w, d) => (!w || d[1] > w[1] ? d : w), null);
  return {
    game: g,
    cells,
    mistakes: events.map((e) => moveOf(e.ply)),
    turn: worst && worst[1] >= MAJOR ? { move: moveOf(worst[0]), ply: worst[0], loss: worst[1] } : null,
  };
}

/** The last `n` games that have a measured timeline, newest first. */
export function ribbons(games: GameRecord[], n = 20): Ribbon[] {
  return games.map(ribbonOf).filter((r) => r.cells.length > 0).slice(-n).reverse();
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The median move of each game's largest single loss, over games where it was a big mistake. */
export function turningMove(rs: Ribbon[]): { move: number | null; games: number } {
  const turns = rs.filter((r) => r.turn).map((r) => r.turn!.move);
  return { move: median(turns) === null ? null : Math.round(median(turns)!), games: turns.length };
}

/** Expected score from which a position counts as won (about three pawns up), and to which as lost. */
export const WINNING = 75;
export const LOSING = 25;

export interface Conversion {
  winning: { games: GameRecord[]; won: GameRecord[]; rate: Rate };
  losing: { games: GameRecord[]; saved: GameRecord[]; rate: Rate };
}

/** Of the games where he stood winning at some move, how many he won; of those where he stood lost, how many he did not lose. */
export function conversion(games: GameRecord[]): Conversion {
  const done = games.filter((g) => g.result && timelineOf(g).length > 0);
  const winning = done.filter((g) => timelineOf(g).some((p) => p.wp >= WINNING));
  const won = winning.filter((g) => g.result === 'win');
  const losing = done.filter((g) => timelineOf(g).some((p) => p.wp <= LOSING));
  const saved = losing.filter((g) => g.result !== 'loss');
  return { winning: { games: winning, won, rate: rateOf(won.length, winning.length) }, losing: { games: losing, saved, rate: rateOf(saved.length, losing.length) } };
}

export interface Castle {
  game: GameRecord;
  /** The move he castled on, or null if he never did. */
  move: number | null;
  side: 'king' | 'queen' | null;
}

/** When and to which side he castled in each game. */
export function castlingOf(games: GameRecord[]): Castle[] {
  return games.map((game) => {
    let pos = positionFromFen(START);
    for (let i = 0; i < game.moves.length; i++) {
      let san: string;
      try {
        san = sanOf(pos, game.moves[i]!);
        pos = applyUci(pos, game.moves[i]!);
      } catch {
        break;
      }
      if (mine(game, i) && san.startsWith('O-O')) return { game, move: moveOf(i), side: san.startsWith('O-O-O') ? 'queen' : 'king' };
    }
    return { game, move: null, side: null };
  });
}
export const CASTLE_BY = 10;

export interface ClockPoint {
  move: number;
  /** Median share of the starting time left after the move (0–1). */
  median: number;
  q1: number;
  q3: number;
  n: number;
}

const quantile = (s: number[], q: number) => {
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const baseOf = (g: GameRecord) => Number(g.timeControl.split('+')[0]);
const incOf = (g: GameRecord) => Number(g.timeControl.split('+')[1] ?? 0) || 0;
const clocked = (g: GameRecord) => !!g.clocks && g.timeClass !== 'daily' && Number.isFinite(baseOf(g)) && baseOf(g) > 0;

/**
 * The share of the starting time left after each move, median over games, his and his
 * opponents', to the last move at least `min` games reached. Rapid and blitz games with clocks.
 */
export function clockCurves(games: GameRecord[], min = 10): { you: ClockPoint[]; them: ClockPoint[]; games: number } {
  const gs = games.filter(clocked);
  const per = (who: 'you' | 'them') => {
    const by = new Map<number, number[]>();
    for (const g of gs) {
      const base = baseOf(g);
      g.clocks!.forEach((c, ply) => {
        if (c === null || mine(g, ply) !== (who === 'you')) return;
        const m = moveOf(ply);
        by.set(m, [...(by.get(m) ?? []), Math.min(1.5, c / base)]);
      });
    }
    const out: ClockPoint[] = [];
    for (let m = 1; by.has(m) && by.get(m)!.length >= min; m++) {
      const s = [...by.get(m)!].sort((a, b) => a - b);
      out.push({ move: m, median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75), n: s.length });
    }
    return out;
  };
  return { you: per('you'), them: per('them'), games: gs.length };
}

export const THINK_BUCKETS = [
  { key: 'u5', label: 'Under 5 s', lo: 0, hi: 5 },
  { key: 'u15', label: '5 to 15 s', lo: 5, hi: 15 },
  { key: 'u60', label: '15 to 60 s', lo: 15, hi: 60 },
  { key: 'o60', label: 'Over a minute', lo: 60, hi: Infinity },
] as const;

export interface ThinkRow {
  key: string;
  label: string;
  decisions: number;
  errors: number;
  ratio: ClusterRatio | null;
}

/**
 * Big mistakes per move by the time the move took (clock before minus clock after, plus the
 * increment), from move 11 on and in undecided positions only (expected score 10 to 90, the
 * clock rule's filter), from the measurement record.
 */
export function thinkTime(games: GameRecord[]): { rows: ThinkRow[]; median: number | null; moves: number } {
  const per = THINK_BUCKETS.map(() => new Map<string, { events: number; decisions: number }>());
  const spentAll: number[] = [];
  for (const g of games.filter(clocked)) {
    const m = g.measure;
    if (!m?.facts) continue;
    const wpAt = new Map(m.facts.map((f) => [f.ply, f.wp]));
    let before: number | null = baseOf(g);
    for (const [ply, loss, clock] of m.decisions) {
      const wp = wpAt.get(ply);
      if (before !== null && clock !== null && moveOf(ply) > 10 && wp !== undefined && wp >= 10 && wp <= 90) {
        const spent = Math.max(0, before - clock + incOf(g));
        spentAll.push(spent);
        const i = THINK_BUCKETS.findIndex((b) => spent >= b.lo && spent < b.hi);
        const c = per[i]!.get(g.id) ?? { events: 0, decisions: 0 };
        c.decisions++;
        if (loss >= MAJOR) c.events++;
        per[i]!.set(g.id, c);
      }
      before = clock;
    }
  }
  const rows = THINK_BUCKETS.map((b, i) => {
    const xs = [...per[i]!.values()];
    return { key: b.key, label: b.label, decisions: xs.reduce((t, x) => t + x.decisions, 0), errors: xs.reduce((t, x) => t + x.events, 0), ratio: clusterRatio(xs) };
  });
  return { rows, median: median(spentAll), moves: spentAll.length };
}

export type EndKind = 'mate' | 'resign' | 'time' | 'abandon' | 'other';
export const END_KINDS: { key: EndKind; label: string }[] = [
  { key: 'mate', label: 'Checkmate' },
  { key: 'resign', label: 'Resignation' },
  { key: 'time', label: 'On time' },
  { key: 'abandon', label: 'Abandoned' },
  { key: 'other', label: 'Other' },
];

/** How a decided game ended, from Chess.com's wording ("X won by checkmate", "X won on time"). */
export function endOf(g: GameRecord): EndKind {
  const t = (g.termination ?? '').toLowerCase();
  if (/checkmate/.test(t)) return 'mate';
  if (/resignation/.test(t)) return 'resign';
  if (/on time/.test(t)) return 'time';
  if (/abandon/.test(t)) return 'abandon';
  return 'other';
}

export function endings(games: GameRecord[]): { rows: { key: EndKind; label: string; wins: GameRecord[]; losses: GameRecord[] }[]; draws: GameRecord[]; wins: number; losses: number } {
  const rows = END_KINDS.map((k) => ({ ...k, wins: games.filter((g) => g.result === 'win' && endOf(g) === k.key), losses: games.filter((g) => g.result === 'loss' && endOf(g) === k.key) }));
  return { rows: rows.filter((r) => r.key !== 'other' || r.wins.length + r.losses.length > 0), draws: games.filter((g) => g.result === 'draw'), wins: games.filter((g) => g.result === 'win').length, losses: games.filter((g) => g.result === 'loss').length };
}

export { familyOf };
