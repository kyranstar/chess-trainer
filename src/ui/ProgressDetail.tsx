/**
 * Behind each Progress card (ADR-061): the metric over three windows of its own (Recent,
 * Trend, History), the game breakdown, every rated rapid game, and "How you play". Answer,
 * chart, positions, then one or two sentences on what is counted.
 */
import { type ReactNode, useState } from 'react';
import { href } from '../app/router';
import type { Learner } from '../app/store';
import { CLOCK_MIN_DECISIONS } from '../games/metrics';
import {
  activityDays, byClock, byColour, byPhase, byType, chanceList, conceptCells, type ErrorLabel, errorRatio, type GameRow, markBlocks, type Mark, momentsOf, ownMoveMarks, puzzleMarks, rateOf,
  rateOfMarks, rollingErrors, senseMarks, timelineOf,
} from '../progress/series';
import { BarList, BlockChart, CELL_TEXT, ConceptGrid, DayBars, GameSquares, Legend, LineChart, MarkStrip, RangeRows, shortDate } from './charts';
import { useLiveRatings } from './Games';
import { cellLegend, colourWord, earlyView, GameRowLink, markerIn, pctText, per100, rangeText, ratingPoints, RESULT_WORD, SENSE_TEXT, signed, squaresOf, useProgress } from './Progress';
import { ConceptTable, CoverageLine, OwnMoveDetails } from './ProgressMore';

type Frame = 'recent' | 'trend' | 'history';
const FRAMES: { key: Frame; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'trend', label: 'Trend' },
  { key: 'history', label: 'History' },
];
const PROVISIONAL_N = 20;

function Seg<K extends string>({ value, options, onChange, label }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} className={o.key === value ? 'is-on' : ''} aria-pressed={o.key === value} onClick={() => onChange(o.key)} data-testid={`seg-${o.key}`}>{o.label}</button>
      ))}
    </div>
  );
}

