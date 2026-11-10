import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { href, type Route } from '../app/router';
import { type Learner, useDb, useDueReviews, useFocusMode, useNow } from '../app/store';
import { STARTING_PROFILE } from '../app/profile';
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import { importGames } from '../games/import';
import { clockPressure, CLOCK_MIN_DECISIONS, type DrillPosition, drillPositions, type EventRef, gameCoverage, majorErrors, missedOpportunities, ratingSeries } from '../games/metrics';
import type { GameRecord, TimeClass } from '../games/types';
import { formatPct, PROVISIONAL_N } from '../metrics/metrics';
import { Board } from './Board';

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
  if (!games) return null;
  if (games.length === 0) {
    return (
      <section className="card" data-testid="card-ratings">
        <h2>Game ratings</h2>
        <ul className="rating-list">
          {STARTING_PROFILE.ratings.map((r) => (<li key={r.label}><span>{r.label}</span><strong>{r.value}</strong></li>))}
        </ul>
        <p className="definition-small">{STARTING_PROFILE.source}, {STARTING_PROFILE.enteredOn}. Each is a separate scale and they are not comparable. No games are imported yet, so there is no trend and no game-error analysis. Import analysed games under “Your data”.</p>
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
        <p className="definition-small">Your rating after each imported game, all time, never combined across time controls. Ratings move with opponents and luck as well as skill; a few games show nothing.</p>
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
            <p className="metric-line">
              <span className="metric-value">{missed.missed} of {missed.available}</span>
              <span className="metric-pct">{formatPct(missed.rate)}</span>
              <span className="metric-range">missed, plausible range {formatPct(missed.interval!.lo)}–{formatPct(missed.interval!.hi)}</span>
              {missed.confidence === 'provisional' && <span className="badge">provisional, n&lt;{PROVISIONAL_N}</span>}
            </p>
            {missed.missed > 0 && <a href={href('progress/game-events', { kind: 'missed', period })} data-testid="view-missed">View the {missed.missed} positions</a>}
          </>
        )}
        <p className="definition-small">A chance is a position on your move where the engine’s best line mates, or ends at least two points of material up on where things stood before the opponent’s last move (so simply taking a piece back is not counted). It is missed when your move gave up 10 or more points of expected score. Chances are only looked for at your own moves; {periodLabel}.</p>
      </section>

      <section className="card" data-testid="card-clock">
        <h2>Errors when short of time</h2>
        {clock.enough ? (
          <p>
            Under 10% of the starting time: {clock.low.errors} major errors in {clock.low.decisions} decisions ({((100 * clock.low.errors) / clock.low.decisions).toFixed(1)} per 100).
            Otherwise: {clock.normal.errors} in {clock.normal.decisions} ({((100 * clock.normal.errors) / clock.normal.decisions).toFixed(1)} per 100).
          </p>
        ) : (
          <p className="metric-empty" data-testid="clock-insufficient">Insufficient data: {clock.low.decisions} decisions made under 10% of the starting time and {clock.normal.decisions} otherwise; at least {CLOCK_MIN_DECISIONS} are needed in each group before the two are compared.</p>
        )}
        <p className="definition-small">Clock times come from the game file; {clock.noClock} analysed game{clock.noClock === 1 ? ' has' : 's have'} no clock data and {clock.noClock === 1 ? 'is' : 'are'} left out; {periodLabel}. Positions late in a game differ from earlier ones (many are already decided either way), so a difference here says little about the clock itself.</p>
      </section>
    </>
  );
}

