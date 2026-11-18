/**
 * The screens under "More" on Progress (ADR-061), and the long-form details that used to sit
 * under "All the numbers". Their measures and wording are the older cards', moved, not
 * changed; each now has a screen of its own.
 */
import { useMemo } from 'react';
import { href } from '../app/router';
import { type Learner, useJournal } from '../app/store';
import { CONCEPTS } from '../content';
import type { Attempt } from '../db/types';
import { timeUse } from '../games/metrics';
import { endgameAccuracy, formatPct, PROVISIONAL_N, type RateMetric, retention, unseenAccuracy, wilson } from '../metrics/metrics';
import { walkRepertoire } from '../openings/repertoire';
import { reviewCalibration } from '../schedule/review';
import { CLOCK_SERIES_FROM, conditionDifference, ownMoveSummary, TIMED_SECONDS } from '../schedule/pace';
import { DataPanel } from './Data';
import { GameCards, useGames } from './Games';
import { bandLabel, useOpeningBook, useOpeningPrefs, useRepertoire } from './Openings';

export const MORE_PAGES = [
  { key: 'games', title: 'All time controls' },
  { key: 'retention', title: 'Retention' },
  { key: 'endgames', title: 'King and pawn endings' },
  { key: 'openings', title: 'Openings' },
  { key: 'playdays', title: 'Play days' },
  { key: 'level', title: 'Puzzle level' },
  { key: 'ranges', title: 'Reading the ranges' },
  { key: 'data', title: 'Your data and backup' },
] as const;
export type MorePage = (typeof MORE_PAGES)[number]['key'];

export function RateLine({ m, unit }: { m: RateMetric; unit: string }) {
  if (m.n === 0) return <p className="metric-empty" data-testid="insufficient">Insufficient data: no {unit} yet.</p>;
  return (
    <p className="metric-line">
      <span className="metric-value">{m.successes} of {m.n}</span>
      <span className="metric-pct">{formatPct(m.rate)}</span>
      <span className="metric-range">95% range {formatPct(m.interval!.lo)}–{formatPct(m.interval!.hi)}</span>
      {m.confidence === 'provisional' && <span className="tag">Provisional</span>}
    </p>
  );
}

/** Horizontal interval bar: the dot is the observed rate, the band its 95% range. */
export function IntervalBar({ m }: { m: RateMetric }) {
  if (!m.interval || m.rate === null) return <div className="ibar is-empty" aria-hidden />;
  return (
    <div className="ibar" role="img" aria-label={`${formatPct(m.rate)}, range ${formatPct(m.interval.lo)} to ${formatPct(m.interval.hi)}`}>
      <span className="ibar-band" style={{ left: `${m.interval.lo * 100}%`, width: `${(m.interval.hi - m.interval.lo) * 100}%` }} />
      <span className="ibar-dot" style={{ left: `${m.rate * 100}%` }} />
    </div>
  );
}

export function MorePageView({ page, learner }: { page: string; learner: Learner }) {
  const meta = MORE_PAGES.find((p) => p.key === page);
  return (
    <div className="page" data-testid={`more-${page}`}>
      <a className="back" href={href('progress')}>Progress</a>
      <h1>{meta?.title ?? 'Not found'}</h1>
      {page === 'games' && <GameCards sinceDate={undefined} periodLabel="all time" period="all" />}
      {page === 'retention' && <RetentionCard attempts={learner.attempts} />}
      {page === 'endgames' && <EndgameCard attempts={learner.attempts} />}
      {page === 'openings' && <OpeningsCard attempts={learner.attempts} />}
      {page === 'playdays' && <JournalCard />}
      {page === 'level' && <LevelCard learner={learner} />}
      {page === 'ranges' && <RangesCard />}
      {page === 'data' && <DataPanel learner={learner} />}
    </div>
  );
}