function Detail({ testid, title, frame, setFrame, value, sub, range, provisional, children, about, links }: {
  testid: string; title: string; frame?: Frame; setFrame?: (f: Frame) => void; value?: ReactNode; sub?: ReactNode; range?: ReactNode; provisional?: boolean; children?: ReactNode; about: ReactNode; links?: ReactNode;
}) {
  return (
    <div className="page progress" data-testid={testid}>
      <a className="back" href={href('progress')}>Progress</a>
      <h1>{title}</h1>
      {frame && setFrame && <Seg value={frame} options={FRAMES} onChange={setFrame} label="Window" />}
      <div className="pcard is-static">
        {value && <span className="pcard-value">{value}</span>}
        {sub && <span className="pcard-sub">{sub}</span>}
        {(range || provisional) && <span className="pcard-range">{range}{provisional && <span className="tag">Provisional</span>}</span>}
      </div>
      {children}
      {links && <div className="detail-links">{links}</div>}
      <section className="about" data-testid="about">
        <h2>About this measure</h2>
        <p>{about}</p>
      </section>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="metric-empty" data-testid="insufficient">{text}</p>;
}

export function MetricDetail({ id, learner }: { id: string; learner: Learner }) {
  const [frame, setFrame] = useState<Frame>('trend');
  const p = useProgress(learner);
  const f = { frame, setFrame };
  switch (id) {
    case 'early': return <EarlyDetail {...f} rows={p.rows} tIdx={p.tIdx} start={p.start} />;
    case 'rating': return <RatingDetail {...f} rows={p.rows} tIdx={p.tIdx} />;
    case 'mistakes': return <MistakesDetail {...f} rows={p.rows} tIdx={p.tIdx} />;
    case 'chances': return <ChancesDetail {...f} rows={p.rows} />;
    case 'danger': return <SenseDetail {...f} learner={learner} kind="safe-or-not" />;
    case 'spot-chances': return <SenseDetail {...f} learner={learner} kind="chance-or-not" />;
    case 'own-move': return <OwnMoveDetail {...f} learner={learner} />;
    case 'puzzles': return <PuzzlesDetail {...f} learner={learner} />;
    case 'checks': return <ChecksDetail learner={learner} now={p.now} />;
    case 'activity': return <ActivityDetail {...f} learner={learner} now={p.now} />;
    default: return <div className="page"><a className="back" href={href('progress')}>Progress</a><p>Not found.</p></div>;
  }
}

type FrameProps = { frame: Frame; setFrame: (f: Frame) => void };
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

function EarlyDetail({ frame, setFrame, rows, tIdx, start }: FrameProps & { rows: GameRow[]; tIdx: number | null; start: string | null }) {
  const since = start ? rows.filter((r) => r.game.endDate >= start) : [];
  let body: ReactNode;
  let rate = rateOf(0, 0);
  let sub: ReactNode = null;
  if (frame === 'recent') {
    const last = rows.slice(-5);
    rate = rateOfMarks(last.filter((r) => r.early.measured).map((r) => ({ ok: !!r.early.event, ts: 0, uuid: '' })));
    sub = `Last ${last.length} rated rapid games`;
    body = (
      <>
        <GameSquares interactive rows={[{ name: 'Last 5', squares: squaresOf(last), markerAt: markerIn(last, tIdx) }]} marker="Training" title={`Early blunders in the last ${last.length} games: ${rate.k}.`} />
        <div className="pcard is-list">{last.slice().reverse().map((r) => <GameRowLink key={r.game.id} row={r} />)}</div>
      </>
    );
  } else if (frame === 'trend') {
    const v = earlyView(rows);
    rate = v.now;
    sub = <>{rows.length > 20 ? 'Last 20 rated rapid' : `${v.now.n} rated rapid`}{v.prev ? ` · ${v.prev.k} in the 20 before` : ''}</>;
    body = (
      <>
        <GameSquares interactive rows={[...(v.before ? [{ name: '20 before', squares: squaresOf(v.before), markerAt: markerIn(v.before, tIdx) }] : []), { name: 'Last 20', squares: squaresOf(v.last), markerAt: markerIn(v.last, tIdx) }]} marker="Training" title="Early blunders, the last 20 games against the 20 before." />
        {v.prev && <RangeRows rows={[{ label: 'Last 20', rate: v.now, bad: true }, { label: '20 before', rate: v.prev, bad: true }]} title={`Share of games with an early blunder: last 20 ${pctText(v.now.rate)}, the 20 before ${pctText(v.prev.rate)}.`} />}
      </>
    );
  } else {
    rate = rateOfMarks(rows.filter((r) => r.early.measured).map((r) => ({ ok: !!r.early.event, ts: 0, uuid: '' })));
    sub = `All ${rows.length} rated rapid games`;
    body = <GameSquares interactive rows={chunk(rows, 20).map((c) => ({ name: `${c[0]!.index}–${c[c.length - 1]!.index}`, squares: squaresOf(c), markerAt: markerIn(c, tIdx) }))} marker="Training" title={`Early blunders in all ${rows.length} rated rapid games: ${rate.k}.`} />;
  }
  return (
    <Detail testid="detail-early" title="Early blunders" {...{ frame, setFrame }} provisional={rate.n < PROVISIONAL_N}
      value={rate.n ? <><strong>{rate.k} of {rate.n}</strong><span className="pcard-unit">games</span></> : undefined} sub={sub} range={rate.n ? rangeText(rate) : null}
      about="Games in which one of your first 20 moves lost material or allowed mate in a short line that the best move avoided. Rated rapid games, each measured on this phone with one fixed engine setting, so the numbers stay comparable."
      links={<>
        <a href={href('progress/game-events', { kind: 'early' })} data-testid="view-early">View the positions</a>
        {start && <p className="muted small" data-testid="since-training">{since.length} rated rapid game{since.length === 1 ? '' : 's'} since training began ({shortDate(start)}){since.length < PROVISIONAL_N ? ': too few to compare with before.' : '.'}</p>}
      </>}>
      {rows.length === 0 ? <Empty text="No rated rapid games yet." /> : body}
    </Detail>
  );
}

function RatingDetail({ frame, setFrame, rows, tIdx }: FrameProps & { rows: GameRow[]; tIdx: number | null }) {
  const live = useLiveRatings();
  const all = ratingPoints(rows);
  const pts = frame === 'recent' ? all.slice(-10) : frame === 'trend' ? all.slice(-20) : all;
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <Detail testid="detail-rating" title="Rapid rating" {...{ frame, setFrame }}
      value={last ? <strong>{live?.rapid?.rating ?? last.y}</strong> : undefined}
      sub={first && last ? `${signed(last.y - first.y)} over the last ${pts.length} games${live?.rapid ? ` · Chess.com now ${live.rapid.rating}` : ''}` : null}
      about="Your Chess.com rapid rating after each rated rapid game. Ratings move with opponents and luck as well as skill, so a few games show little. Never combined with blitz, daily or puzzle ratings."
      links={<a href={href('progress/more/games')}>Blitz, daily and all time controls</a>}>
      {pts.length > 1 ? <LineChart interactive points={pts} xMin={first!.x} xMax={last!.x} format={(y) => String(Math.round(y))} xLabel="games" vline={tIdx !== null ? { x: tIdx, label: 'Training' } : null} title={`Rapid rating over the last ${pts.length} rated games, from ${first!.y} to ${last!.y}.`} height={150} /> : <Empty text="Not enough rated rapid games for a line yet." />}
    </Detail>
  );
}

