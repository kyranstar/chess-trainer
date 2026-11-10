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

/**
 * Rating after each rated game in one time control, in date order. Never mixed across time
 * controls. An unrated game carries whatever rating the site happened to attach to it (often
 * the rating of another time control), so it is left out.
 */
export function ratingSeries(games: GameRecord[], timeClass: TimeClass): RatingSeries {
  const rows = games.filter((g) => g.timeClass === timeClass && g.playerRating !== null && g.rated !== false).sort(byDate);
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
  /**
   * The same count restricted to positions that were not already won (best expected score
   * under UNDECIDED_BELOW). In a won position a miss cannot cost 10 points, so the overall
   * figure flatters; this one is the meaningful rate.
   */
  undecided: { available: number; missed: number; rate: number | null; interval: Interval | null; events: EventRef[] };
  /**
   * Chances with one clearly best move (it beats the next move by CLEAR_GAP points or is a
   * mate with no equal alternative), each counted once however many moves it stayed on the
   * board; missed when it was never taken. Where several moves win about as much there is
   * nothing to find, and those positions are left out.
   */
  clear: { available: number; missed: number; rate: number | null; interval: Interval | null };
}

export const CLEAR_GAP = 20;

export const UNDECIDED_BELOW = 90;

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
  const open = eventsOf(done, (e) => e.opportunity !== null && e.bestWp < UNDECIDED_BELOW);
  // Not already won: a "miss" here is simply not playing the engine's first choice.
  const openMissed = open.filter((r) => r.event.played !== r.event.best);
  // Clear chances, with consecutive moves of one game on which the chance stayed available merged into one.
  let clearN = 0;
  let clearMissed = 0;
  for (const g of done) {
    const evs = g.analysis!.events.filter((e) => e.opportunity !== null && e.secondWp !== null && e.bestWp - e.secondWp >= CLEAR_GAP).sort((a, b) => a.ply - b.ply);
    let i = 0;
    while (i < evs.length) {
      let j = i;
      while (j + 1 < evs.length && evs[j + 1]!.ply === evs[j]!.ply + 2 && evs[j]!.played !== evs[j]!.best) j++;
      clearN++;
      if (evs[j]!.played !== evs[j]!.best) clearMissed++;
      i = j + 1;
    }
  }
  return {
    clear: { available: clearN, missed: clearMissed, rate: clearN ? clearMissed / clearN : null, interval: clearN ? wilson(clearMissed, clearN) : null },
    available,
    missed: events.length,
    rate: available ? events.length / available : null,
    interval: available ? wilson(events.length, available) : null,
    confidence: available === 0 ? 'none' : available < PROVISIONAL_N ? 'provisional' : 'ok',
    events,
    undecided: { available: open.length, missed: openMissed.length, rate: open.length ? openMissed.length / open.length : null, interval: open.length ? wilson(openMissed.length, open.length) : null, events: openMissed },
  };
}

export const LOW_CLOCK_FRACTION = 0.1;
export const CLOCK_MIN_DECISIONS = 30;

export interface ClockPressure {
  low: { decisions: number; errors: number };
  normal: { decisions: number; errors: number };
  /** Games without clock data (for example daily games), excluded from both groups. */
  noClock: number;
  /** Games not yet measured on this device: without the position's standing they cannot be compared. */
  unmeasured: number;
  /** Both groups have at least CLOCK_MIN_DECISIONS decisions. */
  enough: boolean;
}

/**
 * Major errors on moves begun with under 10% of the starting time left, against all other
 * clocked decisions, in positions that were still undecided (expected score 10 to 90).
 * Most moves made with little time are made in games already won or lost, where a major
 * error is impossible by definition; counting them made time trouble look harmless.
 */
