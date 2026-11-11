import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { href, type Route } from '../app/router';
import { type Learner, useDb, useDueReviews, useFocusMode, useNow } from '../app/store';
import { STARTING_PROFILE } from '../app/profile';
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { getMeta, recordAttempt, setMeta } from '../db/db';
import { runSyncRound, useSyncState } from '../app/useAutoSync';
import { DEFAULT_USERNAME } from '../games/autosync';
import type { RatingSnapshot } from '../games/chesscom';
import { clockPressure, CLOCK_MIN_DECISIONS, COMPARE_WINDOW, type DrillPosition, drillPositions, EARLY_MOVES, earlyBlunderGames, type EventRef, gameCoverage, majorErrors, missedOpportunities, ratingSeries, UNDECIDED_BELOW } from '../games/metrics';
import { senseStats } from '../games/sense';
import type { Attempt } from '../db/types';
import type { GameRecord, TimeClass } from '../games/types';
import { formatPct, PROVISIONAL_N } from '../metrics/metrics';
import { Board } from './Board';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { bestLineFor } from '../engine/interactive';
import { ucisOfSanLine } from '../chess/line';
import { useLineSteps } from './LineSteps';
import { localDate } from '../schedule/session';

export function useGames(): GameRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.games.orderBy('endDate').toArray(), [db]);
}

const CLASSES: { key: TimeClass; label: string }[] = [
  { key: 'rapid', label: 'Rapid' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'daily', label: 'Daily' },
  { key: 'bullet', label: 'Bullet' },
];
const LABEL_TEXT = {
  'loses-material': 'loses material in a short line',
  'allows-mate': 'allows a short mate',
  'misses-material': 'passes up material that could be won',
  unclassified: 'no concrete short line found',
} as const;