function MistakesDetail({ frame, setFrame, rows, tIdx }: FrameProps & { rows: GameRow[]; tIdx: number | null }) {
  const done = rows.filter((r) => r.analysed && r.decisions > 0);
  const sel = frame === 'recent' ? done.slice(-5) : frame === 'trend' ? done.slice(-20) : done;
  const r = errorRatio(sel);
  const roll = rollingErrors(rows, 20);
  const dots = sel.map((x) => ({ x: x.index, y: (100 * x.errors) / x.decisions, label: `Game ${x.index}, ${shortDate(x.game.endDate)}: ${x.errors} in ${x.decisions} moves` }));
  const shownRoll = frame === 'history' ? roll : frame === 'trend' ? roll.slice(-20) : [];
  return (
    <Detail testid="detail-mistakes" title="Big mistakes" {...{ frame, setFrame }} provisional={sel.length < PROVISIONAL_N}
      value={r ? <><strong>{per100(r.rate)}</strong><span className="pcard-unit">per 100 moves</span></> : undefined}
      sub={r ? `${frame === 'history' ? 'All' : 'Last'} ${sel.length} rated rapid · ${r.events} in ${r.decisions} moves` : null}
      range={r && r.se !== null ? `95% range ${per100(r.lo)}–${per100(r.hi)}` : null}
      about="A big mistake is a move that lowered the engine’s expected score by 20 points or more. Counted per 100 of your moves in rated rapid games. The line is the rate over each run of 20 games; the band around it is its 95% range. The dots are single games."
      links={<><a href={href('progress/game-events', { kind: 'rapid-errors' })} data-testid="view-errors">View the positions</a><a href={href('progress/how')}>By move, type, clock and colour</a></>}>
      {sel.length === 0 ? <Empty text="No analysed rated rapid games yet." /> : frame !== 'recent' && shownRoll.length > 1 ? (
        <LineChart interactive points={shownRoll.map((p) => ({ x: p.index, y: 100 * p.rate, label: `Games ${p.index - 19}–${p.index}: ${per100(p.rate)} per 100 moves (95% range ${per100(p.lo)}–${per100(p.hi)})` }))} band={shownRoll.map((p) => ({ x: p.index, lo: 100 * p.lo, hi: 100 * p.hi }))} dots={frame === 'history' ? dots : []}
          xMin={frame === 'history' ? done[0]!.index : shownRoll[0]!.index} xMax={done[done.length - 1]!.index} yMin={0} yMax={frame === 'history' ? undefined : Math.max(...shownRoll.map((p) => 100 * p.hi)) * 1.1} format={(y) => y.toFixed(1)} xLabel="games" vline={tIdx !== null ? { x: tIdx, label: 'Training' } : null} title="Big mistakes per 100 moves over each run of 20 games." height={160} />
      ) : (
        <LineChart interactive points={[]} dots={dots} xMin={dots[0]!.x} xMax={dots[dots.length - 1]!.x} yMin={0} format={(y) => y.toFixed(0)} xLabel="games" title="Big mistakes per 100 moves in each of these games." height={140} />
      )}
    </Detail>
  );
}