export function clockPressure(games: GameRecord[], f: GameFilter = {}): ClockPressure {
  const out: ClockPressure = { low: { decisions: 0, errors: 0 }, normal: { decisions: 0, errors: 0 }, noClock: 0, unmeasured: 0, enough: false };
  for (const g of select(games, f)) {
    const base = Number(g.timeControl.split('+')[0]);
    if (!g.clocks || !Number.isFinite(base) || base <= 0 || g.timeClass === 'daily') {
      out.noClock++;
      continue;
    }
    const facts = g.measure?.facts;
    if (!g.measure || !facts) {
      out.unmeasured++;
      continue;
    }
    const wpAt = new Map(facts.map((x) => [x.ply, x.wp]));
    // The recorded clock is the time left AFTER a move. What matters is the time available
    // when the move was chosen: the clock after the learner's previous move (the starting time
    // for their first), so a long think is not mistaken for a move made in time trouble.
    let before: number | null = base;
    for (const [ply, loss, clock] of g.measure.decisions) {
      const wp = wpAt.get(ply);
      if (before !== null && wp !== undefined && wp >= 10 && wp <= 90) {
        const bucket = before < base * LOW_CLOCK_FRACTION ? out.low : out.normal;
        bucket.decisions++;
        if (loss >= 20) bucket.errors++;
      }
      before = clock;
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

export interface EarlyBlunders {
  /** Rated games of the time control that have a measurement record. */
  games: number;
  withBlunder: number;
  rate: number | null;
  interval: Interval | null;
  confidence: Confidence;
  /** The first such move in each affected game. */
  events: EventRef[];
  recent: { games: number; withBlunder: number } | null;
  previous: { games: number; withBlunder: number } | null;
  /** Eligible games still waiting for their measurement record; they are in neither count. */
  pending: number;
  /** Secondary: every such move (not only the first per game) per decision in the same move range. */
  moves: { events: number; decisions: number };
  /** The one engine setting all counted games were measured with, or null when none are. */
  protocol: string | null;
}

export const EARLY_MOVES = 20;
export const COMPARE_WINDOW = 20;

/**
 * The headline transfer measure, fixed in advance (ADR-027):
 *   games in which the learner made, within their first `maxMove` moves, a move that the engine
 *   shows losing material or allowing mate in a short line  /  analysed rated games of one time control.
 * The game is the unit, so the Wilson interval is on games, not on moves. `recent` and
 * `previous` are the latest `window` games and the `window` before them, for a like-for-like look.
 */
export function earlyBlunderGames(games: GameRecord[], opts: { timeClass: TimeClass; maxMove?: number; window?: number; sinceDate?: string }): EarlyBlunders {
  const maxPly = (opts.maxMove ?? EARLY_MOVES) * 2;
  const window = opts.window ?? COMPARE_WINDOW;
  const eligible = select(games, { timeClass: opts.timeClass, sinceDate: opts.sinceDate }).filter((g) => g.rated !== false && g.moves.length > 0);
  // One protocol only: the measurement record of the setting most games have. Anything else waits.
  const count = new Map<string, number>();
  for (const g of eligible) if (g.measure && g.measureKey) count.set(g.measureKey, (count.get(g.measureKey) ?? 0) + 1);
  const protocol = [...count].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? 1 : -1))[0]?.[0] ?? null;
  const pool = eligible.filter((g) => g.measure && g.measureKey === protocol).sort(byDate);
  const targets = (g: GameRecord) => g.measure!.events.filter((e) => !!e.target && e.ply < maxPly);
  const flagged = pool.map((g) => ({ game: g, event: targets(g)[0] }));
  const hits = flagged.filter((x): x is { game: GameRecord; event: GameEvent } => !!x.event);
  const slice = (xs: typeof flagged) => ({ games: xs.length, withBlunder: xs.filter((x) => x.event).length });
  const n = pool.length;
  return {
    games: n,
    withBlunder: hits.length,
    rate: n ? hits.length / n : null,
    interval: n ? wilson(hits.length, n) : null,
    confidence: n === 0 ? 'none' : n < PROVISIONAL_N ? 'provisional' : 'ok',
    events: hits,
    recent: n >= window ? slice(flagged.slice(-window)) : null,
    previous: n >= 2 * window ? slice(flagged.slice(-2 * window, -window)) : null,
    pending: eligible.length - n,
    moves: {
      events: pool.reduce((t, g) => t + targets(g).length, 0),
      decisions: pool.reduce((t, g) => t + g.measure!.decisions.filter((d) => d[0] < maxPly).length, 0),
    },
    protocol,
  };
}