/** Rating after each game as a small line, one time control at a time. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(26 - ((v - lo) / span) * 24).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={`Rating from ${values[0]} to ${values[values.length - 1]}, low ${lo}, high ${hi}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function GameCards({ sinceDate, periodLabel, period }: { sinceDate: string | undefined; periodLabel: string; period: string }) {
  const games = useGames();
  const live = useLiveRatings();
  if (!games) return null;
  if (games.length === 0) {
    return (
      <section className="card" data-testid="card-ratings">
        <h2>Game ratings</h2>
        <ul className="rating-list">
          {STARTING_PROFILE.ratings.map((r) => (<li key={r.label}><span>{r.label}</span><strong>{r.value}</strong></li>))}
        </ul>
        <p className="definition-small">{STARTING_PROFILE.source}, {STARTING_PROFILE.enteredOn}. Each is a separate scale and they are not comparable. No games are on this device yet, so there is no trend and no game-error analysis. Enter your Chess.com username under “Your games” and they arrive by themselves.</p>
      </section>
    );
  }
  const f = { sinceDate };
  const cov = gameCoverage(games, f);
  const errs = majorErrors(games, f);
  const missed = missedOpportunities(games, f);
  const clock = clockPressure(games, f);
  return (
    <>
      <section className="card" data-testid="card-ratings">
        <h2>Rating by time control</h2>
        <table className="concept-table">
          <thead><tr><th scope="col">Time control</th><th scope="col">Now</th><th scope="col">Games</th><th scope="col">Trend</th></tr></thead>
          <tbody>
            {CLASSES.map(({ key, label }) => {
              const s = ratingSeries(games, key);
              if (s.n === 0) return null;
              return (
                <tr key={key} data-testid={`rating-${key}`} data-current={s.current!.rating}>
                  <th scope="row">{label}<span className="row-stage">after the game on {s.current!.date}</span></th>
                  <td><strong>{s.current!.rating}</strong>{s.twentyAgo !== null && <span className="row-stage">{s.current!.rating - s.twentyAgo >= 0 ? '+' : ''}{s.current!.rating - s.twentyAgo} over 20 games</span>}</td>
                  <td>{s.n}</td>
                  <td><Sparkline values={s.points.map((p) => p.rating)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {live && (
          <p data-testid="live-ratings">
            Chess.com now: {([['rapid', 'Rapid'], ['blitz', 'Blitz'], ['daily', 'Daily'], ['bullet', 'Bullet']] as const).filter(([k]) => live[k]).map(([k, label]) => `${label} ${live[k]!.rating}`).join(', ')} (checked {new Date(live.checkedAt).toLocaleString()}).
          </p>
        )}
        <p className="definition-small">Your rating after each game on this device, all time, never combined across time controls. Ratings move with opponents and luck as well as skill; a few games show nothing.</p>
      </section>

      <section className="card" data-testid="card-errors">
        <h2>Major errors in your games</h2>
        {errs.decisions === 0 ? (
          <p className="metric-empty" data-testid="insufficient">Insufficient data: no analysed games in this period.</p>
        ) : (
          <>
            <p className="metric-line">
              <span className="metric-value">{errs.per100!.toFixed(1)}</span>
              <span className="metric-pct">per 100 decisions</span>
              <span className="metric-range">{errs.errors} in {errs.decisions} decisions, plausible range {(errs.interval!.lo * 100).toFixed(1)}–{(errs.interval!.hi * 100).toFixed(1)}</span>
              {errs.confidence === 'provisional' && <span className="badge">provisional, fewer than {PROVISIONAL_N} games</span>}
            </p>
            <p>{errs.perGame!.toFixed(1)} per game over {errs.games} analysed game{errs.games === 1 ? '' : 's'}. {errs.byLabel['loses-material']} lose material in a short line, {errs.byLabel['allows-mate']} allow a short mate, {errs.byLabel['misses-material']} pass up material that could be won, {errs.byLabel.unclassified} have no concrete short line.</p>
            <table className="concept-table">
              <thead><tr><th scope="col">Time control</th><th scope="col">Errors / decisions</th><th scope="col">Per 100</th></tr></thead>
              <tbody>
                {CLASSES.map(({ key, label }) => {
                  const m = majorErrors(games, { ...f, timeClass: key });
                  return m.decisions === 0 ? null : (
                    <tr key={key} data-testid={`errors-${key}`}><th scope="row">{label}</th><td>{m.errors}/{m.decisions}</td><td>{m.per100!.toFixed(1)}</td></tr>
                  );
                })}
              </tbody>
            </table>
            <a href={href('progress/game-events', { kind: 'errors', period })} data-testid="view-errors">View the {errs.errors} positions</a>
          </>
        )}
        <p className="definition-small">
          A major error is one of your moves that lowered the engine’s expected score by 20 points or more; the rate is per decision you made in analysed games; {periodLabel}. Coverage: {cov.analysedGames} of {cov.games} imported games analysed ({cov.decisions} decisions){cov.analysisKeys.length === 1 ? `, all with ${cov.analysisKeys[0]}` : cov.analysisKeys.length > 1 ? `. Mixed engine settings (${cov.analysisKeys.join('; ')}): figures are not strictly comparable` : ''}. This is the engine’s judgement of moves, not an explanation of why they were played.
        </p>
      </section>

      <section className="card" data-testid="card-missed">
        <h2>Missed tactical chances</h2>
        {missed.available === 0 ? (
          <p className="metric-empty">No tactical chances were found in the analysed games for this period.</p>
        ) : (
          <>
            {missed.clear.available > 0 ? (
              <p className="metric-line" data-testid="missed-clear">
                <span className="metric-value">{missed.clear.missed} of {missed.clear.available}</span>
                <span className="metric-pct">{formatPct(missed.clear.rate)}</span>
                <span className="metric-range">chances with one clearly best move were never taken, plausible range {formatPct(missed.clear.interval!.lo)}–{formatPct(missed.clear.interval!.hi)}</span>
              </p>
            ) : (
              <p className="metric-empty" data-testid="missed-clear">No chance with one clearly best move was found in these games.</p>
            )}
            <p className="definition-small">A chance counts here only if one move beats every other by 20 points or more, and it counts once however many moves it stayed on the board. Where several moves win about as much there is nothing to find.</p>
            {missed.undecided.available > 0 && (
              <p data-testid="missed-undecided">While the game was still open: {missed.undecided.missed} of {missed.undecided.available} chances were answered with a move other than the engine’s first choice ({formatPct(missed.undecided.rate)}).</p>
            )}
            <p data-testid="missed-all">Counting every chance, including those in positions already won: {missed.missed} of {missed.available} cost 10 points or more ({formatPct(missed.rate)}).</p>
            {missed.missed > 0 && <a href={href('progress/game-events', { kind: 'missed', period })} data-testid="view-missed">View the {missed.missed} positions</a>}
          </>
        )}
        <p className="definition-small">A chance is a position on your move where the engine’s best line mates, or ends at least two points of material up on where things stood before the opponent’s last move (so simply taking a piece back is not counted). The first figure counts chances where the best line scored under {UNDECIDED_BELOW}% (the game was still open) and you played something other than the engine’s first choice. In a position that is already won a miss barely registers, which is why the second figure looks kinder. Chances are only looked for at your own moves; {periodLabel}.</p>
      </section>

      <section className="card" data-testid="card-clock">
        <h2>Errors when short of time</h2>
        {clock.enough ? (
          <p>
            Moves begun with under 10% of the starting time left: {clock.low.errors} major errors in {clock.low.decisions} decisions ({((100 * clock.low.errors) / clock.low.decisions).toFixed(1)} per 100).
            Otherwise: {clock.normal.errors} in {clock.normal.decisions} ({((100 * clock.normal.errors) / clock.normal.decisions).toFixed(1)} per 100).
          </p>
        ) : (
          <p className="metric-empty" data-testid="clock-insufficient">Insufficient data: {clock.low.decisions} moves begun with under 10% of the starting time left and {clock.normal.decisions} otherwise; at least {CLOCK_MIN_DECISIONS} are needed in each group before the two are compared.</p>
        )}
        <p className="definition-small">Clock times come from the game file; {clock.noClock} analysed game{clock.noClock === 1 ? ' has' : 's have'} no clock data and {clock.noClock === 1 ? 'is' : 'are'} left out; {periodLabel}. Only positions that were still undecided are compared (expected score 10 to 90 before the move, from this device’s own analysis): most moves made with little time come in games already won or lost, where a major error is impossible.{clock.unmeasured > 0 ? ` ${clock.unmeasured} game${clock.unmeasured === 1 ? ' is' : 's are'} waiting to be measured and not yet included.` : ''} The clock is the time left when the move was begun.</p>
      </section>
    </>
  );
}

function eventsFor(games: GameRecord[], kind: string, sinceDate: string | undefined): { title: string; rows: EventRef[] } {
  if (kind === 'missed') return { title: 'Missed tactical chances', rows: missedOpportunities(games, { sinceDate }).events };
  if (kind === 'early') return { title: 'Early blunders in rapid games', rows: earlyBlunderGames(games, { timeClass: 'rapid', sinceDate }).events };
  return { title: 'Major errors', rows: majorErrors(games, { sinceDate }).events };
}

export function GameEventsList({ route, sinceDateOf }: { route: Route; sinceDateOf: (period: string) => string | undefined }) {
  const games = useGames();
  const kind = route.query.get('kind') ?? 'errors';
  const period = route.query.get('period') ?? 'all';
  if (!games) return <div className="page"><p className="muted">Loading</p></div>;
  const { title, rows } = eventsFor(games, kind, sinceDateOf(period));
  return (
    <div className="page" data-testid="game-events">
      <a className="back" href={href('progress')}>Progress</a>
      <h1>{title}</h1>
      <p className="muted">{rows.length} position{rows.length === 1 ? '' : 's'} from your games, newest first. These are exactly the rows behind the number.</p>
      <ul className="attempt-list">
        {rows.slice().sort((a, b) => (a.game.endDate < b.game.endDate ? 1 : -1)).map(({ game, event }) => (
          <li key={`${game.id}:${event.ply}`}>
            <a href={href(`progress/game-event/${game.id}/${event.ply}`)} data-testid="event-row">
              <span className="concept-name">Move {Math.floor(event.ply / 2) + 1}: {event.playedSan} (engine: {event.bestSan})</span>
              <span className="concept-meta">{game.endDate}, {game.timeClass} vs {game.opponent}; expected score {Math.round(event.bestWp)}% to {Math.round(event.playedWp)}%{event.errorLabel ? `; ${LABEL_TEXT[event.errorLabel]}` : ''}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GameEventView({ gameId, ply }: { gameId: string; ply: number }) {
  const games = useGames();
  if (!games) return <div className="page"><p className="muted">Loading</p></div>;
  const game = games.find((g) => g.id === gameId);
  const event = game?.analysis?.events.find((e) => e.ply === ply) ?? game?.measure?.events.find((e) => e.ply === ply);
  if (!game || !event) return <div className="page"><a className="back" href={href('progress')}>Progress</a><p>Position not found.</p></div>;
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="page" data-testid="game-event">
      <a className="back" href={href('progress')}>Progress</a>
      <p className="kicker">{game.endDate}, {game.timeControl} {game.timeClass} vs {game.opponent} ({game.result ?? 'no result'})</p>
      <h1>Move {Math.floor(event.ply / 2) + 1}, {game.color === 'white' ? 'White' : 'Black'} to move</h1>
      <Board fen={event.fen} orientation={game.color} movable={null} />
      <dl className="facts">
        <dt>You played</dt><dd>{event.playedSan} (expected score about {Math.round(event.playedWp)}%)</dd>
        <dt>Engine’s first choice</dt><dd>{event.bestLine} (about {Math.round(event.bestWp)}%)</dd>
        {event.refutation && (<><dt>After your move</dt><dd>{event.refutation}</dd></>)}
        <dt>What is established</dt>
        <dd>
          {event.majorError
            ? `Expected score fell by ${Math.round(event.loss)} points: ${LABEL_TEXT[event.errorLabel ?? 'unclassified']}.`
            : event.target
              ? `The move ${event.target === 'mate' ? 'allowed a short mate' : 'lost material in a short line'} that the best move avoided. The expected score moved by only ${Math.round(event.loss)} points because the game was already largely decided, so it is not counted as a major error, but it is counted as an early blunder.`
              : 'Not a major error.'}
          {event.opportunity ? ` The best line ${event.opportunity === 'mate' ? 'forces mate' : 'wins material'}${event.missed ? '; it was missed' : '; you found it'}.` : ''}
        </dd>
        <dt>Not established</dt><dd>Why the move was played. The app does not guess.</dd>
        {event.clock !== null && (<><dt>Clock</dt><dd>{mins(event.clock)} left after the move</dd></>)}
        <dt>Source</dt><dd>{game.url ? <a href={game.url} target="_blank" rel="noreferrer">Open the game</a> : 'Imported PGN'}; {game.analysisKey}</dd>
      </dl>
      {event.drill && <div className="actions"><a className="button primary" href={href('practice/run', { mode: 'own' })}>Practise positions from your games</a></div>}
    </div>
  );
}

/** One position from the learner's own game where the engine found a single clearly best move. */
export function OwnGameDrill({ drill, sessionId, heading, onDone }: { drill: DrillPosition; sessionId: string | null; heading?: string; onDone: () => void }) {
  const db = useDb();
  useFocusMode();
  const { game, event } = drill;
  const [result, setResult] = useState<{ ok: boolean; playedSan: string | null; shown: boolean } | null>(null);
  useScreenChange(`${drill.id}|${!!result}`);
  const armed = useArmed();
  const [fen, setFen] = useState(event.fen);
  const [resetKey, setResetKey] = useState(0);
  const [checking, setChecking] = useState(false);
  const [other, setOther] = useState<'worse' | 'not-faulted' | 'unchecked' | null>(null);
  const started = useRef(Date.now());
  // After the answer the lines can be played through on the board: the engine's, and what
  // follows the move he played. A second go is practice and is never recorded.
  const [mine, setMine] = useState<{ uci: string; pv: string[] } | null>(null);
  const [view, setView] = useState<'best' | 'mine'>('best');
  const recorded = useRef(false);
  const [retrying, setRetrying] = useState(false);
  function retry() {
    setRetrying(true);
    setResult(null);
    setOther(null);
    setMine(null);
    setView('best');
    setFen(event.fen);
    setResetKey((k) => k + 1);
  }

  async function record(uci: string | null, shown: boolean) {
    const pos = positionFromFen(event.fen);
    const ok = !!uci && sameMove(pos, uci, event.best);
    // Another move is not a failure until something shows it is worse. The built-in engine is
    // asked; within ten points of the stored best move, or with no answer, nothing is recorded
    // against it.
    let other: 'worse' | 'not-faulted' | 'unchecked' | null = null;
    if (uci && !ok) {
      setChecking(true);
      const line = await bestLineFor(fenOf(applyUci(pos, uci)));
      setChecking(false);
      setMine({ uci, pv: line?.pv ?? [] });
      other = !line ? 'unchecked' : 100 - line.wp >= event.bestWp - 10 ? 'not-faulted' : 'worse';
    }
    setOther(other);
    setResult({ ok, playedSan: uci ? sanOf(pos, uci) : null, shown });
    setFen(fenOf(applyUci(pos, event.best)));
    setResetKey((k) => k + 1);
    if (recorded.current) return;
    recorded.current = true;
    await recordAttempt(db, {
      sessionId, context: 'review', exerciseId: drill.id, exerciseKind: 'own-game', contentVersion: game.analysisKey ?? 'unanalysed',
      conceptId: null, themes: [], rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: uci, played: uci ? [uci] : [],
      mistakes: other === 'worse' ? 1 : 0, hints: shown ? 1 : 0, outcome: shown ? 'assisted' : ok ? 'success' : other === 'worse' ? 'fail' : 'skipped', acceptedAlternative: false,
    });
  }

  const bestPv = (() => {
    const pv = ucisOfSanLine(event.fen, event.bestLine ?? '');
    return pv[0] && sameMove(positionFromFen(event.fen), pv[0], event.best) ? pv : [event.best];
  })();
  const line = !result ? null : view === 'mine' && mine ? { from: event.fen, pv: [mine.uci, ...mine.pv] } : { from: event.fen, pv: bestPv };
  const steps = useLineSteps(line, view === 'mine' ? { initial: 2, me: game.color, cap: 6 } : { initial: 1, me: game.color, stopThere: false, startLabel: 'Play the engine’s line' });

  return (
    <section className="puzzle" data-testid="own-drill" data-expected={result ? '' : event.best} data-done={!!result}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>{game.color === 'white' ? 'White' : 'Black'} to move</h2>
        <p className="muted">From your {game.timeClass} game on {game.endDate}, move {Math.floor(event.ply / 2) + 1}. The engine found one move here clearly better than the rest. Find it.</p>
      </header>
      {retrying && !result && <p className="muted" data-testid="own-retry-note">Second go. This one is not recorded.</p>}
      <Board fen={steps.pos ? steps.pos.fen : fen} orientation={game.color} movable={result || checking ? null : game.color} lastMove={steps.pos ? steps.pos.last : null} marks={steps.marks} onMove={(u) => void record(u, false)} resetKey={resetKey} />
      <div className="feedback" aria-live="polite">
        {result?.ok && <div className="verdict right" data-testid="own-verdict" data-ok="true"><strong>{event.bestSan}: the engine’s first choice.</strong><p>In the game you played {event.playedSan}.</p></div>}
        {result && !result.ok && (
          <div className="verdict neutral" data-testid="own-verdict" data-ok="false">
            <strong>The engine’s first choice is {event.bestLine}.</strong>
            <p>
              {result.playedSan && other === 'not-faulted' ? `The built-in engine’s check does not fault ${result.playedSan} either, so it is not scored. ` : ''}
              {result.playedSan && other === 'unchecked' ? `${result.playedSan} could not be checked on this device, so it is not scored. ` : ''}
              {result.playedSan && other === 'worse' ? `The built-in engine rates ${result.playedSan} clearly lower; it comes back in your review queue. ` : ''}
              Best move about {Math.round(event.bestWp)}% expected score, the second best {event.secondWp === null ? 'unknown' : `${Math.round(event.secondWp)}%`}.
            </p>
            {view === 'mine' && result.playedSan && <p data-testid="own-mine-line">On the board: {result.playedSan} and the engine’s reply to it. Step back and on through it.</p>}
            {steps.note}
          </div>
        )}
      </div>
      <div className="actions">
        {!result && <button disabled={!armed} onClick={() => void record(null, true)}>Show the move</button>}
        {result && steps.controls}
        {result && !result.ok && mine && mine.pv.length > 0 && (
          view === 'best'
            ? <button data-testid="own-see-mine" onClick={() => setView('mine')}>What happens after {result.playedSan}</button>
            : <button data-testid="own-see-best" onClick={() => setView('best')}>The engine’s line</button>
        )}
        {result && !result.ok && <button data-testid="own-retry" disabled={!armed} onClick={retry}>Try it again</button>}
        {result && <button className="primary" data-testid="own-next" disabled={!armed} onClick={onDone}>Continue</button>}
      </div>
    </section>
  );
}