function ChancesDetail({ frame, setFrame, rows }: FrameProps & { rows: GameRow[] }) {
  const sel = frame === 'recent' ? rows.slice(-5) : frame === 'trend' ? rows.slice(-40) : rows;
  const list = chanceList(sel);
  const rate = rateOfMarks(list.map((c) => ({ ok: c.chance.taken, ts: 0, uuid: '' })));
  return (
    <Detail testid="detail-chances" title="Chances taken" {...{ frame, setFrame }} provisional={rate.n < PROVISIONAL_N}
      value={rate.n ? <><strong>{rate.k} of {rate.n}</strong><span className="pcard-unit">{pctText(rate.rate)}</span></> : undefined}
      sub={`Clear chances in the ${frame === 'history' ? '' : 'last '}${sel.length} rated rapid games`} range={rate.n ? rangeText(rate) : null}
      about="A clear chance is a position where one move wins material or mates and beats every other move by 20 points or more. A chance that stays on the board for several moves counts once, and is missed only if it was never taken."
      links={<a href={href('progress/game-events', { kind: 'rapid-chances' })} data-testid="view-missed">View the missed ones</a>}>
      {list.length === 0 ? <Empty text="No clear chances in these games." /> : (
        <>
          <MarkStrip labels marks={list.map((c) => ({ ok: c.chance.taken, label: `Game ${c.row.index}, move ${Math.floor(c.chance.ply / 2) + 1}: ${c.chance.taken ? 'taken' : 'missed'}` }))} title={`${rate.k} of ${rate.n} clear chances taken.`} />
          <Legend items={[{ swatch: 'pt-sw is-on', text: 'Taken' }, { swatch: 'pt-sw', text: 'Missed' }]} />
        </>
      )}
    </Detail>
  );
}

function SenseDetail({ frame, setFrame, learner, kind }: FrameProps & { learner: Learner; kind: 'safe-or-not' | 'chance-or-not' }) {
  const t = SENSE_TEXT[kind];
  const all = senseMarks(learner.attempts, kind);
  const take = (m: Mark[]) => (frame === 'recent' ? m.slice(-10) : frame === 'trend' ? m.slice(-20) : m);
  const spotted = take(all.spotted);
  const alarms = take(all.alarms);
  const s = rateOfMarks(spotted);
  const f = rateOfMarks(alarms);
  const label = (m: Mark, there: boolean) => `${new Date(m.ts).toLocaleDateString()}: ${there ? (m.ok ? 'spotted' : 'missed') : m.ok ? 'false alarm' : 'rightly left alone'}`;
  return (
    <Detail testid={`detail-${t.id}`} title={t.title} {...{ frame, setFrame }} provisional={s.n < PROVISIONAL_N || f.n < PROVISIONAL_N}
      value={s.n ? <><strong>{pctText(s.rate)}</strong><span className="pcard-unit">spotted</span></> : undefined}
      sub={`First looks · ${s.n} ${t.there}, ${f.n} ${t.not}`}
      about={<>{t.ask} answered the first time you saw the position. Spotted: of the positions where something was there, how many you said so. False alarms: of those where nothing was there, how many you said something was. Both matter: saying yes to everything would spot every one.</>}
      links={<a href={href('progress/positions', { set: `sense:${kind}` })}>View the positions</a>}>
      {s.n + f.n === 0 ? <Empty text="None answered yet." /> : (
        <>
          <RangeRows rows={[{ label: 'Spotted', rate: s }, { label: 'False alarms', rate: f, bad: true }]} title={`${s.k} of ${s.n} spotted, ${f.k} false alarms in ${f.n}.`} />
          <h2 className="detail-h">Positions {t.there}</h2>
          <MarkStrip labels marks={spotted.map((m) => ({ ok: m.ok, label: label(m, true) }))} title="Filled: spotted." />
          <h2 className="detail-h">Positions {t.not}</h2>
          <MarkStrip labels marks={alarms.map((m) => ({ ok: m.ok, label: label(m, false) }))} title="Filled: a false alarm." />
          <Legend items={[{ swatch: 'pt-sw is-on', text: 'You said something was there' }, { swatch: 'pt-sw', text: 'You said nothing was' }]} />
        </>
      )}
    </Detail>
  );
}