function eventsFor(games: GameRecord[], kind: string, sinceDate: string | undefined): { title: string; rows: EventRef[] } {
  if (kind === 'missed') return { title: 'Missed tactical chances', rows: missedOpportunities(games, { sinceDate }).events };
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
  const event = game?.analysis?.events.find((e) => e.ply === ply);
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
          {event.majorError ? `Expected score fell by ${Math.round(event.loss)} points: ${LABEL_TEXT[event.errorLabel ?? 'unclassified']}.` : 'Not a major error.'}
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
  const [fen, setFen] = useState(event.fen);
  const [resetKey, setResetKey] = useState(0);
  const started = useRef(Date.now());

  async function record(uci: string | null, shown: boolean) {
    const pos = positionFromFen(event.fen);
    const ok = !!uci && sameMove(pos, uci, event.best);
    setResult({ ok, playedSan: uci ? sanOf(pos, uci) : null, shown });
    setFen(fenOf(applyUci(pos, event.best)));
    setResetKey((k) => k + 1);
    await recordAttempt(db, {
      sessionId, context: 'review', exerciseId: drill.id, exerciseKind: 'own-game', contentVersion: game.analysisKey ?? 'unanalysed',
      conceptId: null, themes: [], rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: uci, played: uci ? [uci] : [],
      mistakes: ok || shown ? 0 : 1, hints: shown ? 1 : 0, outcome: shown ? 'assisted' : ok ? 'success' : 'fail', acceptedAlternative: false,
    });
  }

  return (
    <section className="puzzle" data-testid="own-drill" data-expected={result ? '' : event.best} data-done={!!result}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>{game.color === 'white' ? 'White' : 'Black'} to move</h2>
        <p className="muted">From your {game.timeClass} game on {game.endDate}, move {Math.floor(event.ply / 2) + 1}. The engine found one move here clearly better than the rest. Find it.</p>
      </header>
      <Board fen={fen} orientation={game.color} movable={result ? null : game.color} lastMove={result ? event.best : null} onMove={(u) => void record(u, false)} resetKey={resetKey} />
      <div className="feedback" aria-live="polite">
        {result?.ok && <div className="verdict right" data-testid="own-verdict" data-ok="true"><strong>{event.bestSan}: the engine’s first choice.</strong><p>In the game you played {event.playedSan}.</p></div>}
        {result && !result.ok && (
          <div className="verdict neutral" data-testid="own-verdict" data-ok="false">
            <strong>The engine’s first choice is {event.bestLine}.</strong>
            <p>{result.playedSan ? `${result.playedSan} was not evaluated for this position, so nothing is claimed about it beyond not being the first choice. ` : ''}Best move about {Math.round(event.bestWp)}% expected score, the second best {event.secondWp === null ? 'unknown' : `${Math.round(event.secondWp)}%`}. It comes back in your review queue.</p>
          </div>
        )}
      </div>
      <div className="actions">
        {!result && <button onClick={() => void record(null, true)}>Show the move</button>}
        {result && <button className="primary" data-testid="own-next" onClick={onDone}>Continue</button>}
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
  if (queue.current === null && games && learner.ready) {
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

/** File import for the analysed-games file, shown under "Your data". */
export function GamesImport() {
  const db = useDb();
  const games = useGames();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  async function load(file: File) {
    try {
      const r = await importGames(db, await file.text());
      setMessage({ kind: 'ok', text: `Imported games for ${r.player}: ${r.added} new, ${r.updated} re-analysed, ${r.unchanged} unchanged; ${r.analysed} carry engine analysis${r.analysisKey ? ` (${r.analysisKey})` : ''}.` });
    } catch (e) {
      setMessage({ kind: 'error', text: `${(e as Error).message} Stored games were not changed.` });
    } finally {
      if (input.current) input.current.value = '';
    }
  }
  return (
    <section className="card" data-testid="card-games-import">
      <h2>Your games</h2>
      <p>{games?.length ?? 0} imported, {games?.filter((g) => g.analysis).length ?? 0} with engine analysis. Games are analysed on your Mac and brought in as a file; the app never contacts a chess site.</p>
      <ol className="plain-list definition-small">
        <li>On Chess.com: Game History, select games, Download (keep the clock option on). Save the PGN files in <code>data/my-games/</code>.</li>
        <li>On the Mac: <code>cd pipeline && uv run python -m trainer_pipeline.games --player YOUR_NAME ../data/my-games/*.pgn</code></li>
        <li>Import <code>data/analysis/my-games.json</code> here (AirDrop or Files gets it to the iPhone).</li>
      </ol>
      <div className="actions">
        <button data-testid="games-button" onClick={() => input.current?.click()}>Import analysed games</button>
        <input ref={input} data-testid="games-input" type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      </div>
      {message && <p className={`note ${message.kind === 'error' ? 'is-error' : 'is-ok'}`} role="status" data-testid="games-message">{message.text}</p>}
    </section>
  );
}
