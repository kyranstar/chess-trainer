/**
 * The data behind the Progress page (ADR-061): per-game rows, rolling and block rates, the
 * breakdowns of "How you play", a game's moments, the first-look strips, activity by day and
 * the concept grid. Pure functions over the stored records; every definition is the one the
 * older cards used (early blunders, major errors, clear chances, the clock rule), reused, not
 * copied.
 */
import type { Attempt } from '../db/types';
import { clearChances, clockPressure, earlyBlunderGames, LOW_CLOCK_FRACTION, type ClearChance, type ClockPressure, type EventRef } from '../games/metrics';
import type { GameEvent, GameRecord } from '../games/types';
import { needsRefresh, type ConceptStatus } from '../learn/curriculum';
import { unseenAccuracy, wilson } from '../metrics/metrics';
import { blocksOf, clusterRatio, type ClusterRatio } from '../metrics/stats';
import { isSoundGrade, ownMoveFirstLooks, ownMoveGrade } from '../schedule/pace';
import { localDate } from '../schedule/session';

/** A rate with its 95% Wilson range. */
export interface Rate {
  k: number;
  n: number;
  rate: number | null;
  lo: number;
  hi: number;
}
export function rateOf(k: number, n: number): Rate {
  const w = wilson(k, n);
  return { k, n, rate: n ? k / n : null, lo: w.lo, hi: w.hi };
}

/** One rated rapid game as the Progress page sees it. */
export interface GameRow {
  game: GameRecord;
  /** 1-based position among rated rapid games, oldest first. */
  index: number;
  ratingChange: number | null;
  analysed: boolean;
  /** Major errors (20+ expected-score points) and decisions, from the game's analysis. */
  errors: number;
  decisions: number;
  /** The early-blunder measure (ADR-027/032): measured with the one protocol, and its first such move. */
  early: { measured: boolean; event: GameEvent | null };
  chances: ClearChance[];
}

/** Rated rapid games with moves, oldest first: the cohort of every game chart. */
export function rapidRows(games: GameRecord[]): GameRow[] {
  const early = earlyBlunderGames(games, { timeClass: 'rapid' });
  let prev: number | null = null;
  return early.strip.map(({ game, measured, event }, i) => {
    const a = game.analysis;
    const change = game.playerRating !== null && prev !== null ? game.playerRating - prev : null;
    if (game.playerRating !== null) prev = game.playerRating;
    return {
      game,
      index: i + 1,
      ratingChange: change,
      analysed: !!a,
      errors: a ? a.events.filter((e) => e.majorError).length : 0,
      decisions: a ? a.decisions.length : 0,
      early: { measured, event },
      chances: clearChances(game),
    };
  });
}

/** The day training began: the local date of the first recorded attempt. */
export function trainingStartOf(attempts: Attempt[]): string | null {
  let first = Infinity;
  for (const a of attempts) if (a.ts < first) first = a.ts;
  return Number.isFinite(first) ? localDate(first) : null;
}

/** The index of the first game played on or after the day training began, or null. */
export function trainingIndex(rows: GameRow[], start: string | null): number | null {
  if (!start) return null;
  const r = rows.find((x) => x.game.endDate >= start);
  return r ? r.index : null;
}

/** Early blunders over a set of rows: measured games only. */
export function earlyRate(rows: GameRow[]): Rate {
  const m = rows.filter((r) => r.early.measured);
  return rateOf(m.filter((r) => r.early.event).length, m.length);
}

/** Major errors per decision over rows, with the game as the cluster. */
export function errorRatio(rows: GameRow[]): ClusterRatio | null {
  return clusterRatio(rows.filter((r) => r.analysed).map((r) => ({ events: r.errors, decisions: r.decisions })));
}

export interface RollingPoint {
  index: number;
  rate: number;
  lo: number;
  hi: number;
}

/** The pooled major-error rate over each run of `window` analysed games, ending at each game from the window-th on. */
export function rollingErrors(rows: GameRow[], window = 20): RollingPoint[] {
  const done = rows.filter((r) => r.analysed && r.decisions > 0);
  const out: RollingPoint[] = [];
  for (let i = window - 1; i < done.length; i++) {
    const r = errorRatio(done.slice(i - window + 1, i + 1));
    if (r) out.push({ index: done[i]!.index, rate: r.rate, lo: r.lo, hi: r.hi });
  }
  return out;
}

/** Clear chances over rows, in game order. */
export function chanceList(rows: GameRow[]): { row: GameRow; chance: ClearChance }[] {
  return rows.flatMap((row) => row.chances.map((chance) => ({ row, chance })));
}

const moveOf = (ply: number) => Math.floor(ply / 2) + 1;

export const PHASES = [
  { key: '1-9', label: 'Moves 1–9', lo: 1, hi: 9 },
  { key: '10-19', label: 'Moves 10–19', lo: 10, hi: 19 },
  { key: '20-29', label: 'Moves 20–29', lo: 20, hi: 29 },
  { key: '30+', label: 'Moves 30+', lo: 30, hi: Infinity },
] as const;
export type PhaseKey = (typeof PHASES)[number]['key'];

