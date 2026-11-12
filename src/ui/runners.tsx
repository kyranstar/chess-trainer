import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { CONCEPT_BY_ID, conceptOpenings, conceptThemes, LESSON_BY_ID } from '../content';
import type { Concept } from '../content/types';
import { recordLessonEvent } from '../db/db';
import type { Attempt, AttemptContext, ReviewState } from '../db/types';
import { CHECK, gradeCheck, KPK_CHECK } from '../learn/curriculum';
import { selectPuzzles } from '../puzzles/select';
import type { Puzzle } from '../puzzles/types';
import { type Learner, useDb, usePool } from '../app/store';
import { type DrillPosition, drillPositions } from '../games/metrics';
import { reviewOrder } from '../schedule/mix';
import { type MoveItem, moveItems } from '../games/ownmove';
import type { SenseItem } from '../games/sense';
import { drillId } from '../openings/repertoire';
import { OwnGameDrill, useGames } from './Games';
import { OwnMoveDrill } from './OwnMove';
import { KpkDrill, type KpkGoal, kpkCheckSet } from './Kpk';
import { LessonTry } from './LessonPlayer';
import { OpeningDrill, useOpeningBook, useOpeningPrefs, useRepertoire } from './Openings';
import { SenseDrill, senseItemById } from './Sense';
import { PuzzlePlayer } from './PuzzlePlayer';
import { Ask, KeepLast, useRunNote } from './Stage';

export type Picker = (exclude: Set<string>, index: number) => Puzzle | null;

