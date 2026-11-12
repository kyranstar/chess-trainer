import { useEffect, useRef, useState } from 'react';
import { type Learner, useDueReviews, useNow, usePool } from '../app/store';
import type { Concept } from '../content/types';
import type { ReviewState } from '../db/types';
import { type DrillPosition, drillPositions } from '../games/metrics';
import { type MoveItem, moveItems } from '../games/ownmove';
import { pickSense, type SenseItem } from '../games/sense';
import type { Attempt } from '../db/types';
import { MIX_EXTRA_MINUTES, MIX_MINUTES, type MixKind, nextMixKind, reviewOrder, runSummary } from '../schedule/mix';
import { isTimed, TIMED_SECONDS } from '../schedule/pace';
import { pickTestConcept, puzzleBacked } from '../schedule/session';
import { OwnGameDrill, useGames } from './Games';
import { OwnMoveDrill } from './OwnMove';
import { conceptPicker, PuzzleStream, ReviewRunner } from './runners';
import { SenseDrill, senseItemsFrom } from './Sense';
import { KeepLast } from './Stage';
import { positionOf, seenPositions } from '../schedule/position';

/** How a stretch of practice went, one plain line per kind of item that came up (rows for a `dl`). */
export function RunSummaryRows({ attempts, omit = [] }: { attempts: Attempt[]; omit?: ('puzzles' | 'reviews')[] }) {
  const s = runSummary(attempts);
  const m = s.moves;
  const moves = m.best + m.good + m.inaccuracy + m.mistake + m.blunder + m.unrated;
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  const grades = [part(m.best, 'best', 'best'), part(m.good, 'good', 'good'), part(m.inaccuracy, 'inaccuracy', 'inaccuracies'), part(m.mistake, 'mistake', 'mistakes'), part(m.blunder, 'blunder', 'blunders'), part(m.unrated, 'not rated', 'not rated')].filter(Boolean).join(', ');
  if (s.scored + moves === 0) return null;
  return (
    <>
      <dt>Overall</dt>
      <dd data-testid="run-overall"><strong>{s.passed} of {s.scored}</strong> passed</dd>
      {moves > 0 && (<><dt>Your moves</dt><dd data-testid="run-moves">{grades}</dd></>)}
      {s.questions.n > 0 && (<><dt>Own-game questions</dt><dd>{s.questions.right} of {s.questions.n} right</dd></>)}
      {s.missed.n > 0 && (<><dt>Missed moves</dt><dd>{s.missed.right} of {s.missed.n} found</dd></>)}
      {!omit.includes('puzzles') && s.puzzles.n > 0 && (<><dt>New positions</dt><dd>{s.puzzles.right} of {s.puzzles.n} first try</dd></>)}
      {!omit.includes('reviews') && s.reviews.n > 0 && (<><dt>Due again</dt><dd>{s.reviews.right} of {s.reviews.n} recalled</dd></>)}
    </>
  );
}

export function RunSummaryView({ attempts }: { attempts: Attempt[] }) {
  const s = runSummary(attempts);
  const m = s.moves;
  if (s.scored + m.best + m.good + m.inaccuracy + m.mistake + m.blunder + m.unrated === 0) return <p className="metric-empty" data-testid="run-summary">Nothing answered yet.</p>;
  return <dl className="facts" data-testid="run-summary"><RunSummaryRows attempts={attempts} /></dl>;
}

interface Turn {
  n: number;
  kind: MixKind | null;
  review?: ReviewState;
  sense?: SenseItem;
  drill?: DrillPosition;
  move?: MoveItem;
  pace?: number;
  concept?: Concept;
}

/**
 * One-button practice. The app chooses what comes next (see src/schedule/mix.ts) and does
 * not say what kind of thing it is: every item carries the same heading, so a position has
 * to be looked at for what it is. Each turn's item is chosen once and kept, whatever changes
 * underneath (games being analysed, attempts being recorded).
 */
