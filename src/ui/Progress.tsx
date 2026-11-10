import { useMemo, useState } from 'react';
import { href, type Route } from '../app/router';
import { type Learner, usePool } from '../app/store';
import { STARTING_PROFILE } from '../app/profile';
import { applyUci, positionFromFen, sanOf } from '../chess/rules';
import { CONCEPT_BY_ID, CONCEPTS, LESSON_BY_ID, THEMES } from '../content';
import type { Attempt } from '../db/types';
import { formatPct, PROVISIONAL_N, type RateMetric, retention, unseenAccuracy } from '../metrics/metrics';
import { startRun } from '../puzzles/run';
import { Board } from './Board';
import { DataPanel } from './Data';
import { PuzzlePlayer } from './PuzzlePlayer';

const DAY = 86_400_000;
const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];
const MIN_FOCUS_N = 8;

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
  const perConcept = useMemo(
    () => learner.statuses.filter((s) => s.concept.themes.length > 0 && s.assessable).map((s) => ({ s, m: unseenAccuracy(learner.attempts, { themes: s.concept.themes, since: from }) })),
    [learner.attempts, learner.statuses, from],
  );
  const stages = { demonstrated: 0, taught: 0, started: 0, new: 0 };
  for (const s of learner.statuses) stages[s.stage]++;
  const untested = perConcept.filter((x) => x.m.n === 0).length;
  const focus = perConcept.filter((x) => x.m.n >= MIN_FOCUS_N).sort((a, b) => a.m.interval!.hi - b.m.interval!.hi)[0];
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

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
          Solved on the first-ever showing with no wrong move and no hint, out of all first-ever showings; {periodLabel}. Left out: {overall.excluded.repeats} repeats and reviews, {overall.excluded.skipped} skipped, {overall.excluded.guided} guided lesson examples.
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
        <p className="definition-small">Positions you missed before, solved when they came back on schedule; {periodLabel}. Repeats done early are left out. The scheduler aims for 90% recall, so a much lower figure with enough reviews means intervals are too long.</p>
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
        {ret.n > 0 && <a href={href('progress/positions', { set: 'retention', period })}>View the {ret.n} reviews</a>}
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

      <section className="card" data-testid="card-ratings">
        <h2>Game ratings</h2>
        <ul className="rating-list">
          {STARTING_PROFILE.ratings.map((r) => (<li key={r.label}><span>{r.label}</span><strong>{r.value}</strong></li>))}
        </ul>
        <p className="definition-small">{STARTING_PROFILE.source}, {STARTING_PROFILE.enteredOn}. Each is a separate scale and they are not comparable. No games are imported yet, so there is no trend and no game-error analysis.</p>
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
