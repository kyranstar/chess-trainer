import { useMemo, useState } from 'react';
import { href, type Route } from '../app/router';
import { type Learner, useJournal, usePool } from '../app/store';
import { applyUci, positionFromFen, sanOf } from '../chess/rules';
import { CONCEPT_BY_ID, CONCEPTS, LESSON_BY_ID, THEMES } from '../content';
import type { Attempt } from '../db/types';
import { endgameAccuracy, formatPct, PROVISIONAL_N, type RateMetric, retention, unseenAccuracy } from '../metrics/metrics';
import { startRun } from '../puzzles/run';
import { Board } from './Board';
import { walkRepertoire } from '../openings/repertoire';
import { reviewCalibration } from '../schedule/review';
import { DataPanel } from './Data';
import { GameCards } from './Games';
import { bandLabel, useOpeningBook, useOpeningPrefs, useRepertoire } from './Openings';
import { PuzzlePlayer } from './PuzzlePlayer';

const DAY = 86_400_000;
const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];
const MIN_FOCUS_N = 8;

/** Lower bound as a local date string for date-keyed game metrics. */
export function sinceDateOf(period: string): string | undefined {
  const p = PERIODS.find((x) => x.key === period);
  if (!p || p.days === null) return undefined;
  const d = new Date(Date.now() - p.days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function since(period: PeriodKey): number | undefined {
  const p = PERIODS.find((x) => x.key === period)!;
  return p.days === null ? undefined : Date.now() - p.days * DAY;
}

function RateLine({ m, unit }: { m: RateMetric; unit: string }) {
  if (m.n === 0) return <p className="metric-empty" data-testid="insufficient">Insufficient data: no {unit} in this period.</p>;
  return (
    <p className="metric-line">
      <span className="metric-value">{m.successes} of {m.n}</span>
      <span className="metric-pct">{formatPct(m.rate)}</span>
      <span className="metric-range">plausible range {formatPct(m.interval!.lo)}–{formatPct(m.interval!.hi)}</span>
      {m.confidence === 'provisional' && <span className="badge" title={`Fewer than ${PROVISIONAL_N} observations`}>provisional, n&lt;{PROVISIONAL_N}</span>}
    </p>
  );
}

/** Horizontal interval bar: the dot is the observed rate, the band its 95% Wilson interval. */
function IntervalBar({ m }: { m: RateMetric }) {
  if (!m.interval || m.rate === null) return <div className="ibar is-empty" aria-hidden />;
  return (
    <div className="ibar" role="img" aria-label={`${formatPct(m.rate)}, range ${formatPct(m.interval.lo)} to ${formatPct(m.interval.hi)}`}>
      <span className="ibar-band" style={{ left: `${m.interval.lo * 100}%`, width: `${(m.interval.hi - m.interval.lo) * 100}%` }} />
      <span className="ibar-dot" style={{ left: `${m.rate * 100}%` }} />
    </div>
  );
}

export function ProgressHome({ learner }: { learner: Learner }) {
  const [period, setPeriod] = useState<PeriodKey>('all');
  const from = since(period);
  const overall = useMemo(() => unseenAccuracy(learner.attempts, { since: from }), [learner.attempts, from]);
  const ret = useMemo(() => retention(learner.attempts, from), [learner.attempts, from]);
  const endgame = useMemo(() => endgameAccuracy(learner.attempts, from), [learner.attempts, from]);
  const calibration = useMemo(() => reviewCalibration(learner.attempts, from), [learner.attempts, from]);
  const perConcept = useMemo(
    () => learner.statuses.filter((s) => s.concept.themes.length > 0 && s.assessable).map((s) => ({ s, m: unseenAccuracy(learner.attempts, { themes: s.concept.themes, since: from }) })),
    [learner.attempts, learner.statuses, from],
  );
  const stages = { demonstrated: 0, taught: 0, started: 0, new: 0 };
  for (const s of learner.statuses) stages[s.stage]++;
  const untested = perConcept.filter((x) => x.m.n === 0).length;
  const focus = perConcept.filter((x) => x.m.n >= MIN_FOCUS_N).sort((a, b) => a.m.interval!.hi - b.m.interval!.hi)[0];
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const journal = useJournal().filter((j) => from === undefined || j.ts >= from);
  const tally = (r: 'win' | 'draw' | 'loss') => journal.filter((j) => j.result === r).length;
  const lastRated = journal.find((j) => j.ratingAfter !== null);
  const book = useOpeningBook();
  const repertoire = useRepertoire();
  const prefs = useOpeningPrefs();
  const walk = useMemo(() => (book ? walkRepertoire(book, repertoire, prefs.side, [prefs.band]) : null), [book, repertoire, prefs.side, prefs.band]);
  const recalls = learner.attempts.filter((a) => a.exerciseKind === 'opening' && a.outcome !== 'skipped' && (from === undefined || a.ts >= from));
  const recalled = recalls.filter((a) => a.outcome === 'success').length;
  const alt = (v: 'sound' | 'weaker' | 'unknown') => recalls.filter((a) => a.altVerdict === v).length;

  return (
    <div className="page" data-testid="progress-home">
      <h1>Progress</h1>
      <div className="length-picker" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.key} className={p.key === period ? 'chip is-on' : 'chip'} aria-pressed={p.key === period} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      <section className="card focus" data-testid="card-focus">
        <h2>Where to put effort</h2>
        {overall.n < PROVISIONAL_N ? (
          <p>Not enough evidence yet: {overall.n} unseen position{overall.n === 1 ? '' : 's'} so far, and nothing is called a weakness below {PROVISIONAL_N}. Today’s mixed test samples untested concepts first.</p>
        ) : focus ? (
          <>
            <p>Lowest first-try rate so far: <strong>{focus.s.concept.title}</strong>, {focus.m.successes} of {focus.m.n} unseen ({formatPct(focus.m.interval!.lo)}–{formatPct(focus.m.interval!.hi)}). This describes practice positions, not why games are lost.</p>
            <div className="actions">
              <a className="button primary" href={href('practice/run', { concept: focus.s.concept.id })}>Practise this</a>
              <a className="button" href={href('progress/positions', { set: `concept:${focus.s.concept.id}`, period })}>View positions</a>
            </div>
          </>
        ) : (
          <p>No single concept has {MIN_FOCUS_N} or more unseen positions yet, so none is singled out.</p>
        )}
      </section>

      <section className="card" data-testid="card-unseen">
        <h2>Unseen puzzle accuracy</h2>
        <RateLine m={overall} unit="unseen positions" />
        <IntervalBar m={overall} />
        <p className="definition-small">
          Solved on the first-ever showing with no wrong move and no hint, out of all first-ever showings; {periodLabel}. Left out: {overall.excluded.repeats} repeats and reviews, {overall.excluded.skipped} skipped, {overall.excluded.guided} lesson examples and opening recalls.
        </p>
        {overall.n > 0 && <a href={href('progress/positions', { set: 'unseen', period })} data-testid="view-unseen">View the {overall.n} positions</a>}
      </section>

      <section className="card" data-testid="card-concepts">
        <h2>By concept</h2>
        <p className="definition-small">Same definition, restricted to positions carrying the concept’s Lichess theme tags; {periodLabel}. {untested} of {perConcept.length} concepts are untested, which is not the same as weak.</p>
        <table className="concept-table">
          <thead>
            <tr><th scope="col">Concept</th><th scope="col">First try</th><th scope="col">Range</th></tr>
          </thead>
          <tbody>
            {perConcept.map(({ s, m }) => (
              <tr key={s.concept.id} data-testid={`row-${s.concept.id}`} data-n={m.n}>
                <th scope="row">
                  <a href={href('progress/positions', { set: `concept:${s.concept.id}`, period })}>{s.concept.title}</a>
                  <span className="row-stage">{s.stage === 'demonstrated' ? 'demonstrated' : s.stage === 'taught' ? 'studied' : ''}</span>
                </th>
                <td>{m.n === 0 ? <span className="muted">untested</span> : `${m.successes}/${m.n}${m.confidence === 'provisional' ? '*' : ''}`}</td>
                <td><IntervalBar m={m} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="definition-small">* provisional: fewer than {PROVISIONAL_N} positions. The bar shows the 95% Wilson interval on a 0–100% scale.</p>
      </section>

      <section className="card" data-testid="card-retention">
        <h2>Retention</h2>
        <RateLine m={ret} unit="scheduled reviews" />
        <p className="definition-small">Positions you missed before, solved when they came back on schedule; {periodLabel}. Repeats done early are left out. The scheduler aims for 90% recall once an item is established and forecasts less for items missed only recently; the forecast line below is what it predicted for exactly these reviews.</p>
        {ret.n > 0 && (
          <table className="concept-table">
            <thead><tr><th scope="col">Days since last seen</th><th scope="col">Recalled</th></tr></thead>
            <tbody>
              {ret.buckets.map((b) => (
                <tr key={b.label}><th scope="row">{b.label}</th><td>{b.n === 0 ? <span className="muted">none</span> : `${b.successes}/${b.n}`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {calibration.n > 0 && (
          <p data-testid="calibration">
            Scheduler forecast for these reviews: {formatPct(calibration.predicted)} expected, {formatPct(calibration.observed)} recalled (n={calibration.n}{calibration.n < PROVISIONAL_N ? ', too few to judge the scheduler' : ''}).
          </p>
        )}
        {ret.n > 0 && <a href={href('progress/positions', { set: 'retention', period })}>View the {ret.n} reviews</a>}
      </section>

      <section className="card" data-testid="card-endgame">
        <h2>Endgame technique, exact</h2>
        <RateLine m={endgame} unit="king-and-pawn play-outs" />
        {endgame.n > 0 && <p>Winning: {endgame.win.successes} of {endgame.win.n}. Holding the draw: {endgame.hold.successes} of {endgame.hold.n}.</p>}
        <p className="definition-small">King and pawn against king, first time each start is seen: the win or draw kept on every move against perfect play, with no help; {periodLabel}. Moves are judged by the complete table of this ending, so a failure is a move that changed the theoretical result, not an engine preference.</p>
        <a href={href('practice/run', { mode: 'kpk' })}>Practise this ending</a>
      </section>

      <section className="card" data-testid="card-coverage">
        <h2>Curriculum coverage</h2>
        <p className="metric-line">
          <span className="metric-value">{stages.demonstrated} of {CONCEPTS.length}</span>
          <span className="metric-range">concepts demonstrated on unseen positions</span>
        </p>
        <p className="definition-small">
          {stages.taught} studied and awaiting a check, {stages.started} started, {stages.new} not started. {learner.statuses.filter((s) => !s.assessable).length} concepts have no independent check yet and cannot be demonstrated. All time.
        </p>
        <a href={href('learn')}>Open the curriculum</a>
      </section>

      <GameCards sinceDate={sinceDateOf(period)} periodLabel={periodLabel} period={period} />

      <section className="card" data-testid="card-openings">
        <h2>Opening preparedness</h2>
        {!book || !walk ? (
          <p className="metric-empty">Opening data is not on this device yet.</p>
        ) : repertoire.filter((e) => e.side === prefs.side).length === 0 ? (
          <p className="metric-empty">No repertoire moves recorded as {prefs.side === 'white' ? 'White' : 'Black'} yet.</p>
        ) : (
          <>
            <p className="metric-line">
              <span className="metric-value">{formatPct(walk.levels[2]?.answered ?? 0)}</span>
              <span className="metric-range">of games have a recorded answer through your 3rd move; {formatPct(walk.levels[4]?.answered ?? 0)} through your 5th</span>
            </p>
            <p>
              Recall: {recalls.length === 0 ? 'no recall attempts in this period' : `${recalled} of ${recalls.length} recalled`}
              {recalls.length - recalled > 0 && ` (other moves played: ${alt('sound')} sound by engine evidence, ${alt('weaker')} weaker, ${recalls.length - recalled - alt('sound') - alt('weaker')} not evaluated or shown)`}.
            </p>
          </>
        )}
        {book && (
          <p className="definition-small">
            As {prefs.side === 'white' ? 'White' : 'Black'}, weighting opponents’ replies by how often players rated {bandLabel(book, prefs.band)} on Lichess play them ({book.manifest.games.used.toLocaleString()} games, {book.manifest.source.month}). Coverage counts recorded answers, all time; recall counts attempts to produce your own chosen move, {periodLabel}. A different sound move is reported separately, not as an error.
          </p>
        )}
        <a href={href('practice/openings')}>Open the repertoire</a>
      </section>

      <section className="card" data-testid="card-journal">
        <h2>Games you logged</h2>
        {journal.length === 0 ? (
          <p className="metric-empty">No games logged in this period. Play days add them.</p>
        ) : (
          <>
            <p className="metric-line">
              <span className="metric-value">{journal.length}</span>
              <span className="metric-range">rapid game{journal.length === 1 ? '' : 's'}: {tally('win')} won, {tally('draw')} drawn, {tally('loss')} lost</span>
            </p>
            {lastRated && <p>Latest rapid rating you entered: <strong>{lastRated.ratingAfter}</strong> on {new Date(lastRated.ts).toLocaleDateString()}.</p>}
            <ul className="attempt-list">
              {journal.slice(0, 10).map((j) => (
                <li key={j.id}>
                  <span className="journal-row" data-testid="journal-row">
                    <span className="concept-name">{new Date(j.ts).toLocaleDateString()}: {j.result ?? 'no result'}{j.color ? ` as ${j.color}` : ''}{j.ratingAfter ? `, rating ${j.ratingAfter}` : ''}</span>
                    {j.turningPoint && <span className="concept-meta">Turning point: {j.turningPoint}</span>}
                    {j.nextTime && <span className="concept-meta">Next time: {j.nextTime}</span>}
                    {j.url && <a className="concept-meta" href={j.url} target="_blank" rel="noreferrer">Open the game</a>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="definition-small">Entered by you on play days; {periodLabel}. A handful of results says little about strength, and none of this is engine analysis.</p>
      </section>

      <section className="card" data-testid="card-level">
        <h2>Practice difficulty</h2>
        <p className="metric-line"><span className="metric-value">{learner.level.level}</span><span className="metric-range">Lichess puzzle scale, from {learner.level.n} unseen positions</span></p>
        <p className="definition-small">Used only to choose how hard practice positions are. Starts at 1200 and moves after each unseen position. It is not a playing-strength rating.</p>
      </section>

      <DataPanel learner={learner} />
    </div>
  );
}

function attemptsForSet(learner: Learner, set: string, period: PeriodKey): { title: string; uuids: string[] } {
  const from = since(period);
  if (set === 'unseen') return { title: 'Unseen positions', uuids: unseenAccuracy(learner.attempts, { since: from }).attemptUuids };
  if (set === 'retention') return { title: 'Scheduled reviews', uuids: retention(learner.attempts, from).attemptUuids };
  if (set.startsWith('concept:')) {
    const c = CONCEPT_BY_ID.get(set.slice(8));
    if (c) return { title: `Unseen positions: ${c.title}`, uuids: unseenAccuracy(learner.attempts, { themes: c.themes, since: from }).attemptUuids };
  }
  return { title: 'Positions', uuids: [] };
}

const OUTCOME_TEXT: Record<Attempt['outcome'], string> = { success: 'solved first try', fail: 'missed', assisted: 'assisted', skipped: 'skipped' };

export function PositionsList({ route, learner }: { route: Route; learner: Learner }) {
  const set = route.query.get('set') ?? 'unseen';
  const period = (route.query.get('period') ?? 'all') as PeriodKey;
  const { title, uuids } = attemptsForSet(learner, set, period);
  const wanted = new Set(uuids);
  const rows = learner.attempts.filter((a) => wanted.has(a.uuid)).sort((a, b) => b.ts - a.ts);
  return (
    <div className="page" data-testid="positions">
      <a className="back" href={href('progress')}>Progress</a>
      <h1>{title}</h1>
      <p className="muted">{rows.length} attempt{rows.length === 1 ? '' : 's'}, newest first. These are exactly the rows behind the number.</p>
      <ul className="attempt-list">
        {rows.map((a) => (
          <li key={a.uuid}>
            <a href={href(`progress/position/${a.uuid}`)} data-testid="attempt-row" data-outcome={a.outcome}>
              <span className={`outcome-mark is-${a.outcome}`} aria-hidden />
              <span className="concept-name">{OUTCOME_TEXT[a.outcome]}</span>
              <span className="concept-meta">
                {new Date(a.ts).toLocaleDateString()} {a.themes.filter((t) => THEMES[t]).map((t) => THEMES[t]!.name).join(', ')}{a.rating ? `, rated ${a.rating}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PositionView({ uuid, learner }: { uuid: string; learner: Learner }) {
  const pool = usePool();
  const [again, setAgain] = useState(false);
  const a = learner.attempts.find((x) => x.uuid === uuid);
  if (!learner.ready || !pool) return <div className="page"><p className="muted">Loading</p></div>;
  if (!a) return <div className="page"><p>Attempt not found.</p><a href={href('progress')}>Progress</a></div>;
  const back = <a className="back" href={href('progress')}>Progress</a>;
  const when = new Date(a.ts).toLocaleString();

  if (a.exerciseKind === 'lesson-try') {
    const [, lessonId, stepNo] = a.exerciseId.split(':');
    const lesson = lessonId ? LESSON_BY_ID.get(lessonId) : undefined;
    return (
      <div className="page">{back}
        <h1>Lesson example</h1>
        <p>{lesson?.title ?? a.exerciseId}, part {stepNo}. {OUTCOME_TEXT[a.outcome]} on {when}.</p>
        {lesson && <a className="button" href={href(`learn/${lesson.conceptId}`)}>Open the concept</a>}
      </div>
    );
  }
  const puzzle = pool.byId.get(a.exerciseId.replace(/^lichess:/, ''));
  if (!puzzle) return <div className="page">{back}<h1>Position retired</h1><p>This attempt ({OUTCOME_TEXT[a.outcome]}, {when}) is kept, but its position is no longer in the installed pack.</p></div>;
  if (again) {
    return (
      <div className="page run">{back}
        <PuzzlePlayer puzzle={puzzle} context="practice" conceptId={a.conceptId} sessionId={null} packVersion={pool.version} allowHints heading="Repeat (not counted as unseen)" onNext={() => setAgain(false)} nextLabel="Done" />
      </div>
    );
  }
  const run = startRun(puzzle);
  let pos = positionFromFen(run.fen);
  const firstSan = a.firstMove ? safeSan(run.fen, a.firstMove) : null;
  const line: string[] = [];
  for (const u of run.line.slice(1)) {
    line.push(sanOf(pos, u));
    pos = applyUci(pos, u);
  }
  return (
    <div className="page" data-testid="position-view">{back}
      <p className="kicker">{when}</p>
      <h1>{run.solver === 'white' ? 'White' : 'Black'} to move</h1>
      <Board fen={run.fen} orientation={run.solver} movable={null} lastMove={run.setupMove} />
      <dl className="facts">
        <dt>Result</dt><dd>{OUTCOME_TEXT[a.outcome]}{a.fresh ? ', first time seen' : a.scheduledReview ? ', scheduled review' : ', repeat'}</dd>
        <dt>Your first move</dt><dd>{firstSan ?? 'none'}</dd>
        <dt>Solution</dt><dd>{line.join(' ')}</dd>
        <dt>Themes</dt><dd>{puzzle.themes.filter((t) => THEMES[t]).map((t) => THEMES[t]!.name).join(', ') || 'none tagged'}; Lichess rating {puzzle.rating}</dd>
        <dt>Time</dt><dd>{Math.round(a.elapsedMs / 1000)} s{a.hints ? `, ${a.hints} hint` : ''}</dd>
        <dt>Source</dt><dd><a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">Lichess puzzle {puzzle.id}</a>, from <a href={`https://lichess.org/${puzzle.game}`} target="_blank" rel="noreferrer">this game</a></dd>
      </dl>
      <div className="actions"><button className="primary" onClick={() => setAgain(true)}>Practise this again</button></div>
    </div>
  );
}

function safeSan(fen: string, uci: string): string {
  try {
    return sanOf(positionFromFen(fen), uci);
  } catch {
    return uci;
  }
}