function FirstLookChart({ frame, marks, noun, title }: { frame: Frame; marks: Mark[]; noun: string; title: string }) {
  const label = (m: Mark) => `${new Date(m.ts).toLocaleDateString()}: ${m.ok ? 'yes' : 'no'}`;
  if (frame === 'recent' || marks.length < 20) return <MarkStrip labels marks={marks.slice(frame === 'recent' ? -20 : 0).map((m) => ({ ok: m.ok, label: label(m) }))} title={title} />;
  const b = markBlocks(marks, 20);
  return (
    <>
      <BlockChart interactive blocks={b.blocks} pending={b.pending} size={20} noun={noun} title={title} />
      {frame === 'history' && <MarkStrip labels marks={marks.map((m) => ({ ok: m.ok, label: label(m) }))} title={`All ${marks.length}, oldest first.`} />}
    </>
  );
}

function OwnMoveDetail({ frame, setFrame, learner }: FrameProps & { learner: Learner }) {
  const { marks } = ownMoveMarks(learner.attempts);
  const sel = frame === 'recent' ? marks.slice(-20) : marks;
  const r = rateOfMarks(sel);
  return (
    <Detail testid="detail-own-move" title="Your move" {...{ frame, setFrame }} provisional={r.n < PROVISIONAL_N}
      value={r.n ? <><strong>{pctText(r.rate)}</strong><span className="pcard-unit">sound</span></> : undefined}
      sub={r.n ? `${r.k} of ${frame === 'recent' ? `the last ${r.n}` : r.n} first looks` : null} range={r.n ? rangeText(r) : null}
      about="A position from moves 10 to 19 of one of your own games, the first time you see it. Sound: the engine rated your move best, good or an inaccuracy. Each point on the chart is 20 positions in a row; they are not joined because each is its own sample."
      links={<a href={href('progress/positions', { set: 'own-move' })}>View the positions</a>}>
      {r.n === 0 ? <Empty text="No “Your move” positions played yet." /> : <FirstLookChart frame={frame} marks={marks} noun="Positions" title={`Your move: ${r.k} of ${r.n} sound.`} />}
      <OwnMoveDetails attempts={learner.attempts} />
    </Detail>
  );
}

function PuzzlesDetail({ frame, setFrame, learner }: FrameProps & { learner: Learner }) {
  const marks = puzzleMarks(learner.attempts);
  const sel = frame === 'recent' ? marks.slice(-20) : marks;
  const r = rateOfMarks(sel);
  return (
    <Detail testid="detail-puzzles" title="Fresh puzzles" {...{ frame, setFrame }} provisional={r.n < PROVISIONAL_N}
      value={r.n ? <><strong>{pctText(r.rate)}</strong><span className="pcard-unit">solved</span></> : undefined}
      sub={r.n ? `${r.k} of ${r.n} unseen puzzles` : null} range={r.n ? rangeText(r) : null}
      about="Puzzles solved the first time they were ever shown, with no wrong move and no hint. Repeats and reviews are left out: a puzzle you have seen before says more about memory."
      links={<a href={href('progress/positions', { set: 'unseen' })} data-testid="view-unseen">View the {marks.length} puzzles</a>}>
      {r.n === 0 ? <Empty text="No unseen puzzles yet." /> : <FirstLookChart frame={frame} marks={marks} noun="Puzzles" title={`Fresh puzzles: ${r.k} of ${r.n} solved.`} />}
      <ConceptTable learner={learner} />
    </Detail>
  );
}

