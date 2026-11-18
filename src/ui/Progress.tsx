import { type ReactNode, useMemo, useState } from 'react';
import { href, type Route } from '../app/router';
import { type Learner, useDueReviews, useNow, usePool } from '../app/store';
import { applyUci, positionFromFen, sanOf } from '../chess/rules';
import { CONCEPT_BY_ID, LESSON_BY_ID, THEMES } from '../content';
import type { Attempt } from '../db/types';
import { retention, unseenAccuracy } from '../metrics/metrics';
import { startRun } from '../puzzles/run';
import {
  activityDays, byPhase, chanceList, conceptCells, earlyRate, errorRatio, type GameRow, markBlocks, type Mark, momentsOf, nextAction, ownMoveMarks, puzzleMarks, rapidRows,
  rateOfMarks, rollingErrors, senseMarks, trainingIndex, trainingStartOf,
} from '../progress/series';
import { Board } from './Board';
import { BarList, BlockChart, CELL_TEXT, ConceptGrid, DayBars, GameSquares, Legend, LineChart, MarkStrip, RangeRows, shortDate, type Square } from './charts';
import { GameCards, useGames, useLiveRatings } from './Games';
import { MORE_PAGES } from './ProgressMore';
import { PuzzlePlayer } from './PuzzlePlayer';