export interface PhaseRow {
  key: PhaseKey;
  label: string;
  ratio: ClusterRatio | null;
  events: EventRef[];
}

/** Major errors per decision by the move number of the decision, each with the game as the cluster. */
export function byPhase(rows: GameRow[]): PhaseRow[] {
  const done = rows.filter((r) => r.analysed);
  return PHASES.map((p) => {
    const inPhase = (ply: number) => moveOf(ply) >= p.lo && moveOf(ply) <= p.hi;
    const per = done.map((r) => ({
      events: r.game.analysis!.events.filter((e) => e.majorError && inPhase(e.ply)),
      decisions: r.game.analysis!.decisions.filter((d) => inPhase(d[0])).length,
      game: r.game,
    }));
    return {
      key: p.key,
      label: p.label,
      ratio: clusterRatio(per.map((x) => ({ events: x.events.length, decisions: x.decisions }))),
      events: per.flatMap((x) => x.events.map((event) => ({ game: x.game, event }))),
    };
  });
}

export const ERROR_LABELS = ['loses-material', 'allows-mate', 'misses-material', 'unclassified'] as const;
export type ErrorLabel = (typeof ERROR_LABELS)[number];

/** Major errors by their concrete label, most frequent first, with how many games each came in. */
export function byType(rows: GameRow[]): { label: ErrorLabel; count: number; games: number; events: EventRef[] }[] {
  const done = rows.filter((r) => r.analysed);
  return ERROR_LABELS.map((label) => {
    const events = done.flatMap((r) => r.game.analysis!.events.filter((e) => e.majorError && (e.errorLabel ?? 'unclassified') === label).map((event) => ({ game: r.game, event })));
    return { label, count: events.length, games: new Set(events.map((e) => e.game.id)).size, events };
  }).sort((a, b) => b.count - a.count || ERROR_LABELS.indexOf(a.label) - ERROR_LABELS.indexOf(b.label));
}

/** White against Black: major errors per decision and the early-blunder share. */
export function byColour(rows: GameRow[]): Record<'white' | 'black', { games: number; ratio: ClusterRatio | null; early: Rate }> {
  const of = (c: 'white' | 'black') => {
    const mine = rows.filter((r) => r.game.color === c);
    return { games: mine.length, ratio: errorRatio(mine), early: earlyRate(mine) };
  };
  return { white: of('white'), black: of('black') };
}

/** The clock rule of the older card (under 10% of the base, undecided positions), over these games. */
export function byClock(rows: GameRow[]): ClockPressure {
  return clockPressure(rows.map((r) => r.game));
}

export type MomentKind = 'early' | 'biggest' | 'chance' | 'clock';
export interface Moment {
  kind: MomentKind;
  ply: number;
  move: number;
  label: string;
}

const MOMENT_LABEL: Record<MomentKind, string> = { early: 'Early blunder', biggest: 'Biggest mistake', chance: 'Missed chance', clock: 'Short of time' };

/**
 * The moments of one game worth looking at, in this order and each position once: the first
 * early blunder, the largest major error, the first clear chance never taken, the first major
 * error made with under 10% of the base time on the clock. None is a claim about why.
 */
export function momentsOf(row: GameRow): Moment[] {
  const out: Moment[] = [];
  const add = (kind: MomentKind, ply: number | undefined) => {
    if (ply === undefined || out.some((m) => m.ply === ply)) return;
    out.push({ kind, ply, move: moveOf(ply), label: MOMENT_LABEL[kind] });
  };
  const a = row.game.analysis;
  add('early', row.early.event?.ply);
  if (a) {
    const big = a.events.filter((e) => e.majorError).sort((x, y) => y.loss - x.loss || x.ply - y.ply)[0];
    add('biggest', big?.ply);
  }
  add('chance', row.chances.find((c) => !c.taken)?.ply);
  if (a) {
    const base = Number(row.game.timeControl.split('+')[0]);
    if (row.game.clocks && Number.isFinite(base) && base > 0) {
      const errs = new Set(a.events.filter((e) => e.majorError).map((e) => e.ply));
      let before: number | null = base;
      for (const [ply, , clock] of a.decisions) {
        if (before !== null && before < base * LOW_CLOCK_FRACTION && errs.has(ply)) {
          add('clock', ply);
          break;
        }
        before = clock;
      }
    }
  }
  return out;
}

/** Your expected score (0–100, best play) before each of your moves: the measurement record's, else the analysis's. */
export function timelineOf(g: GameRecord): { ply: number; move: number; wp: number }[] {
  const facts = g.measure?.facts ?? g.analysis?.facts ?? [];
  return facts.map((f) => ({ ply: f.ply, move: moveOf(f.ply), wp: f.wp }));
}

export type NextAction = { kind: 'review'; row: GameRow; moment: Moment } | { kind: 'due'; count: number } | { kind: 'none' };

/**
 * One thing to do, by a fixed rule: the first moment of the latest analysed rated rapid game;
 * else positions from his games due again; else nothing.
 */