function RetentionCard({ attempts }: { attempts: Attempt[] }) {
  const ret = useMemo(() => retention(attempts), [attempts]);
  const calibration = useMemo(() => reviewCalibration(attempts), [attempts]);
  return (
    <section className="card" data-testid="card-retention">
      <h2>Remembered when due again</h2>
      <RateLine m={ret} unit="scheduled reviews" />
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
          The scheduler expected {formatPct(calibration.predicted)}; {formatPct(calibration.observed)} were recalled (n={calibration.n}{calibration.n < PROVISIONAL_N ? ', too few to judge the scheduler' : ''}).
        </p>
      )}
      <p className="definition-small">Positions you missed before, solved when they came back on schedule. Repeats done early are left out. The scheduler aims for 90% once an item is established and expects less for items missed only recently.</p>
      {ret.n > 0 && <a href={href('progress/positions', { set: 'retention' })}>View the {ret.n} reviews</a>}
    </section>
  );
}

function EndgameCard({ attempts }: { attempts: Attempt[] }) {
  const endgame = useMemo(() => endgameAccuracy(attempts), [attempts]);
  return (
    <section className="card" data-testid="card-endgame">
      <h2>Endgame technique, exact</h2>
      <RateLine m={endgame} unit="king-and-pawn play-outs" />
      {endgame.n > 0 && <p>Winning: {endgame.win.successes} of {endgame.win.n}. Holding the draw: {endgame.hold.successes} of {endgame.hold.n}.</p>}
      <p className="definition-small">King and pawn against king, the first time each start is seen: the win or draw kept on every move against perfect play, with no help. Moves are judged by the complete table of this ending, so a failure is a move that changed the result, not an engine preference.</p>
      <a href={href('practice/run', { mode: 'kpk' })}>Practise this ending</a>
    </section>
  );
}

function OpeningsCard({ attempts }: { attempts: Attempt[] }) {
  const book = useOpeningBook();
  const repertoire = useRepertoire();
  const prefs = useOpeningPrefs();
  const walk = useMemo(() => (book ? walkRepertoire(book, repertoire, prefs.side, [prefs.band]) : null), [book, repertoire, prefs.side, prefs.band]);
  const recalls = attempts.filter((a) => a.exerciseKind === 'opening' && a.outcome !== 'skipped');
  const recalled = recalls.filter((a) => a.outcome === 'success').length;
  const alt = (v: 'sound' | 'weaker' | 'unknown') => recalls.filter((a) => a.altVerdict === v).length;
  return (
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
            Recall: {recalls.length === 0 ? 'no recall attempts yet' : `${recalled} of ${recalls.length} recalled`}
            {recalls.length - recalled > 0 && ` (other moves played: ${alt('sound')} sound by engine evidence, ${alt('weaker')} weaker, ${recalls.length - recalled - alt('sound') - alt('weaker')} not evaluated or shown)`}.
          </p>
        </>
      )}
      {book && (
        <p className="definition-small">
          As {prefs.side === 'white' ? 'White' : 'Black'}, weighting opponents’ replies by how often players rated {bandLabel(book, prefs.band)} on Lichess play them ({book.manifest.games.used.toLocaleString()} games, {book.manifest.source.month}). A different sound move is reported separately, not as an error.
        </p>
      )}
      <a href={href('practice/openings')}>Open the repertoire</a>
    </section>
  );
}