export function MixRun({ learner, onFinished, looking, onLooked, onCount }: {
  learner: Learner; onFinished: () => void;
  /** The run bar's count was tapped: show the summary so far. */
  looking: boolean; onLooked: () => void;
  /** Tells the run bar how many items are done. */
  onCount: (n: number) => void;
}) {
  const pool = usePool();
  const games = useGames();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const [n, setN] = useState(0);
  const turn = useRef<Turn | null>(null);
  const history = useRef<MixKind[]>([]);
  const shown = useRef(new Set<string>());
  const lastConcept = useRef<string | null>(null);
  const run = useRef(Math.random().toString(36).slice(2));
  // A natural end: after MIX_MINUTES the run stops at the end of an item and offers a few more.
  const until = useRef(Date.now() + MIX_MINUTES * 60_000);
  const [paused, setPaused] = useState(false);
  const startedAt = useRef(Date.now());
  useEffect(() => onCount(n), [n, onCount]);
  if (!pool || !learner.ready || games === undefined) return <p className="muted">Loading</p>;

  if (turn.current?.n !== n) {
    const dueLeft = reviewOrder(due).filter((d) => !shown.current.has(d.itemId));
    const senseSeen = new Set([...learner.attempts.filter((a) => a.exerciseKind === 'sense').map((a) => a.exerciseId), ...shown.current]);
    // A position from his games is one item whichever exercise asks it: one already met in any
    // form is not put in front of him again as something new (see src/schedule/position.ts).
    const met = seenPositions([...learner.attempts, ...[...shown.current].map((exerciseId) => ({ exerciseId }))]);
    const senseAll = senseItemsFrom(games).filter((x) => !met.has(`${x.gameId}:${x.ply}`));
    const safe = pickSense(senseAll, 'safe-or-not', senseSeen, 2, `mix|${run.current}|${n}`)[0];
    const chance = pickSense(senseAll, 'chance-or-not', senseSeen, 2, `mix|${run.current}|${n}`)[0];
    const movesDone = new Set(learner.attempts.filter((a) => a.exerciseKind === 'own-move').map((a) => a.exerciseId));
    const moves = moveItems(games).filter((m) => !movesDone.has(m.id) && !shown.current.has(m.id) && !met.has(`${m.gameId}:${m.ply}`));
    // Newest games first, with some variety inside them.
    const move = moves.length ? moves[Math.max(0, moves.length - 1 - Math.floor(Math.random() * Math.min(12, moves.length)))] : undefined;
    const tried = new Set(learner.attempts.filter((a) => a.exerciseKind === 'own-game').map((a) => a.exerciseId));
    const drill = drillPositions(games).find((d) => !tried.has(d.id) && !shown.current.has(d.id) && !met.has(positionOf(d.id) ?? ''));
    // Half the time a position on what is being learned now (studied, check not yet passed),
    // otherwise on the concept with the least evidence so far; never the same concept twice running.
    const current = learner.statuses.filter((x) => x.stage === 'taught' && puzzleBacked(x) && x.concept.id !== lastConcept.current).sort((a, b) => (b.taughtAt ?? 0) - (a.taughtAt ?? 0))[0];
    const status = (Math.random() < 0.5 ? current : undefined) ?? pickTestConcept(learner.statuses, lastConcept.current);
    const kind = nextMixKind({ review: dueLeft.length > 0, move: !!move, safe: !!safe, chance: !!chance, missed: !!drill, puzzle: !!status }, history.current, Math.random);
    const t: Turn = { n, kind };
    if (kind === 'review') t.review = dueLeft[0];
    if (kind === 'move') {
      t.move = move;
      t.pace = move && isTimed(move.id) ? TIMED_SECONDS : 0;
    }
    if (kind === 'safe') t.sense = safe;
    if (kind === 'chance') t.sense = chance;
    if (kind === 'missed') t.drill = drill;
    if (kind === 'puzzle') t.concept = status!.concept;
    turn.current = t;
    if (kind) history.current.push(kind);
    const id = t.review?.itemId ?? t.move?.id ?? t.sense?.id ?? t.drill?.id;
    if (id) shown.current.add(id);
    if (t.review?.ask) shown.current.add(t.review.ask);
    if (t.concept) lastConcept.current = t.concept.id;
  }
  const t = turn.current;
  const next = () => {
    if (Date.now() >= until.current) setPaused(true);
    setN((x) => x + 1);
  };

  // Everything recorded since this run began, whatever kind of item it was.
  const mine = learner.attempts.filter((a) => a.ts >= startedAt.current && a.sessionId === null);
  // One thing in the run's place at a time: an exercise, or a notice (the tally so far, the
  // pause, nothing left). The exercise before it stays reachable through "Last" in the bar.
  const body = looking && !paused ? (
    <div className="empty" data-testid="mix-look">
      <h2>So far: {n} done</h2>
      <RunSummaryView attempts={mine} />
      <div className="actions">
        <button className="primary" data-testid="mix-resume" onClick={onLooked}>Keep going</button>
        <button data-testid="mix-stop" onClick={onFinished}>Stop here</button>
      </div>
    </div>
  ) : paused ? (
    <div className="empty" data-testid="mix-pause">
      <h2>{n} done</h2>
      <RunSummaryView attempts={mine} />
      <div className="actions">
        <button className="primary" data-testid="mix-stop" onClick={onFinished}>Stop here</button>
        <button data-testid="mix-more" onClick={() => { until.current = Date.now() + MIX_EXTRA_MINUTES * 60_000; setPaused(false); }}>{MIX_EXTRA_MINUTES} more minutes</button>
      </div>
    </div>
  ) : !t.kind ? (
    <div className="empty" data-testid="mix-empty">
      <p>{n === 0 ? 'There is nothing to practise on this device yet. Positions are installed the first time the app is opened with a connection.' : 'That is everything there is to practise right now.'}</p>
      <div className="actions"><button className="primary" onClick={onFinished}>Back</button></div>
    </div>
  ) : t.kind === 'review' ? <ReviewRunner key={`mix-${n}`} due={[t.review!]} sessionId={null} single onFinished={next} />
    : t.kind === 'move' ? <OwnMoveDrill key={`mix-${n}`} item={t.move!} sessionId={null} context="practice" pace={t.pace ?? 0} onDone={next} />
      : t.kind === 'safe' || t.kind === 'chance' ? <SenseDrill key={`mix-${n}`} item={t.sense!} sessionId={null} context="practice" onDone={next} />
        : t.kind === 'missed' ? <OwnGameDrill key={`mix-${n}`} drill={t.drill!} sessionId={null} onDone={next} />
          : (
            <PuzzleStream key={`mix-${n}`} limit={1} pick={conceptPicker(pool.puzzles, t.concept!, learner.level.level, `mix|${run.current}|${n}`)}
              context="practice" conceptId={t.concept!.id} sessionId={null} allowHints={false} seen={learner.seen} onFinished={next} />
          );
  const onTurn = body.key !== null;
  return (
    <div className="fill" data-testid={onTurn ? 'mix-run' : 'mix-notice'} data-turn={n} data-kind={onTurn ? t.kind : ''}>
      <KeepLast>{body}</KeepLast>
    </div>
  );
}