/** Own-game positions that were never drilled or are due again. */
export function OwnGameRun({ learner, onFinished }: { learner: Learner; onFinished: () => void }) {
  const games = useGames();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const queue = useRef<DrillPosition[] | null>(null);
  const [i, setI] = useState(0);
  // Fixed once it has something in it; while it is empty (games still being analysed) it may fill.
  if ((queue.current === null || (queue.current.length === 0 && i === 0)) && games && learner.ready) {
    const queued = new Set(learner.reviews.map((r) => r.itemId));
    const dueIds = new Set(due.map((d) => d.itemId));
    queue.current = drillPositions(games).filter((d) => !queued.has(d.id) || dueIds.has(d.id));
  }
  if (!queue.current) return <p className="muted">Loading</p>;
  const drill = queue.current[i];
  if (!drill) {
    return (
      <div className="empty" data-testid="own-done">
        <p>{queue.current.length === 0 ? 'No positions from your games are waiting. They appear after analysed games are imported.' : `Worked through ${queue.current.length} position${queue.current.length === 1 ? '' : 's'} from your games.`}</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
      </div>
    );
  }
  return <OwnGameDrill key={drill.id} drill={drill} sessionId={null} heading={`Your games, ${queue.current.length - i} left`} onDone={() => setI(i + 1)} />;
}