function ChecksDetail({ learner, now }: { learner: Learner; now: number }) {
  const cells = conceptCells(learner.statuses, now);
  const passed = cells.filter((c) => c.state === 'passed' || c.state === 'recheck').length;
  const byId = new Map(learner.statuses.map((s) => [s.concept.id, s]));
  return (
    <Detail testid="detail-checks" title="Concept checks"
      value={<><strong>{passed}</strong><span className="pcard-unit">passed</span></>}
      sub={`of ${cells.length} concepts · a passed check is asked again after 21 days`}
      about="A check is five positions you have not seen, given on a later day than the lesson, with no hints; four right passes it. Passing once is evidence, not mastery, so it is asked again after 21 days. A struck-through cell has no check of its own yet."
      links={<a href={href('learn')}>Open the curriculum</a>}>
      <ConceptGrid cells={cells} title={`Concept checks: ${passed} of ${cells.length} passed.`} />
      <Legend items={cellLegend(cells)} />
      <CoverageLine learner={learner} />
      <ul className="rowlist">
        {cells.map((c) => {
          const s = byId.get(c.id)!;
          return (
            <li key={c.id}>
              <a href={href(`learn/${c.id}`)}>
                <span className={`cell-sw is-${c.state}`} aria-hidden />
                <span className="rowlist-main">{c.title}<span className="muted small">{CELL_TEXT[c.state]}{s.lastCheck?.correct != null ? ` · last check ${s.lastCheck.correct} of ${s.lastCheck.total}` : ''}{c.checkable ? '' : ' · no check yet'}</span></span>
                <span className="chev" aria-hidden>›</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Detail>
  );
}

function ActivityDetail({ frame, setFrame, learner, now }: FrameProps & { learner: Learner; now: number }) {
  const all = activityDays(learner.attempts, now, 120);
  const firstTracked = all.findIndex((d) => d.tracked);
  const days = frame === 'recent' ? all.slice(-7) : frame === 'trend' ? all.slice(-28) : all.slice(firstTracked >= 0 ? Math.max(0, firstTracked - 1) : -28);
  const active = days.filter((d) => d.firstLooks + d.other > 0).length;
  const total = days.reduce((t, d) => t + d.firstLooks + d.other, 0);
  const fresh = days.reduce((t, d) => t + d.firstLooks, 0);
  return (
    <Detail testid="detail-activity" title="Practice" {...{ frame, setFrame }}
      value={<><strong>{active} of {days.length}</strong><span className="pcard-unit">days</span></>}
      sub={`${total} positions · ${fresh} first looks`}
      about="Positions answered each day, counted when an answer was given; skipped ones are not counted. Minutes are not shown: a position left open on the screen would count as practice. Days before your first answer here are drawn flat: they were not recorded, not empty.">
      <DayBars interactive days={days} title={`Positions answered per day: ${total} on ${active} of ${days.length} days.`} />
      <Legend items={[{ swatch: 'bar-sw-a', text: 'First looks' }, { swatch: 'bar-sw-b', text: 'Again (reviews and repeats)' }]} />
    </Detail>
  );
}

const MOMENT_TEXT = { early: 'Early blunder', biggest: 'Biggest mistake', chance: 'Missed chance', clock: 'Short of time' } as const;

export function GameBreakdown({ gameId, learner }: { gameId: string; learner: Learner }) {
  const { rows, games } = useProgress(learner);
  if (!games) return <div className="page"><p className="muted">Loading</p></div>;
  const row = rows.find((r) => r.game.id === gameId);
  if (!row) return <div className="page"><a className="back" href={href('progress')}>Progress</a><p>This game is not among your rated rapid games.</p></div>;
  const g = row.game;
  const moments = momentsOf(row).sort((a, b) => a.ply - b.ply);
  const line = timelineOf(g);
  const eventAt = (ply: number) => g.analysis?.events.find((e) => e.ply === ply) ?? g.measure?.events.find((e) => e.ply === ply);
  const taken = row.chances.filter((c) => c.taken).length;
  return (
    <div className="page progress" data-testid="game-breakdown">
      <a className="back" href={href('progress')}>Progress</a>
      <p className="kicker">{shortDate(g.endDate)} · {g.timeControl.replace(/^(\d+)/, (s) => `${Math.round(Number(s) / 60)} min`)} · vs {g.opponent}{g.opponentRating ? ` (${g.opponentRating})` : ''}</p>
      <h1>{g.result ? RESULT_WORD[g.result] : 'No result'} as {colourWord(g.color)}</h1>
      <div className="stat-row">
        <div className="stat"><span className="stat-v">{g.playerRating ?? '–'}{row.ratingChange !== null && <span className={row.ratingChange >= 0 ? 'delta' : 'delta is-down'}>{signed(row.ratingChange)}</span>}</span><span className="stat-l">Rating after</span></div>
        <div className="stat"><span className="stat-v">{row.analysed ? row.errors : '–'}</span><span className="stat-l">Big mistakes{row.analysed ? ` in ${row.decisions} moves` : ''}</span></div>
        <div className="stat"><span className="stat-v">{row.chances.length ? `${taken}/${row.chances.length}` : '–'}</span><span className="stat-l">Chances taken</span></div>
      </div>
      {line.length > 1 && (
        <section className="pcard is-static">
          <span className="pcard-title">How the game went</span>
          <LineChart interactive points={line.map((p) => ({ x: p.move, y: p.wp, label: `Move ${p.move}: ${Math.round(p.wp)}% before your move` }))} markers={moments.map((m) => ({ x: m.move, y: line.find((p) => p.ply === m.ply)?.wp ?? 50, bad: true, label: m.label }))}
            xMin={line[0]!.move} xMax={line[line.length - 1]!.move} yMin={0} yMax={100} format={(y) => `${Math.round(y)}%`} xLabel="move" title="Your expected score before each of your moves; marks at the moments below." height={140} />
          <span className="pcard-sub">Your chances with best play before each of your moves, from this phone’s engine</span>
        </section>
      )}
      <h2 className="detail-h">Moments</h2>
      {moments.length === 0 ? (
        <p className="muted" data-testid="no-moments">{row.analysed ? 'No big mistake, early blunder or missed chance was found at this engine setting.' : 'This game has not been analysed yet.'}</p>
      ) : (
        <ul className="rowlist" data-testid="moments">
          {moments.map((m) => {
            const e = eventAt(m.ply);
            return (
              <li key={m.ply}>
                <a href={href(`progress/game-event/${g.id}/${m.ply}`)} data-testid="moment">
                  <span className="moment-mark" aria-hidden>{m.move}</span>
                  <span className="rowlist-main">{MOMENT_TEXT[m.kind]}<span className="muted small">Move {m.move}{e ? `: you played ${e.playedSan}` : ''}</span></span>
                  <span className="chev" aria-hidden>›</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {g.url && <a href={g.url} target="_blank" rel="noreferrer">Open the game on Chess.com</a>}
    </div>
  );
}

export function GamesList({ learner }: { learner: Learner }) {
  const { rows } = useProgress(learner);
  return (
    <div className="page progress" data-testid="games-list">
      <a className="back" href={href('progress')}>Progress</a>
      <h1>Rated rapid games</h1>
      <div className="pcard is-list">{rows.slice().reverse().map((r) => <GameRowLink key={r.game.id} row={r} />)}</div>
    </div>
  );
}

type How = 'phase' | 'type' | 'clock' | 'colour';
const TYPE_TEXT: Record<ErrorLabel, string> = { 'loses-material': 'Lost material', 'allows-mate': 'Allowed mate', 'misses-material': 'Missed material', unclassified: 'Other' };

export function HowYouPlay({ learner }: { learner: Learner }) {
  const { rows } = useProgress(learner);
  const [view, setView] = useState<How>('phase');
  const [span, setSpan] = useState<'trend' | 'history'>('trend');
  const sel = span === 'trend' ? rows.slice(-40) : rows;
  const scope = `${span === 'trend' ? 'Last' : 'All'} ${sel.length} rated rapid games`;
  let body: ReactNode;
  const hiOf = (r: { rate: number; lo: number; hi: number; se: number | null } | null) => (r ? 100 * (r.se !== null ? r.hi : r.rate) : 0);
  const rng = (r: { lo: number; hi: number; se: number | null } | null) => (r && r.se !== null ? { lo: 100 * r.lo, hi: 100 * r.hi } : {});
  if (view === 'phase') {
    const phases = byPhase(sel);
    body = (
      <>
        <p className="pcard-sub">Big mistakes per 100 moves · the thin line is the 95% range</p>
        <BarList testid="how-rows" max={Math.max(1, ...phases.map((p) => hiOf(p.ratio)))} format={(v) => v.toFixed(1)}
          rows={phases.map((p) => ({ key: p.key, label: p.label, meta: p.ratio ? `${p.ratio.events} in ${p.ratio.decisions} moves` : 'no moves', value: p.ratio ? 100 * p.ratio.rate : null, ...rng(p.ratio), href: href('progress/game-events', { kind: `phase:${p.key}`, span }) }))} />
      </>
    );
  } else if (view === 'type') {
    const types = byType(sel);
    body = (
      <>
        <p className="pcard-sub">Big mistakes, by what the move did</p>
        <BarList testid="how-rows" max={Math.max(1, ...types.map((t) => t.count))} format={(v) => String(v)}
          rows={types.map((t) => ({ key: t.label, label: TYPE_TEXT[t.label], meta: `in ${t.games} game${t.games === 1 ? '' : 's'}`, value: t.count, href: href('progress/game-events', { kind: `label:${t.label}`, span }) }))} />
        <p className="muted small">Lost material or allowed mate: a short line after your move shows it. Missed material: your move let a win of material go. Other: the engine’s number fell by 20 points or more with no short line that shows why.</p>
      </>
    );
  } else if (view === 'clock') {
    const c = byClock(sel);
    const r = (b: { decisions: number; errors: number }) => (b.decisions ? (100 * b.errors) / b.decisions : null);
    body = (
      <>
        <p className="pcard-sub">Big mistakes per 100 moves</p>
        <BarList testid="how-rows" max={Math.max(1, r(c.low) ?? 0, r(c.normal) ?? 0)} format={(v) => v.toFixed(1)}
          rows={[{ key: 'low', label: 'Under 10% of your time left', meta: `${c.low.errors} in ${c.low.decisions} moves`, value: r(c.low), bad: true }, { key: 'normal', label: 'More time left', meta: `${c.normal.errors} in ${c.normal.decisions} moves`, value: r(c.normal) }]} />
        <p className="pcard-sub" data-testid={c.enough ? 'clock-compare' : 'clock-insufficient'}>{c.enough ? 'Enough moves in both groups to set them side by side.' : `Too few to compare yet: at least ${CLOCK_MIN_DECISIONS} moves are needed in each group.`}</p>
        <p className="muted small">The time on your clock when the move was begun. Only positions still undecided are counted (expected score between 10 and 90): most moves made with little time come in games already won or lost.{c.noClock ? ` ${c.noClock} game${c.noClock === 1 ? ' has' : 's have'} no clock record.` : ''}{c.unmeasured ? ` ${c.unmeasured} ${c.unmeasured === 1 ? 'is' : 'are'} waiting to be measured.` : ''}</p>
      </>
    );
  } else {
    const c = byColour(sel);
    const both = ['white', 'black'] as const;
    body = (
      <>
        <p className="pcard-sub">Big mistakes per 100 moves</p>
        <BarList testid="how-rows" max={Math.max(1, ...both.map((k) => hiOf(c[k].ratio)))} format={(v) => v.toFixed(1)}
          rows={both.map((k) => ({ key: k, label: `As ${colourWord(k)}`, meta: `${c[k].games} games`, value: c[k].ratio ? 100 * c[k].ratio!.rate : null, ...rng(c[k].ratio) }))} />
        <p className="pcard-sub">Games with an early blunder</p>
        <RangeRows rows={both.map((k) => ({ label: `As ${colourWord(k)}`, rate: c[k].early, bad: true }))} title="Share of games with an early blunder, as White and as Black." />
      </>
    );
  }
  return (
    <div className="page progress" data-testid="how-you-play">
      <a className="back" href={href('progress')}>Progress</a>
      <h1>How you play</h1>
      <Seg value={view} options={[{ key: 'phase', label: 'Move' }, { key: 'type', label: 'Type' }, { key: 'clock', label: 'Clock' }, { key: 'colour', label: 'Colour' }]} onChange={setView} label="Breakdown" />
      <Seg value={span} options={[{ key: 'trend', label: 'Last 40 games' }, { key: 'history', label: 'All games' }]} onChange={setSpan} label="Games" />
      <div className="pcard is-static">
        <span className="pcard-title">{scope}</span>
        {rows.length === 0 ? <Empty text="No rated rapid games yet." /> : body}
      </div>
      <p className="muted small">What happened in your games, counted. It does not say why a move was played, and a difference between two small groups can be chance.</p>
    </div>
  );
}