/** Runs puzzles one after another, asking `pick` for each next one. */
export function PuzzleStream(props: {
  pick: Picker;
  context: AttemptContext;
  conceptId: string | null | ((p: Puzzle) => string | null);
  sessionId: string | null;
  allowHints: boolean;
  /** What the positions are about, when that is meant to be known (the concept being practised). */
  heading?: string;
  /** A count for the run bar, given the number of positions finished so far. */
  note?: (done: number) => string;
  seen: Set<string>;
  /** Stop offering more (time is up); the current position can still be finished. */
  stop?: boolean;
  limit?: number;
  onAttempt?: (a: Attempt) => void;
  onFinished: (reason: 'limit' | 'stopped' | 'exhausted') => void;
  nextLabel?: string;
}) {
  const pool = usePool();
  const shown = useRef(new Set<string>());
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState<Puzzle | null | undefined>(undefined);
  const propsRef = useRef(props);
  propsRef.current = props;
  useRunNote(props.note && current ? props.note(count) : null);

  function next(n: number) {
    const p = propsRef.current;
    if (p.limit !== undefined && n >= p.limit) return p.onFinished('limit');
    if (p.stop && n > 0) return p.onFinished('stopped');
    const exclude = new Set([...p.seen, ...shown.current]);
    const puzzle = p.pick(exclude, n);
    if (!puzzle) {
      setCurrent(null);
      return;
    }
    shown.current.add(puzzle.id);
    setCurrent(puzzle);
  }

  useEffect(() => {
    if (pool && current === undefined) next(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool]);

  if (!pool || current === undefined) return <p className="muted">Loading positions</p>;
  if (current === null) {
    return (
      <KeepLast>
        <div className="empty" data-testid="stream-empty">
          <p>No unseen positions are left for this selection in the installed pack.</p>
          <div className="actions"><button className="primary" onClick={() => props.onFinished('exhausted')}>Continue</button></div>
        </div>
      </KeepLast>
    );
  }
  const conceptId = typeof props.conceptId === 'function' ? props.conceptId(current) : props.conceptId;
  return (
    <KeepLast>
    <PuzzlePlayer
      key={current.id}
      puzzle={current}
      context={props.context}
      conceptId={conceptId}
      sessionId={props.sessionId}
      packVersion={pool.version}
      allowHints={props.allowHints}
      heading={props.heading}
      onRecorded={props.onAttempt}
      nextLabel={props.nextLabel}
      onNext={() => {
        const n = count + 1;
        setCount(n);
        next(n);
      }}
    />
    </KeepLast>
  );
}

/** Picker for unseen puzzles of one concept near a target rating. */
export function conceptPicker(pool: Puzzle[], concept: Concept, target: number, seed: string): Picker {
  // No filter would mean "any puzzle": a concept without puzzle tags has nothing to pick.
  if (conceptThemes(concept).length === 0 && conceptOpenings(concept).length === 0) return () => null;
  return (exclude, i) =>
    selectPuzzles(pool, { themes: conceptThemes(concept), openings: conceptOpenings(concept), target, count: 1, exclude, seed: `${seed}|${i}` })[0] ?? null;
}

/** The check for concepts assessed by exact endgame play-outs. */
function KpkCheckRunner({ concept, learner, sessionId, onDone }: { concept: Concept; learner: Learner; sessionId: string | null; onDone: (passed: boolean | null) => void }) {
  const db = useDb();
  const attempts = useRef<Attempt[]>([]);
  const [i, setI] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof gradeCheck> | null>(null);
  useRunNote(result ? null : `Check ${Math.min(i + 1, KPK_CHECK.size)} of ${KPK_CHECK.size}`);
  const set = useMemo(
    () => kpkCheckSet(new Set(learner.attempts.filter((a) => a.exerciseKind === 'endgame').map((a) => a.exerciseId)), KPK_CHECK.size),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [concept.id],
  );
  if (set.length < KPK_CHECK.size) {
    return (
      <div className="empty" data-testid="check-unavailable">
        <h2>Check not available</h2>
        <p>A fair check needs {KPK_CHECK.size} endgame starts you have never seen; only {set.length} are left.</p>
        <div className="actions"><button className="primary" onClick={() => onDone(null)}>Back</button></div>
      </div>
    );
  }
  if (result) {
    return (
      <div className="check-result" data-testid="check-result" data-passed={result.passed}>
        <p className="kicker">Check: {concept.title}</p>
        <h2>{result.passed ? 'Passed' : 'Not passed yet'}: {result.correct} of {result.total} played out correctly</h2>
        <p>{result.passed ? 'This concept now counts as demonstrated.' : `It needs ${KPK_CHECK.pass} of ${KPK_CHECK.size}. You can retake it with new starts.`}</p>
        <div className="actions dock"><button className="primary" data-testid="check-done" onClick={() => onDone(result.passed)}>Continue</button></div>
      </div>
    );
  }
  const item = set[i]!;
  return (
    <KpkDrill
      key={`${item.goal}:${item.start}`} start={item.start} goal={item.goal} sessionId={sessionId} context="check" allowShow={false}
      onRecorded={(a) => attempts.current.push(a)}
      onDone={() => {
        if (i + 1 < KPK_CHECK.size) return setI(i + 1);
        const decided = attempts.current;
        const correct = decided.filter((a) => a.outcome === 'success').length;
        const g = { complete: true, passed: correct >= KPK_CHECK.pass, correct, total: decided.length };
        void recordLessonEvent(db, {
          conceptId: concept.id, lessonId: null, url: null, type: g.passed ? 'check-passed' : 'check-failed', ts: Date.now(),
          detail: { correct: g.correct, total: g.total, attemptUuids: decided.map((a) => a.uuid), rubric: KPK_CHECK.rubric },
        }).then(() => setResult(g));
      }}
    />
  );
}

/** A check interrupted (by a reload) within this time is resumed with the answers already given. */
const CHECK_RESUME_MS = 2 * 3_600_000;

/** The independent check: a fixed-size set of unseen puzzles in a fixed rating band, no hints. */
export function CheckRunner(props: { concept: Concept; learner: Learner; sessionId: string | null; onDone: (passed: boolean | null) => void }) {
  return props.concept.assessment.kind === 'kpk-playout' ? <KpkCheckRunner {...props} /> : <PuzzleCheckRunner {...props} />;
}

function PuzzleCheckRunner({ concept, learner, sessionId, onDone }: { concept: Concept; learner: Learner; sessionId: string | null; onDone: (passed: boolean | null) => void }) {
  const db = useDb();
  const pool = usePool();
  const attempts = useRef<Attempt[]>([]);
  const [result, setResult] = useState<ReturnType<typeof gradeCheck> | null>(null);
  const priorChecks = learner.events.filter((e) => e.conceptId === concept.id && (e.type === 'check-passed' || e.type === 'check-failed')).length;
  // Drawn once and kept: answering a position adds it to "seen", and drawing again would
  // change the set (or run out of positions) in the middle of the check.
  const drawn = useRef<Puzzle[] | null>(null);
  // Answers already given in this check count. The page can be reloaded in the middle (iOS
  // does it when the app has been in the background): starting again from nothing let a
  // check with a miss in it be passed on five fresh positions.
  const carried = useRef<Attempt[] | null>(null);
  if (carried.current === null) {
    const lastGraded = learner.events.filter((e) => e.conceptId === concept.id && (e.type === 'check-passed' || e.type === 'check-failed')).reduce((t, e) => Math.max(t, e.ts), 0);
    const since = Math.max(lastGraded, Date.now() - CHECK_RESUME_MS);
    carried.current = learner.attempts
      .filter((a) => a.context === 'check' && a.conceptId === concept.id && a.exerciseKind === 'puzzle' && a.outcome !== 'skipped' && a.ts > since)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, CHECK.size);
    attempts.current = [...carried.current];
  }
  const remaining = CHECK.size - carried.current.length;
  if (pool && drawn.current === null) {
    drawn.current = selectPuzzles(pool.puzzles, {
      themes: conceptThemes(concept), openings: conceptOpenings(concept), band: CHECK.band, target: (CHECK.band.lo + CHECK.band.hi) / 2,
      count: remaining, exclude: learner.seen, seed: `check|${concept.id}|${priorChecks}|${carried.current.length}`,
    });
  }
  const set = drawn.current;
  const grade = () => {
    const g = gradeCheck(attempts.current);
    void recordLessonEvent(db, {
      conceptId: concept.id, lessonId: null, url: null, type: g.passed ? 'check-passed' : 'check-failed', ts: Date.now(),
      detail: { correct: g.correct, total: g.total, attemptUuids: attempts.current.map((a) => a.uuid), rubric: CHECK.rubric },
    }).then(() => setResult(g));
  };
  // All five were answered before the reload and only the grading was lost.
  const gradedOnce = useRef(false);
  useEffect(() => {
    if (remaining === 0 && !gradedOnce.current) {
      gradedOnce.current = true;
      grade();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (!pool || !set) return <p className="muted">Loading positions</p>;
  if (set.length < remaining) {
    return (
      <div className="empty" data-testid="check-unavailable">
        <h2>Check not available</h2>
        <p>A fair check needs {CHECK.size} positions you have never seen, rated {CHECK.band.lo}–{CHECK.band.hi - 1}. Only {set.length} are left for “{concept.title}” in the installed pack.</p>
        <div className="actions"><button className="primary" onClick={() => onDone(null)}>Back</button></div>
      </div>
    );
  }
  if (result) {
    return (
      <div className="check-result" data-testid="check-result" data-passed={result.passed}>
        <p className="kicker">Check: {concept.title}</p>
        <h2>{result.passed ? 'Passed' : 'Not passed yet'}: {result.correct} of {result.total} solved first try</h2>
        <p>{result.passed
          ? 'This concept now counts as demonstrated on unseen positions.'
          : `It needs ${CHECK.pass} of ${CHECK.size}. The missed positions are in your review queue; the check can be retaken with new positions.`}</p>
        <div className="actions dock"><button className="primary" data-testid="check-done" onClick={() => onDone(result.passed)}>Continue</button></div>
      </div>
    );
  }
  return (
    <PuzzleStream
      pick={(_ex, i) => set[i] ?? null}
      limit={remaining}
      context="check"
      conceptId={concept.id}
      sessionId={sessionId}
      allowHints={false}
      seen={new Set()}
      note={(done) => `Check ${Math.min(carried.current!.length + done + 1, CHECK.size)} of ${CHECK.size}`}
      onAttempt={(a) => attempts.current.push(a)}
      onFinished={grade}
    />
  );
}

/** Works through review items that are due, oldest first. */
export function ReviewRunner({ due, sessionId, stop, onAttempt, onFinished, single }: {
  due: ReviewState[]; sessionId: string | null; stop?: boolean; onAttempt?: (a: Attempt) => void; onFinished: (reason: 'done' | 'stopped') => void;
  /** One item inside one-button practice: no count is shown (it does not say what kind of item this is), and no "queue cleared" screen. */
  single?: boolean;
}) {
  const pool = usePool();
  const book = useOpeningBook();
  const repertoire = useRepertoire();
  const prefs = useOpeningPrefs();
  const games = useGames();
  // Snapshot at start: items answered now get a new due date and must not re-enter this run.
  // Own-game positions first: review minutes are few and that is where the rating is lost.
  // A position from his own games is asked in the form it was last answered in (see src/schedule/position.ts).
  const queue = useRef(reviewOrder(due).map((d) => d.ask ?? d.itemId));
  const held = useRef<{ id: string; sense?: SenseItem; drill?: DrillPosition; move?: MoveItem } | null>(null);
  const [i, setI] = useState(0);
  const leftNow = queue.current.length - i;
  useRunNote(single || leftNow <= 0 ? null : `${leftNow} left`);
  if (!pool) return <p className="muted">Loading positions</p>;

  const advance = () => {
    if (stop) return onFinished('stopped');
    if (single && i + 1 >= queue.current.length) return onFinished('done');
    setI((x) => x + 1);
  };
  const itemId = queue.current[i];
  // One exercise at a time, keyed by what it is; anything without a key is a notice in its place.
  const body = (): ReactElement => {
    if (itemId === undefined) {
      return (
        <div className="empty" data-testid="review-empty">
          <p>{queue.current.length === 0 ? 'Nothing is due for review.' : 'Review queue cleared for now.'}</p>
          <div className="actions"><button className="primary" onClick={() => onFinished('done')}>Continue</button></div>
        </div>
      );
    }
    if (itemId.startsWith('lichess:')) {
      const puzzle = pool.byId.get(itemId.slice(8));
      if (!puzzle) return <RetiredItem onNext={advance} />;
      return (
        <PuzzlePlayer key={itemId} puzzle={puzzle} context="review" conceptId={null} sessionId={sessionId} packVersion={pool.version}
          allowHints={false} onRecorded={onAttempt} onNext={advance} />
      );
    }
    if (itemId.startsWith('sense:')) {
      if (!games) return <p className="muted">Loading your games</p>;
      // Looked up once per queue position and kept: the games table changes while games are
      // analysed, and a question on screen must not turn into "no longer available" mid-answer.
      if (held.current?.id !== itemId) held.current = { id: itemId, sense: senseItemById(games, itemId) };
      const item = held.current.sense;
      if (!item) return <RetiredItem onNext={advance} />;
      return <SenseDrill key={itemId} item={item} sessionId={sessionId} context="review" onDone={advance} />;
    }
    if (itemId.startsWith('move:')) {
      if (!games) return <p className="muted">Loading your games</p>;
      if (held.current?.id !== itemId) held.current = { id: itemId, move: moveItems(games, { fromMove: 1, toMove: 200 }).find((m) => m.id === itemId) };
      const move = held.current.move;
      if (!move) return <RetiredItem onNext={advance} />;
      return <OwnMoveDrill key={itemId} item={move} sessionId={sessionId} context="review" onRecorded={onAttempt} onDone={advance} />;
    }
    if (itemId.startsWith('kpk:')) {
      const [, goal, ...rest] = itemId.split(':');
      return <KpkDrill key={itemId} start={rest.join(':')} goal={goal as KpkGoal} sessionId={sessionId} onDone={advance} />;
    }
    if (itemId.startsWith('game:')) {
      if (!games) return <p className="muted">Loading your games</p>;
      if (held.current?.id !== itemId) held.current = { id: itemId, drill: drillPositions(games).find((d) => d.id === itemId) };
      const drill = held.current.drill;
      if (!drill) return <RetiredItem onNext={advance} />;
      return <OwnGameDrill key={itemId} drill={drill} sessionId={sessionId} onDone={advance} />;
    }
    if (itemId.startsWith('opening:')) {
      const entry = repertoire.find((e) => drillId(e) === itemId);
      if (!entry) return <RetiredItem onNext={advance} />;
      return <OpeningDrill key={itemId} entry={entry} book={book} band={prefs.band} sessionId={sessionId} onDone={advance} />;
    }
    const [, lessonId, stepNo] = itemId.split(':');
    const lesson = lessonId ? LESSON_BY_ID.get(lessonId) : undefined;
    const step = lesson?.steps[Number(stepNo) - 1];
    if (!lesson || !step || step.type !== 'try') return <RetiredItem onNext={advance} />;
    return (
      <section className="lesson-review" key={itemId}>
        <Ask title={CONCEPT_BY_ID.get(lesson.conceptId)?.title ?? lesson.title} />
        <LessonTry lesson={lesson} stepIndex={Number(stepNo) - 1} step={step} hideBefore sessionId={sessionId} context="review" onDone={advance} />
      </section>
    );
  };
  return <KeepLast>{body()}</KeepLast>;
}

function RetiredItem({ onNext }: { onNext: () => void }) {
  return (
    <div className="empty">
      <p>This review position is no longer in the installed content pack. Its history is kept.</p>
      <div className="actions"><button className="primary" onClick={onNext}>Next</button></div>
    </div>
  );
}