const SYNC_TEXT: Record<string, string> = {
  ok: 'up to date',
  offline: 'could not reach Chess.com (offline); it will try again next time',
  'rate-limited': 'Chess.com asked us to slow down; it will try again later',
  'not-found': 'Chess.com does not know this username',
  error: 'Chess.com returned an error; it will try again later',
};

/** Automatic import from Chess.com. Shown under "Your data". */
export function GamesImport() {
  const db = useDb();
  const games = useGames();
  const sync = useSyncState();
  const [username, setUsername] = useState('');
  const [saved, setSaved] = useState('');
  const [lastSync, setLastSync] = useState<{ at: number; status: string; added: number } | null>(null);

  useEffect(() => {
    void getMeta<string>(db, 'chesscom.username').then((u) => {
      const name = u ?? DEFAULT_USERNAME;
      setUsername(name);
      setSaved(name);
    });
  }, [db]);
  useEffect(() => {
    void getMeta<{ at: number; status: string; added: number }>(db, 'chesscom.lastSync').then((l) => setLastSync(l ?? null));
  }, [db, sync.last, sync.syncing]);

  async function saveUsername() {
    const name = username.trim();
    await setMeta(db, 'chesscom.username', name);
    setSaved(name);
    if (name) void runSyncRound(db, true);
  }
  const analysed = games?.filter((g) => g.analysis).length ?? 0;
  return (
    <section className="card" data-testid="card-games-import" data-sync={sync.syncing ? 'syncing' : (lastSync?.status ?? 'never')} data-analysing={sync.analysing ? 'yes' : 'no'}>
      <h2>Your games</h2>
      <p data-testid="games-count">{games?.length ?? 0} games on this device, {analysed} analysed.</p>
      <label className="field">
        <span>Chess.com username</span>
        <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} data-testid="chesscom-username" onChange={(e) => setUsername(e.target.value)} />
      </label>
      <div className="actions">
        {username.trim() !== saved && <button className="primary" data-testid="save-username" onClick={() => void saveUsername()}>{username.trim() ? 'Save and fetch my games' : 'Stop fetching'}</button>}
        {saved && username.trim() === saved && <button data-testid="sync-now" disabled={sync.syncing} onClick={() => void runSyncRound(db, true)}>Check Chess.com now</button>}
      </div>
      <p className="definition-small" data-testid="sync-status" role="status">
        {!saved
          ? 'With a username, the app fetches your ratings and new games by itself every time it is opened and analyses them on this device. Nothing to do by hand.'
          : sync.syncing
            ? 'Checking Chess.com'
            : lastSync
              ? `Last checked ${new Date(lastSync.at).toLocaleString()}: ${SYNC_TEXT[lastSync.status] ?? lastSync.status}${lastSync.added ? `, ${lastSync.added} new game${lastSync.added === 1 ? '' : 's'}` : ''}. Checked again whenever the app is opened (at most every 3 hours).`
              : 'Not checked yet.'}
        {sync.analysing ? ` Analysing games on this device: ${sync.analysing.done} of ${sync.analysing.total} done; it continues while the app is open.` : ''}
        {sync.engineError ? ` The in-app engine could not start (${sync.engineError}).` : ''}
      </p>
      <p className="definition-small">Changing the username removes the games fetched for the previous one. Your device asks Chess.com’s public API directly for your own public games and ratings. Nothing is sent anywhere else, and analysis happens here with a small built-in engine.</p>
    </section>
  );
}

