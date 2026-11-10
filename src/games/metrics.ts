/**
 * Metrics over the learner's own analysed games. Same discipline as the practice metrics:
 * explicit numerator and denominator, coverage, uncertainty, and the events behind every
 * number. Engine losses are reported as engine losses; no cause is inferred from them.
 */
import { type Confidence, type Interval, PROVISIONAL_N, wilson } from '../metrics/metrics';
import type { GameEvent, GameRecord, TimeClass } from './types';

export interface GameFilter {
  timeClass?: TimeClass;
  /** Inclusive lower bound on the game's end date, YYYY-MM-DD. */
  sinceDate?: string;
}

function select(games: GameRecord[], f: GameFilter = {}): GameRecord[] {
  return games.filter((g) => (!f.timeClass || g.timeClass === f.timeClass) && (!f.sinceDate || g.endDate >= f.sinceDate));
}
const analysed = (games: GameRecord[]) => games.filter((g) => g.analysis);
const byDate = (a: GameRecord, b: GameRecord) => (a.endDate + (a.endTime ?? '') < b.endDate + (b.endTime ?? '') ? -1 : 1);

export interface RatingSeries {
  timeClass: TimeClass;
  n: number;
  points: { date: string; rating: number; gameId: string; result: GameRecord['result'] }[];
  current: { rating: number; date: string } | null;
  /** Rating after the game 20 games before the latest, when there are that many. */
  twentyAgo: number | null;
}

/** Rating after each game in one time control, in date order. Never mixed across time controls. */
export function ratingSeries(games: GameRecord[], timeClass: TimeClass): RatingSeries {
  const rows = games.filter((g) => g.timeClass === timeClass && g.playerRating !== null).sort(byDate);
  const points = rows.map((g) => ({ date: g.endDate, rating: g.playerRating!, gameId: g.id, result: g.result }));
  const last = points[points.length - 1];
  return { timeClass, n: points.length, points, current: last ? { rating: last.rating, date: last.date } : null, twentyAgo: points.length > 20 ? points[points.length - 21]!.rating : null };
}

export interface Coverage {
  games: number;
  analysedGames: number;
  decisions: number;
  /** Distinct engine settings present; more than one means the analyses are not strictly comparable. */
  analysisKeys: string[];
}

export function gameCoverage(games: GameRecord[], f: GameFilter = {}): Coverage {
  const sel = select(games, f);
  const done = analysed(sel);
  return {
    games: sel.length,
    analysedGames: done.length,
    decisions: done.reduce((t, g) => t + g.analysis!.decisions.length, 0),
    analysisKeys: [...new Set(done.map((g) => g.analysisKey).filter((k): k is string => !!k))].sort(),
  };
}

export interface EventRef {
  game: GameRecord;
  event: GameEvent;
}
const eventsOf = (games: GameRecord[], pred: (e: GameEvent) => boolean): EventRef[] =>
  analysed(games).flatMap((g) => g.analysis!.events.filter(pred).map((event) => ({ game: g, event })));

export interface MajorErrors {
  games: number;
  decisions: number;
  errors: number;
  rate: number | null;
  per100: number | null;
  perGame: number | null;
  interval: Interval | null;
  confidence: Confidence;
  byLabel: Record<'loses-material' | 'allows-mate' | 'misses-material' | 'unclassified', number>;
  events: EventRef[];
}

/**
 * Major-error rate.
 *   numerator   = learner moves that lowered engine expected score by >= the pipeline's threshold
 *   denominator = learner decisions in analysed games (unanalysed games are excluded, not counted as clean)
 * Labels are concrete ("loses material", "allows mate", "misses material") or "unclassified"; none claims a cause.
 */
export function majorErrors(games: GameRecord[], f: GameFilter = {}): MajorErrors {
  const done = analysed(select(games, f));
  const decisions = done.reduce((t, g) => t + g.analysis!.decisions.length, 0);
  const events = eventsOf(done, (e) => e.majorError);
  const byLabel = { 'loses-material': 0, 'allows-mate': 0, 'misses-material': 0, unclassified: 0 };
  for (const { event } of events) byLabel[event.errorLabel ?? 'unclassified']++;
  const rate = decisions ? events.length / decisions : null;
  return {
    games: done.length,
    decisions,
    errors: events.length,
    rate,
    per100: rate === null ? null : rate * 100,
    perGame: done.length ? events.length / done.length : null,
    interval: decisions ? wilson(events.length, decisions) : null,
    confidence: done.length === 0 ? 'none' : done.length < PROVISIONAL_N ? 'provisional' : 'ok',
    byLabel,
    events,
  };
}

export interface Missed {
  available: number;
  missed: number;
  rate: number | null;
  interval: Interval | null;
  confidence: Confidence;
  events: EventRef[];
}

/**
 * Missed tactical opportunities: positions where the engine's best line mates, or ends at
 * least two points up on the balance before the opponent's last move (so taking back a piece
 * is not a chance), and the move played gave up at least the pipeline's miss threshold.
 * Denominator: all such opportunities among the learner's own decisions.
 */
export function missedOpportunities(games: GameRecord[], f: GameFilter = {}): Missed {
  const done = analysed(select(games, f));
  const available = eventsOf(done, (e) => e.opportunity !== null).length;
  const events = eventsOf(done, (e) => e.missed);
  return {
    available,
    missed: events.length,
    rate: available ? events.length / available : null,
    interval: available ? wilson(events.length, available) : null,
    confidence: available === 0 ? 'none' : available < PROVISIONAL_N ? 'provisional' : 'ok',
    events,
  };
}

export const LOW_CLOCK_FRACTION = 0.1;
export const CLOCK_MIN_DECISIONS = 30;

export interface ClockPressure {
  low: { decisions: number; errors: number };
  normal: { decisions: number; errors: number };
  /** Games without clock data (for example daily games), excluded from both groups. */
  noClock: number;
  /** Both groups have at least CLOCK_MIN_DECISIONS decisions. */
  enough: boolean;
}

/** Major errors when under 10% of the starting time remains, against all other clocked decisions. */
export function clockPressure(games: GameRecord[], f: GameFilter = {}): ClockPressure {
  const out: ClockPressure = { low: { decisions: 0, errors: 0 }, normal: { decisions: 0, errors: 0 }, noClock: 0, enough: false };
  for (const g of analysed(select(games, f))) {
    const base = Number(g.timeControl.split('+')[0]);
    if (!g.clocks || !Number.isFinite(base) || base <= 0 || g.timeClass === 'daily') {
      out.noClock++;
      continue;
    }
    for (const [, loss, clock] of g.analysis!.decisions) {
      if (clock === null) continue;
      const bucket = clock < base * LOW_CLOCK_FRACTION ? out.low : out.normal;
      bucket.decisions++;
      if (loss >= (g.majorLoss ?? 20)) bucket.errors++;
    }
  }
  out.enough = out.low.decisions >= CLOCK_MIN_DECISIONS && out.normal.decisions >= CLOCK_MIN_DECISIONS;
  return out;
}

export interface DrillPosition extends EventRef {
  /** Review-queue id. */
  id: string;
}

/** Positions from the learner's games where they missed a move that the engine found clearly best. */
export function drillPositions(games: GameRecord[]): DrillPosition[] {
  return eventsOf(games, (e) => e.drill)
    .map((r) => ({ ...r, id: `game:${r.game.id}:${r.event.ply}` }))
    .sort((a, b) => (a.game.endDate > b.game.endDate ? -1 : a.game.endDate < b.game.endDate ? 1 : a.event.ply - b.event.ply));
}