/** Lower bound as a local date string for date-keyed game metrics (the positions lists still take a period). */
export function sinceDateOf(period: string): string | undefined {
  const days = period === '7' ? 7 : period === '30' ? 30 : null;
  if (days === null) return undefined;
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const pctText = (x: number | null) => (x === null ? '–' : `${Math.round(100 * x)}%`);
export const rangeText = (r: { lo: number; hi: number }) => `95% range ${Math.round(100 * r.lo)}–${Math.round(100 * r.hi)}%`;
export const per100 = (x: number) => (100 * x).toFixed(1);
export const RESULT_WORD = { win: 'Win', draw: 'Draw', loss: 'Loss' } as const;
export const colourWord = (c: 'white' | 'black') => (c === 'white' ? 'White' : 'Black');
export const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x)}`;
const PROVISIONAL_N = 20;

/** Everything the overview and the detail screens share, computed once per change. */
export function useProgress(learner: Learner) {
  const games = useGames();
  const now = useNow();
  const rows = useMemo(() => (games ? rapidRows(games) : []), [games]);
  const start = useMemo(() => trainingStartOf(learner.attempts), [learner.attempts]);
  return { games, rows, start, tIdx: trainingIndex(rows, start), now };
}

/** The squares of the early-blunder strip for some rows. */
export function squaresOf(rows: GameRow[]): Square[] {
  return rows.map((r) => ({
    filled: !!r.early.event,
    pending: !r.early.measured,
    label: `Game ${r.index}, ${shortDate(r.game.endDate)}: ${!r.early.measured ? 'not measured yet' : r.early.event ? `early blunder on move ${Math.floor(r.early.event.ply / 2) + 1}` : 'no early blunder'}`,
  }));
}

/** Where training began inside a run of rows, as a position in it, or null. */
export const markerIn = (rows: GameRow[], tIdx: number | null) => (tIdx === null ? null : rows.findIndex((r) => r.index === tIdx) >= 0 ? rows.findIndex((r) => r.index === tIdx) : null);

function Card({ id, testid, title, value, sub, range, provisional, children, empty }: { id: string; testid: string; title: string; value?: ReactNode; sub?: ReactNode; range?: ReactNode; provisional?: boolean; children?: ReactNode; empty?: ReactNode }) {
  return (
    <a className="pcard" href={href(`progress/metric/${id}`)} data-testid={testid}>
      <span className="pcard-head"><span className="pcard-title">{title}</span><span className="chev" aria-hidden>›</span></span>
      {empty ? (
        <span className="pcard-empty">{empty}</span>
      ) : (
        <>
          <span className="pcard-value">{value}</span>
          {children}
          <span className="pcard-sub">{sub}</span>
          {(range || provisional) && <span className="pcard-range">{range}{provisional && <span className="tag">Provisional</span>}</span>}
        </>
      )}
    </a>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="psec">
      <h2 className="psec-title">{title}{meta && <span className="psec-meta">{meta}</span>}</h2>
      {children}
    </section>
  );
}

export function ProgressHome({ learner }: { learner: Learner }) {
  const { games, rows, tIdx, now } = useProgress(learner);
  const due = useDueReviews(learner.reviews, now);
  const dueFromGames = due.filter((r) => r.itemId.startsWith('pos:') || r.itemId.startsWith('game:')).length;
  return (
    <div className="page progress" data-testid="progress-home">
      <h1>Progress</h1>
      {games && games.length > 0 && <NextUp rows={rows} dueFromGames={dueFromGames} />}
      {games && games.length > 0 && <RecentGames rows={rows} />}
      {games && games.length === 0 && <GameCards sinceDate={undefined} periodLabel="all time" period="all" />}
      {rows.length > 0 && (
        <Section title="In your games" meta={`${rows.length} rated rapid`}>
          <EarlyCard rows={rows} tIdx={tIdx} />
          <RatingCard rows={rows} tIdx={tIdx} />
          <MistakesCard rows={rows} tIdx={tIdx} />
          <ChancesCard rows={rows} />
          <HowCard rows={rows} />
        </Section>
      )}
      <Section title="In training" meta="First looks only">
        <SenseCard attempts={learner.attempts} kind="safe-or-not" />
        <OwnMoveCard attempts={learner.attempts} />
        <SenseCard attempts={learner.attempts} kind="chance-or-not" />
        <PuzzlesCard attempts={learner.attempts} />
      </Section>
      <Section title="Learning">
        <ChecksCard learner={learner} now={now} />
        <ActivityCard attempts={learner.attempts} now={now} />
      </Section>
      <Section title="More">
        <ul className="rowlist" data-testid="progress-more">
          {MORE_PAGES.map((p) => (
            <li key={p.key}><a href={href(`progress/more/${p.key}`)} data-testid={`more-link-${p.key}`}>{p.title}<span className="chev" aria-hidden>›</span></a></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const ACTION_TITLE = { early: 'Look again at your latest early blunder', biggest: 'Look again at the biggest mistake of your latest game', chance: 'Find the chance your latest game had', clock: 'Look again at the move you made short of time' } as const;

function NextUp({ rows, dueFromGames }: { rows: GameRow[]; dueFromGames: number }) {
  const a = nextAction(rows, dueFromGames);
  if (a.kind === 'review') {
    const g = a.row.game;
    return (
      <a className="pcard nextup" href={href(`progress/game-event/${g.id}/${a.moment.ply}`)} data-testid="next-up" data-kind={a.moment.kind}>
        <span className="pcard-title">Next up</span>
        <span className="nextup-what">{ACTION_TITLE[a.moment.kind]}</span>
        <span className="pcard-sub">Move {a.moment.move} · {g.result ? `${RESULT_WORD[g.result]} as ${colourWord(g.color)}` : colourWord(g.color)} · {shortDate(g.endDate)}</span>
        <span className="button primary nextup-go">Open the position</span>
      </a>
    );
  }
  if (a.kind === 'due') {
    return (
      <a className="pcard nextup" href={href('practice/run', { mode: 'review' })} data-testid="next-up" data-kind="due">
        <span className="pcard-title">Next up</span>
        <span className="nextup-what">Positions from your games are due again</span>
        <span className="pcard-sub">{a.count} due in review</span>
        <span className="button primary nextup-go">Review them</span>
      </a>
    );
  }
  return (
    <a className="pcard nextup" href={href('today')} data-testid="next-up" data-kind="none">
      <span className="pcard-title">Next up</span>
      <span className="nextup-what">Nothing to look at from your latest game</span>
      <span className="pcard-sub">No big mistake, early blunder or missed chance was found in it</span>
      <span className="button primary nextup-go">Today’s training</span>
    </a>
  );
}

export function GameRowLink({ row }: { row: GameRow }) {
  const g = row.game;
  const m = momentsOf(row);
  const early = row.early.event ? `Early blunder, move ${Math.floor(row.early.event.ply / 2) + 1}` : null;
  return (
    <a href={href(`progress/game/${g.id}`)} className="grow" data-testid="game-row">
      <span className={`result-mark is-${g.result ?? 'none'}`} aria-hidden>{g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : g.result === 'draw' ? 'D' : '·'}</span>
      <span className="grow-main">
        <span className="grow-title">{g.result ? RESULT_WORD[g.result] : 'No result'} as {colourWord(g.color)}<span className="muted"> · {shortDate(g.endDate)}</span></span>
        <span className="grow-meta">
          {row.analysed ? `${row.errors} big mistake${row.errors === 1 ? '' : 's'}` : 'Not analysed yet'}
          {early ? ` · ${early}` : m.some((x) => x.kind === 'chance') ? ' · A chance missed' : ''}
        </span>
      </span>
      <span className="grow-rating">
        {g.playerRating ?? '–'}
        {row.ratingChange !== null && <span className={row.ratingChange >= 0 ? 'delta' : 'delta is-down'}>{signed(row.ratingChange)}</span>}
      </span>
    </a>
  );
}

function RecentGames({ rows }: { rows: GameRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Recent games">
      <div className="pcard is-list" data-testid="recent-games">
        {rows.slice(-3).reverse().map((r) => <GameRowLink key={r.game.id} row={r} />)}
        <a className="grow-all" href={href('progress/games')}>All {rows.length} games<span className="chev" aria-hidden>›</span></a>
      </div>
    </Section>
  );
}

export function earlyView(rows: GameRow[]) {
  const last = rows.slice(-20);
  const before = rows.length >= 40 ? rows.slice(-40, -20) : null;
  const now = earlyRate(last);
  const prev = before ? earlyRate(before) : null;
  const waiting = rows.slice(-40).filter((r) => !r.early.measured).length;
  return { last, before, now, prev, waiting };
}

function EarlyCard({ rows, tIdx }: { rows: GameRow[]; tIdx: number | null }) {
  const { last, before, now, prev, waiting } = earlyView(rows);
  const strip = [...(before ? [{ name: '20 before', squares: squaresOf(before), markerAt: markerIn(before, tIdx) }] : []), { name: rows.length > 20 ? 'Last 20' : 'So far', squares: squaresOf(last), markerAt: markerIn(last, tIdx) }];
  return (
    <Card id="early" testid="card-early" title="Early blunders" provisional={now.n < PROVISIONAL_N}
      empty={now.n === 0 ? (waiting ? `${waiting} games waiting to be measured` : 'No rated rapid games measured yet') : undefined}
      value={<><strong data-testid="early-value">{now.k} of {now.n}</strong><span className="pcard-unit">games</span></>}
      sub={<>{rows.length > 20 ? 'Last 20 rated rapid' : `${now.n} rated rapid`}{prev ? ` · ${prev.k} in the 20 before` : ''}{waiting ? ` · ${waiting} waiting` : ''}</>}
      range={now.n ? rangeText(now) : null}>
      <GameSquares rows={strip} marker="Training" title={`Early blunders: ${now.k} of the last ${now.n} rated rapid games${prev ? `, ${prev.k} of the ${prev.n} before` : ''}.`} />
    </Card>
  );
}

export function ratingPoints(rows: GameRow[]) {
  return rows.filter((r) => r.game.playerRating !== null).map((r) => ({ x: r.index, y: r.game.playerRating!, label: `Game ${r.index}, ${shortDate(r.game.endDate)}: ${r.game.playerRating}${r.ratingChange !== null ? ` (${signed(r.ratingChange)})` : ''}` }));
}

function RatingCard({ rows, tIdx }: { rows: GameRow[]; tIdx: number | null }) {
  const live = useLiveRatings();
  const pts = ratingPoints(rows);
  const last = pts[pts.length - 1];
  const current = live?.rapid?.rating ?? last?.y ?? null;
  const twentyAgo = pts.length > 20 ? pts[pts.length - 21]!.y : null;
  const shown = pts.slice(-40);
  return (
    <Card id="rating" testid="card-rating" title="Rapid rating" empty={current === null ? 'No rapid rating yet' : undefined}
      value={<strong data-testid="headline-rating">{current}</strong>}
      sub={<>{twentyAgo !== null && last ? `${signed(last.y - twentyAgo)} over 20 games · ` : ''}{pts.length} rated games</>}>
      {shown.length > 1 && <LineChart points={shown} xMin={shown[0]!.x} xMax={shown[shown.length - 1]!.x} format={(y) => String(Math.round(y))} xLabel="games" vline={tIdx !== null ? { x: tIdx, label: 'Training' } : null} title={`Rapid rating after each of the last ${shown.length} rated rapid games, from ${shown[0]!.y} to ${shown[shown.length - 1]!.y}.`} height={104} />}
    </Card>
  );
}

function MistakesCard({ rows, tIdx }: { rows: GameRow[]; tIdx: number | null }) {
  const done = rows.filter((r) => r.analysed);
  const last = done.slice(-20);
  const r = errorRatio(last);
  const roll = rollingErrors(rows, 20);
  return (
    <Card id="mistakes" testid="card-mistakes" title="Big mistakes" provisional={last.length < PROVISIONAL_N} empty={!r ? 'No analysed rapid games yet' : undefined}
      value={r && <><strong>{per100(r.rate)}</strong><span className="pcard-unit">per 100 moves</span></>}
      sub={r && <>{last.length < 20 ? `${last.length} rated rapid` : 'Last 20 rated rapid'} · {r.events} in {r.decisions} moves</>}
      range={r && r.se !== null ? `95% range ${per100(r.lo)}–${per100(r.hi)}` : null}>
      {roll.length > 1 && <LineChart points={roll.map((p) => ({ x: p.index, y: 100 * p.rate }))} band={roll.map((p) => ({ x: p.index, lo: 100 * p.lo, hi: 100 * p.hi }))} xMin={roll[0]!.index} xMax={roll[roll.length - 1]!.index} yMin={0} format={(y) => y.toFixed(1)} xLabel="games" vline={tIdx !== null ? { x: tIdx, label: 'Training' } : null} title="Big mistakes per 100 moves over each run of 20 rated rapid games, with the 95% range as a band." height={104} />}
    </Card>
  );
}

function ChancesCard({ rows }: { rows: GameRow[] }) {
  const list = chanceList(rows.slice(-40));
  const taken = list.filter((c) => c.chance.taken).length;
  const rate = rateOfMarks(list.map((c) => ({ ok: c.chance.taken, ts: 0, uuid: '' })));
  return (
    <Card id="chances" testid="card-chances" title="Chances taken" provisional={list.length < PROVISIONAL_N} empty={list.length === 0 ? 'No clear chances in these games' : undefined}
      value={<><strong>{taken} of {list.length}</strong><span className="pcard-unit">{pctText(rate.rate)}</span></>}
      sub={<>Clear chances · last {Math.min(40, rows.length)} rated rapid</>}
      range={rangeText(rate)}>
      <MarkStrip marks={list.map((c) => ({ ok: c.chance.taken, label: '' }))} title={`${taken} of ${list.length} clear chances taken; filled marks were taken.`} />
    </Card>
  );
}

function HowCard({ rows }: { rows: GameRow[] }) {
  const phases = byPhase(rows.slice(-40));
  const top = phases.filter((p) => p.ratio).sort((a, b) => b.ratio!.rate - a.ratio!.rate)[0];
  return (
    <a className="pcard" href={href('progress/how')} data-testid="card-how">
      <span className="pcard-head"><span className="pcard-title">How you play</span><span className="chev" aria-hidden>›</span></span>
      {top && <span className="pcard-value"><strong className="pcard-mid">Moves {top.label.replace('Moves ', '')}</strong><span className="pcard-unit">most big mistakes</span></span>}
      <BarList max={Math.max(1, ...phases.map((p) => (p.ratio ? 100 * (p.ratio.se !== null ? p.ratio.hi : p.ratio.rate) : 0)))} format={(v) => v.toFixed(1)}
        rows={phases.map((p) => ({ key: p.key, label: p.label, value: p.ratio ? 100 * p.ratio.rate : null, ...(p.ratio && p.ratio.se !== null ? { lo: 100 * p.ratio.lo, hi: 100 * p.ratio.hi } : {}) }))} />
      <span className="pcard-sub">Big mistakes per 100 moves · last {Math.min(40, rows.length)} games · also by type, clock and colour</span>
    </a>
  );
}

export const SENSE_TEXT = {
  'safe-or-not': { id: 'danger', title: 'Spotting danger', there: 'unsafe', not: 'safe', ask: '“Is this move safe?”' },
  'chance-or-not': { id: 'spot-chances', title: 'Spotting chances', there: 'with a chance', not: 'without', ask: '“Anything to win here?”' },
} as const;

function SenseCard({ attempts, kind }: { attempts: Attempt[]; kind: 'safe-or-not' | 'chance-or-not' }) {
  const t = SENSE_TEXT[kind];
  const { spotted, alarms } = senseMarks(attempts, kind);
  const s = rateOfMarks(spotted);
  const f = rateOfMarks(alarms);
  return (
    <Card id={t.id} testid={`card-${t.id}`} title={t.title} provisional={s.n < PROVISIONAL_N || f.n < PROVISIONAL_N}
      empty={s.n + f.n === 0 ? `No ${t.ask} questions answered yet` : undefined}
      value={<><strong>{pctText(s.rate)}</strong><span className="pcard-unit">spotted</span></>}
      sub={<>First looks · {s.n} {t.there}, {f.n} {t.not}</>}>
      <RangeRows rows={[{ label: 'Spotted', rate: s }, { label: 'False alarms', rate: f, bad: true }]} title={`${t.title}: ${s.k} of ${s.n} spotted, ${f.k} false alarms in ${f.n}.`} />
    </Card>
  );
}

export function TrainingChart({ marks, noun, title }: { marks: Mark[]; noun: string; title: string }) {
  if (marks.length >= 40) {
    const b = markBlocks(marks, 20);
    return <BlockChart blocks={b.blocks} pending={b.pending} size={20} noun={noun} title={title} />;
  }
  return <MarkStrip marks={marks.map((m) => ({ ok: m.ok, label: '' }))} title={title} />;
}

function OwnMoveCard({ attempts }: { attempts: Attempt[] }) {
  const { marks, unrated } = ownMoveMarks(attempts);
  const r = rateOfMarks(marks);
  return (
    <Card id="own-move" testid="card-ownmove" title="Your move" provisional={r.n < PROVISIONAL_N}
      empty={r.n === 0 && unrated === 0 ? 'No “Your move” positions played yet.' : undefined}
      value={<><strong>{pctText(r.rate)}</strong><span className="pcard-unit">sound</span></>}
      sub={<>{r.k} of {r.n} first looks{unrated ? ` · ${unrated} not rated` : ''}</>}
      range={r.n ? rangeText(r) : null}>
      <TrainingChart marks={marks} noun="Positions" title={`Your move: ${r.k} of ${r.n} first looks sound.`} />
    </Card>
  );
}

function PuzzlesCard({ attempts }: { attempts: Attempt[] }) {
  const marks = puzzleMarks(attempts);
  const r = rateOfMarks(marks);
  return (
    <Card id="puzzles" testid="card-unseen" title="Fresh puzzles" provisional={r.n < PROVISIONAL_N}
      empty={r.n === 0 ? <span data-testid="insufficient">No unseen puzzles yet.</span> : undefined}
      value={<><strong>{pctText(r.rate)}</strong><span className="pcard-unit">solved</span></>}
      sub={<>{r.k} of {r.n} unseen puzzles</>}
      range={rangeText(r)}>
      <TrainingChart marks={marks} noun="Puzzles" title={`Fresh puzzles: ${r.k} of ${r.n} solved on the first try.`} />
    </Card>
  );
}

export function cellLegend(cells: ReturnType<typeof conceptCells>) {
  const order = ['passed', 'recheck', 'failed', 'studied', 'started', 'new'] as const;
  return order.filter((s) => cells.some((c) => c.state === s)).map((s) => ({ swatch: `cell-sw is-${s}`, text: `${CELL_TEXT[s]} ${cells.filter((c) => c.state === s).length}` }));
}

function ChecksCard({ learner, now }: { learner: Learner; now: number }) {
  const cells = conceptCells(learner.statuses, now);
  const passed = cells.filter((c) => c.state === 'passed' || c.state === 'recheck').length;
  const checked = learner.statuses.filter((s) => s.lastCheck || s.stage === 'demonstrated').length;
  return (
    <Card id="checks" testid="card-coverage" title="Concept checks"
      value={<><strong>{passed}</strong><span className="pcard-unit">passed</span></>}
      sub={<>{checked} of {cells.length} concepts checked · rechecked after 21 days</>}>
      <ConceptGrid cells={cells} title={`Concept checks: ${passed} of ${cells.length} concepts passed.`} />
      <Legend items={cellLegend(cells)} />
    </Card>
  );
}

function ActivityCard({ attempts, now }: { attempts: Attempt[]; now: number }) {
  const days = activityDays(attempts, now, 28);
  const active = days.filter((d) => d.firstLooks + d.other > 0).length;
  const total = days.reduce((t, d) => t + d.firstLooks + d.other, 0);
  const fresh = days.reduce((t, d) => t + d.firstLooks, 0);
  return (
    <Card id="activity" testid="card-activity" title="Practice"
      value={<><strong>{active} of 28</strong><span className="pcard-unit">days</span></>}
      sub={<>{total} positions · {fresh} first looks</>}>
      <DayBars days={days} title={`Positions answered per day over the last 28 days: ${total} in all, on ${active} days.`} />
      <Legend items={[{ swatch: 'bar-sw-a', text: 'First looks' }, { swatch: 'bar-sw-b', text: 'Again' }]} />
    </Card>
  );
}

function attemptsForSet(learner: Learner, set: string): { title: string; uuids: string[] } {
  if (set === 'unseen') return { title: 'Unseen puzzles', uuids: unseenAccuracy(learner.attempts).attemptUuids };
  if (set === 'retention') return { title: 'Scheduled reviews', uuids: retention(learner.attempts).attemptUuids };
  if (set === 'own-move') return { title: 'Your move: first looks', uuids: ownMoveMarks(learner.attempts).marks.map((m) => m.uuid) };
  if (set === 'sense:safe-or-not' || set === 'sense:chance-or-not') {
    const m = senseMarks(learner.attempts, set.slice(6) as 'safe-or-not' | 'chance-or-not');
    return { title: set.endsWith('safe-or-not') ? 'Is this move safe? First looks' : 'Anything to win? First looks', uuids: [...m.spotted, ...m.alarms].map((x) => x.uuid) };
  }
  if (set.startsWith('concept:')) {
    const c = CONCEPT_BY_ID.get(set.slice(8));
    if (c) return { title: `Unseen puzzles: ${c.title}`, uuids: unseenAccuracy(learner.attempts, { themes: c.themes }).attemptUuids };
  }
  return { title: 'Positions', uuids: [] };
}

const OUTCOME_TEXT: Record<Attempt['outcome'], string> = { success: 'solved first try', fail: 'missed', assisted: 'assisted', skipped: 'skipped' };

export function PositionsList({ route, learner }: { route: Route; learner: Learner }) {
  const set = route.query.get('set') ?? 'unseen';
  const { title, uuids } = attemptsForSet(learner, set);
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
  if (a.exerciseKind !== 'puzzle') {
    const what: Record<string, string> = { opening: 'Repertoire move', endgame: 'King and pawn ending', 'own-game': 'Position from your own game', sense: 'Question from your own game', 'own-move': 'Your own move in a position from your game' };
    return (
      <div className="page" data-testid="attempt-other">{back}
        <h1>{what[a.exerciseKind] ?? 'Exercise'}</h1>
        <p>{OUTCOME_TEXT[a.outcome]} on {when}.</p>
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