/** Current ratings as Chess.com reports them, when the automatic check has run. */
export function useLiveRatings(): RatingSnapshot | null {
  const db = useDb();
  const sync = useSyncState();
  const [r, setR] = useState<RatingSnapshot | null>(null);
  useEffect(() => {
    void getMeta<RatingSnapshot>(db, 'chesscom.ratings').then((x) => setR(x ?? null));
  }, [db, sync.last]);
  return r;
}

/** The three questions Progress leads with: stronger games, fewer target errors, fresh ordinary positions. */
export function Headline({ attempts, sinceDate, since, periodLabel }: { attempts: Attempt[]; sinceDate: string | undefined; since: number | undefined; periodLabel: string }) {
  const games = useGames();
  const live = useLiveRatings();
  if (!games) return null;
  const rapid = ratingSeries(games, 'rapid');
  // Training began on the day of the first recorded attempt.
  const firstTs = attempts.reduce((t, a) => Math.min(t, a.ts), Infinity);
  const trainingStart = Number.isFinite(firstTs) ? localDate(firstTs) : undefined;
  const early = earlyBlunderGames(games, { timeClass: 'rapid', sinceDate, trainingStart });
  const sense = senseStats(attempts, since);
  const s = sense['safe-or-not'];
  const c = sense['chance-or-not'];
  const pct = (x: number | null) => (x === null ? 'no data' : formatPct(x));
  return (
    <section className="card focus" data-testid="card-headline">
      <h2>Is it working?</h2>
      <dl className="facts headline-facts">
        <dt>Rapid rating</dt>
        <dd data-testid="headline-rating">
          {live?.rapid ? <strong>{live.rapid.rating}</strong> : rapid.current ? <strong>{rapid.current.rating}</strong> : 'No games yet'}
          {rapid.twentyAgo !== null && rapid.current ? ` (${rapid.current.rating - rapid.twentyAgo >= 0 ? '+' : ''}${rapid.current.rating - rapid.twentyAgo} over the last 20 games)` : rapid.n > 0 ? ` after ${rapid.n} game${rapid.n === 1 ? '' : 's'}` : ''}
        </dd>
        <dt>Early blunders</dt>
        <dd data-testid="headline-early">
          {early.games === 0 ? (early.pending > 0 ? `${early.pending} rapid games are waiting to be measured on this device` : 'No rapid games yet') : (
            <>
              <strong>{early.withBlunder} of {early.games}</strong> rapid games had a move in the first {EARLY_MOVES} that lost material or allowed mate ({formatPct(early.rate)}, plausible range {formatPct(early.interval!.lo)}–{formatPct(early.interval!.hi)}).
              {early.recent && early.previous ? ` Last ${COMPARE_WINDOW} games: ${early.recent.withBlunder}. The ${COMPARE_WINDOW} before: ${early.previous.withBlunder}.` : early.windowPending > 0 ? ` The last ${COMPARE_WINDOW} games against the ${COMPARE_WINDOW} before will be shown once ${early.windowPending} of those games ${early.windowPending === 1 ? 'has' : 'have'} been measured.` : ` A before-and-after comparison needs ${2 * COMPARE_WINDOW} rapid games.`}
              {` All such moves: ${early.moves.events} in ${early.moves.decisions} decisions.`}
              {early.beforeTraining && early.sinceTraining ? ` Before you started training here (${trainingStart}): ${early.beforeTraining.withBlunder} of ${early.beforeTraining.games} games. Since: ${early.sinceTraining.withBlunder} of ${early.sinceTraining.games}.` : ''}
              {early.pending > 0 ? ` ${early.pending} more game${early.pending === 1 ? ' is' : 's are'} waiting to be measured.` : ''}
            </>
          )}
        </dd>
        <dt>Fresh positions</dt>
        <dd data-testid="headline-sense">
          {s.detected.n + s.quiet.n + c.detected.n + c.quiet.n === 0 ? 'No questions from your own games answered yet' : (
            <>
              Unsafe moves spotted: {s.noticed.successes} of {s.noticed.n} ({pct(s.noticed.rate)}); false alarms on safe moves: {s.quiet.n - s.quiet.successes} of {s.quiet.n}.
              {' '}Chances spotted: {c.noticed.successes} of {c.noticed.n} ({pct(c.noticed.rate)}); false alarms: {c.quiet.n - c.quiet.successes} of {c.quiet.n}.
            </>
          )}
        </dd>
      </dl>
      <p className="definition-small">
        These three were chosen before any training data existed. Early blunders is the main one: a game counts if, within your first {EARLY_MOVES} moves, your move allowed mate or lost at least two points of material in a short line that the best move would not have lost, whatever it did to the engine’s score; rated rapid games only; {periodLabel}. Every game is measured on this device with one fixed engine setting{early.protocol ? ` (${early.protocol})` : ''}, so the numbers stay comparable over time. With about ten games a month, a real change takes around three months to show. Fresh positions are questions from your own games answered the first time you see them; spotting and false alarms are reported separately because either can be gamed alone.
      </p>
      {early.withBlunder > 0 && <a href={href('progress/game-events', { kind: 'early', period: 'all' })} data-testid="view-early">View the {early.withBlunder} games’ positions</a>}
    </section>
  );
}