export function nextAction(rows: GameRow[], dueFromGames: number): NextAction {
  const latest = [...rows].reverse().find((r) => r.analysed);
  const moment = latest ? momentsOf(latest)[0] : undefined;
  if (latest && moment) return { kind: 'review', row: latest, moment };
  if (dueFromGames > 0) return { kind: 'due', count: dueFromGames };
  return { kind: 'none' };
}

/** One first-look answer: right or not, in the order given. */
export interface Mark {
  ok: boolean;
  ts: number;
  uuid: string;
}
const byTs = (a: Attempt, b: Attempt) => a.ts - b.ts;

/** Unseen puzzles, first-ever showing, in order: solved with no wrong move and no hint, or not. */
export function puzzleMarks(attempts: Attempt[]): Mark[] {
  const ids = new Set(unseenAccuracy(attempts).attemptUuids);
  return attempts.filter((a) => ids.has(a.uuid)).sort(byTs).map((a) => ({ ok: a.outcome === 'success', ts: a.ts, uuid: a.uuid }));
}

/** "Your move" first looks the engine rated, in order: sound (best, good or an inaccuracy) or not. */
export function ownMoveMarks(attempts: Attempt[]): { marks: Mark[]; unrated: number } {
  const rows = ownMoveFirstLooks(attempts).sort(byTs);
  const rated = rows.filter((a) => ownMoveGrade(a) !== 'unrated');
  return { marks: rated.map((a) => ({ ok: isSoundGrade(ownMoveGrade(a)), ts: a.ts, uuid: a.uuid })), unrated: rows.length - rated.length };
}

/**
 * First-look answers to "Is this move safe?" or "Anything to win here?", split by what was
 * really there: `spotted` holds the positions with something there (ok = he said so),
 * `alarms` the positions with nothing there (ok = he called something that was not there).
 */
export function senseMarks(attempts: Attempt[], kind: 'safe-or-not' | 'chance-or-not'): { spotted: Mark[]; alarms: Mark[] } {
  const rows = attempts.filter((a) => a.exerciseKind === 'sense' && a.fresh && a.outcome !== 'skipped' && a.themes[0] === kind).sort(byTs);
  const positive = (a: Attempt) => a.themes[1] === 'unsafe' || a.themes[1] === 'chance';
  const negative = (a: Attempt) => a.themes[1] === 'safe' || a.themes[1] === 'none';
  return {
    spotted: rows.filter(positive).map((a) => ({ ok: a.themes[2] !== 'miss', ts: a.ts, uuid: a.uuid })),
    alarms: rows.filter(negative).map((a) => ({ ok: a.themes[2] !== 'correct-rejection', ts: a.ts, uuid: a.uuid })),
  };
}

export const rateOfMarks = (marks: Mark[]): Rate => rateOf(marks.filter((m) => m.ok).length, marks.length);

/** Consecutive blocks of `size` first looks, oldest first, each with its rate; the incomplete rest is pending. */
export function markBlocks(marks: Mark[], size = 20): { blocks: Rate[]; pending: Mark[] } {
  const { blocks, pending } = blocksOf(marks, size);
  return { blocks: blocks.map(rateOfMarks), pending };
}

export interface Day {
  date: string;
  firstLooks: number;
  other: number;
  /** Before the first recorded attempt nothing was being recorded: not tracked, not zero. */
  tracked: boolean;
}

/** Positions answered per local day for the last `days` days, today last. Skips are not counted. */
export function activityDays(attempts: Attempt[], now: number, days = 28): Day[] {
  const start = trainingStartOf(attempts);
  const counts = new Map<string, { firstLooks: number; other: number }>();
  for (const a of attempts) {
    if (a.outcome === 'skipped') continue;
    const d = localDate(a.ts);
    const c = counts.get(d) ?? { firstLooks: 0, other: 0 };
    if (a.fresh) c.firstLooks++;
    else c.other++;
    counts.set(d, c);
  }
  const out: Day[] = [];
  const today = new Date(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12).getTime());
    const c = counts.get(d) ?? { firstLooks: 0, other: 0 };
    out.push({ date: d, ...c, tracked: start !== null && d >= start });
  }
  return out;
}

export type CellState = 'passed' | 'recheck' | 'failed' | 'studied' | 'started' | 'new';
export interface ConceptCell {
  id: string;
  title: string;
  state: CellState;
  /** The concept has an independent check at all. */
  checkable: boolean;
}

/** One cell per concept, in curriculum order. */
export function conceptCells(statuses: ConceptStatus[], now: number): ConceptCell[] {
  return [...statuses]
    .sort((a, b) => a.concept.order - b.concept.order)
    .map((s) => ({
      id: s.concept.id,
      title: s.concept.title,
      checkable: s.assessable,
      state: s.stage === 'demonstrated' ? (needsRefresh(s, now) ? 'recheck' : 'passed') : s.lastCheck && !s.lastCheck.passed ? 'failed' : s.stage === 'taught' ? 'studied' : s.stage === 'started' ? 'started' : 'new',
    }));
}