function JournalCard() {
  const journal = useJournal();
  const tally = (r: 'win' | 'draw' | 'loss') => journal.filter((j) => j.result === r).length;
  const lastRated = journal.find((j) => j.ratingAfter !== null);
  return (
    <section className="card" data-testid="card-journal">
      <h2>Games you logged</h2>
      {journal.length === 0 ? (
        <p className="metric-empty">No games logged yet. Play days add them.</p>
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
      <p className="definition-small">Entered by you on play days. A handful of results says little about strength, and none of this is engine analysis.</p>
    </section>
  );
}

function LevelCard({ learner }: { learner: Learner }) {
  return (
    <section className="card" data-testid="card-level">
      <h2>Puzzle level</h2>
      <p className="metric-line"><span className="metric-value">{learner.level.level}</span><span className="metric-range">Lichess puzzle scale, from {learner.level.n} unseen positions</span></p>
      <p className="definition-small">Used only to choose how hard practice positions are. Starts at 1200 and moves after each unseen position. It is not a playing-strength rating.</p>
    </section>
  );
}

function RangesCard() {
  return (
    <section className="card" data-testid="card-ranges">
      <p><strong>95% range.</strong> A rate from a few dozen positions is uncertain. The range is where the true rate probably lies, given how many there were: the fewer positions, the wider it is. Two ranges that overlap a lot show no clear difference.</p>
      <p><strong>Provisional.</strong> Fewer than {PROVISIONAL_N} games, chances or first looks behind the number. It is shown, but read it as a first impression.</p>
      <p><strong>First looks.</strong> Training numbers count a position only the first time you see it. A position you have seen before says more about memory than about seeing.</p>
      <p><strong>Not cause and effect.</strong> A number that moves after you trained shows that it moved, not why.</p>
    </section>
  );
}

/** Per concept: first-try accuracy on unseen puzzles carrying the concept's themes. */
export function ConceptTable({ learner }: { learner: Learner }) {
  const perConcept = useMemo(
    () => learner.statuses.filter((s) => s.concept.themes.length > 0 && s.assessable).map((s) => ({ s, m: unseenAccuracy(learner.attempts, { themes: s.concept.themes }) })),
    [learner.attempts, learner.statuses],
  );
  const untested = perConcept.filter((x) => x.m.n === 0).length;
  return (
    <section className="card" data-testid="card-concepts">
      <h2>Fresh puzzles by concept</h2>
      <table className="concept-table">
        <thead>
          <tr><th scope="col">Concept</th><th scope="col">First try</th><th scope="col">Range</th></tr>
        </thead>
        <tbody>
          {perConcept.map(({ s, m }) => (
            <tr key={s.concept.id} data-testid={`row-${s.concept.id}`} data-n={m.n}>
              <th scope="row">
                <a href={href('progress/positions', { set: `concept:${s.concept.id}` })}>{s.concept.title}</a>
              </th>
              <td>{m.n === 0 ? <span className="muted">untested</span> : `${m.successes}/${m.n}${m.confidence === 'provisional' ? '*' : ''}`}</td>
              <td><IntervalBar m={m} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="definition-small">Unseen puzzles carrying the concept’s Lichess themes. {untested} of {perConcept.length} are untested, which is not the same as weak. * Provisional: fewer than {PROVISIONAL_N}.</p>
    </section>
  );
}

/** Curriculum coverage, the older card's numbers, under the concept grid. */
export function CoverageLine({ learner }: { learner: Learner }) {
  const stages = { demonstrated: 0, taught: 0, started: 0, new: 0 };
  for (const s of learner.statuses) stages[s.stage]++;
  return (
    <p className="definition-small" data-testid="coverage-line">
      {stages.demonstrated} of {CONCEPTS.length} concepts passed a check on unseen positions; {stages.taught} studied and waiting for a check, {stages.started} started, {stages.new} not started. {learner.statuses.filter((s) => !s.assessable).length} have no check of their own yet.
    </p>
  );
}

/**
 * "Your move" in full: the five ratings, the questions inside each answer, the clock
 * comparison and the clock in real games. Counts with denominators; no score is made of them.
 */
export function OwnMoveDetails({ attempts }: { attempts: Attempt[] }) {
  const games = useGames();
  const s = ownMoveSummary(attempts);
  const passed = s.grades.best + s.grades.good + s.grades.inaccuracy;
  const rated = passed + s.grades.mistake + s.grades.blunder;
  const answered = rated + s.grades.unrated;
  const diff = conditionDifference(s.timed, s.untimed);
  const count = (c: typeof s.timed) => c.passed + c.failed + c.unrated;
  const earlier = count(s.before.timed) + count(s.before.untimed);
  const points = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(100 * x))}`;
  const rapid = games ? timeUse(games, 'rapid') : null;
  const iv = rated ? wilson(passed, rated) : null;
  const line = (c: typeof s.timed) => {
    const all = c.passed + c.failed + c.unrated;
    return `${c.passed} of ${all} first looks passed${all ? ` (${formatPct(c.passed / all)})` : ''}${c.unrated ? `; ${c.unrated} of them could not be rated, so ${c.passed} of ${c.passed + c.failed} rated` : ''}`;
  };
  const rate = (b: { decisions: number; errors: number }) => `${b.errors} of ${b.decisions} moves${b.decisions ? ` (${(100 * b.errors / b.decisions).toFixed(1)}%)` : ''}`;
  if (answered === 0) return null;
  return (
    <section className="card" data-testid="ownmove-details">
      <h2>In detail</h2>
      <p className="metric-line" data-testid="ownmove-clean">
        <span className="metric-value">{passed} of {rated}</span>
        {iv && <span className="metric-pct">{formatPct(passed / rated)}</span>}
        <span className="metric-range">rated moves sound (best, good or an inaccuracy){iv ? `, 95% range ${formatPct(iv.lo)}–${formatPct(iv.hi)}` : ''}</span>
      </p>
      <p data-testid="ownmove-grades">Best {s.grades.best}, good {s.grades.good}, inaccuracies {s.grades.inaccuracy}, mistakes {s.grades.mistake}, blunders {s.grades.blunder}{s.grades.unrated ? `, not rated ${s.grades.unrated}` : ''}. When something of yours could already be taken, your move dealt with it {s.threat.met} of {s.threat.n} times. When something could be taken for nothing, you took it {s.free.taken} of {s.free.n} times. When your move left something, the reply you named was that one {s.named.yes} of {s.named.n} times.</p>
      <p data-testid="ownmove-pace">
        With {TIMED_SECONDS} seconds on the clock: {line(s.timed)}{s.timed.late ? `; ${s.timed.late} ${s.timed.late === 1 ? 'was' : 'were'} made after the time ran out` : ''}. With no clock: {line(s.untimed)}.
        {diff && ` Timed minus untimed: ${points(diff.diff)} points, 95% range ${points(diff.lo)} to ${points(diff.hi)}; a range that includes 0 shows no difference yet.`}
        {s.interrupted > 0 && ` ${s.interrupted} ${s.interrupted === 1 ? 'answer is' : 'answers are'} left out of this comparison because the app left the screen while the move was being chosen.`}
        {s.shownBefore > 0 && <span data-testid="ownmove-shown-before"> {s.shownBefore} more {s.shownBefore === 1 ? 'is' : 'are'} left out because the position had been shown once before it was answered.</span>}
        {' '}About one position in three gets the clock, chosen by the position and not by how you are doing.
        {' '}Counted from {CLOCK_SERIES_FROM}, when the clock began to be announced and to run in sight.
        {earlier > 0 && <span data-testid="ownmove-pace-before"> Before that, with the clock as a line of small text: {line(s.before.timed)} with it, {line(s.before.untimed)} without.</span>}
      </p>
      {rapid && rapid.games > 0 && (
        <p data-testid="ownmove-time">
          In your {rapid.games} measured rapid games, major errors came on {rate(rapid.overHalf)} begun with more than half the clock left, and on {rate(rapid.halfOrLess)} begun with half or less.
          {rapid.losses > 0 && ` Of ${rapid.losses} lost games, ${rapid.lossesOnTime} ${rapid.lossesOnTime === 1 ? 'was' : 'were'} lost on time. Of the other ${rapid.losses - rapid.lossesOnTime}, ${rapid.lossesOverHalfUnused} had more than half the clock left after your last completed move.`}
        </p>
      )}
      <p className="definition-small">Each move is rated by the built-in engine against its own first choice: under 5 points below is good, under 10 an inaccuracy, under 20 a mistake, more a blunder; allowing mate in one is always a blunder. The engine is a small one and can be wrong. The rapid figures are from your own games’ clocks, recorded after each move you made.</p>
    </section>
  );
}
