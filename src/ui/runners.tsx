import { useEffect, useMemo, useRef, useState } from 'react';
import { CONCEPT_BY_ID, conceptOpenings, conceptThemes, LESSON_BY_ID } from '../content';
import type { Concept } from '../content/types';
import { recordLessonEvent } from '../db/db';
import type { Attempt, AttemptContext, ReviewState } from '../db/types';
import { CHECK, gradeCheck, KPK_CHECK } from '../learn/curriculum';
import { selectPuzzles } from '../puzzles/select';
import type { Puzzle } from '../puzzles/types';
import { type Learner, useDb, usePool } from '../app/store';
import { drillPositions } from '../games/metrics';
import { drillId } from '../openings/repertoire';
import { OwnGameDrill, useGames } from './Games';
import { KpkDrill, type KpkGoal, kpkCheckSet } from './Kpk';
import { LessonTry } from './LessonPlayer';
import { OpeningDrill, useOpeningBook, useOpeningPrefs, useRepertoire } from './Openings';
import { SenseDrill, senseItemsFrom } from './Sense';
import { PuzzlePlayer } from './PuzzlePlayer';

export type Picker = (exclude: Set<string>, index: number) => Puzzle | null;

/** Runs puzzles one after another, asking `pick` for each next one. */
export function PuzzleStream(props: {
  pick: Picker;
  context: AttemptContext;
  conceptId: string | null | ((p: Puzzle) => string | null);
  sessionId: string | null;
  allowHints: boolean;
  heading?: string | ((p: Puzzle) => string);
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
      <div className="empty" data-testid="stream-empty">
        <p>No unseen positions are left for this selection in the installed pack.</p>
        <div className="actions"><button className="primary" onClick={() => props.onFinished('exhausted')}>Continue</button></div>
      </div>
    );
  }
  const conceptId = typeof props.conceptId === 'function' ? props.conceptId(current) : props.conceptId;
  const heading = typeof props.heading === 'function' ? props.heading(current) : props.heading;
  return (
    <PuzzlePlayer
      key={current.id}
      puzzle={current}
      context={props.context}
      conceptId={conceptId}
      sessionId={props.sessionId}
      packVersion={pool.version}
      allowHints={props.allowHints}
      heading={heading}
      onRecorded={props.onAttempt}
      nextLabel={props.nextLabel}
      onNext={() => {
        const n = count + 1;
        setCount(n);
        next(n);
      }}
    />
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
        <h2>{result.correct} of {result.total} played out correctly</h2>
        <p>{result.passed ? `Passed (needs ${KPK_CHECK.pass} of ${KPK_CHECK.size}). This concept now counts as demonstrated.` : `Not passed yet (needs ${KPK_CHECK.pass} of ${KPK_CHECK.size}). You can retake it with new starts.`}</p>
        <p className="muted">Each start counts only if every move kept the theoretical result against perfect play, with no help. Five starts is a small sample: treat it as a gate, not a measurement.</p>
        <div className="actions"><button className="primary" data-testid="check-done" onClick={() => onDone(result.passed)}>Continue</button></div>
      </div>
    );
  }
  const item = set[i]!;
  return (
    <KpkDrill
      key={`${item.goal}:${item.start}`} start={item.start} goal={item.goal} sessionId={sessionId} context="check" allowShow={false}
      heading={`Check: ${concept.title}, ${i + 1} of ${KPK_CHECK.size}`}
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
  if (pool && drawn.current === null) {
    drawn.current = selectPuzzles(pool.puzzles, {
      themes: conceptThemes(concept), openings: conceptOpenings(concept), band: CHECK.band, target: (CHECK.band.lo + CHECK.band.hi) / 2,
      count: CHECK.size, exclude: learner.seen, seed: `check|${concept.id}|${priorChecks}`,
    });
  }
  const set = drawn.current;

  if (!pool || !set) return <p className="muted">Loading positions</p>;
  if (set.length < CHECK.size) {
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
        <h2>{result.correct} of {result.total} solved first try</h2>
        <p>{result.passed
          ? `Passed (needs ${CHECK.pass} of ${CHECK.size}). This concept now counts as demonstrated on unseen positions.`
          : `Not passed yet (needs ${CHECK.pass} of ${CHECK.size}). The missed positions are in your review queue, and you can retake the check with new positions.`}</p>
        <p className="muted">Positions were rated {CHECK.band.lo}–{CHECK.band.hi - 1} on the Lichess puzzle scale, with no hints. Five positions is a small sample: treat it as a gate, not a measurement.</p>
        <div className="actions"><button className="primary" data-testid="check-done" onClick={() => onDone(result.passed)}>Continue</button></div>
      </div>
    );
  }
  return (
    <PuzzleStream
      pick={(_ex, i) => set[i] ?? null}
      limit={CHECK.size}
      context="check"
      conceptId={concept.id}
      sessionId={sessionId}
      allowHints={false}
      seen={new Set()}
      heading={`Check: ${CHECK.size} unseen positions, no hints`}
      onAttempt={(a) => attempts.current.push(a)}
      onFinished={() => {
        const g = gradeCheck(attempts.current);
        void recordLessonEvent(db, {
          conceptId: concept.id, lessonId: null, url: null, type: g.passed ? 'check-passed' : 'check-failed', ts: Date.now(),
          detail: { correct: g.correct, total: g.total, attemptUuids: attempts.current.map((a) => a.uuid), rubric: CHECK.rubric },
        }).then(() => setResult(g));
      }}
    />
  );
}

/** Works through review items that are due, oldest first. */
export function ReviewRunner({ due, sessionId, stop, onAttempt, onFinished }: {
  due: ReviewState[]; sessionId: string | null; stop?: boolean; onAttempt?: (a: Attempt) => void; onFinished: (reason: 'done' | 'stopped') => void;
}) {
  const pool = usePool();
  const book = useOpeningBook();
  const repertoire = useRepertoire();
  const prefs = useOpeningPrefs();
  const games = useGames();
  // Snapshot at start: items answered now get a new due date and must not re-enter this run.
  const queue = useRef(due.map((d) => d.itemId));
  const [i, setI] = useState(0);
  if (!pool) return <p className="muted">Loading positions</p>;

  const advance = () => {
    if (stop) return onFinished('stopped');
    setI((x) => x + 1);
  };
  const itemId = queue.current[i];
  if (itemId === undefined) {
    return (
      <div className="empty" data-testid="review-empty">
        <p>{queue.current.length === 0 ? 'Nothing is due for review.' : 'Review queue cleared for now.'}</p>
        <div className="actions"><button className="primary" onClick={() => onFinished('done')}>Continue</button></div>
      </div>
    );
  }
  const left = queue.current.length - i;
  if (itemId.startsWith('lichess:')) {
    const puzzle = pool.byId.get(itemId.slice(8));
    if (!puzzle) return <RetiredItem onNext={advance} />;
    return (
      <PuzzlePlayer key={itemId} puzzle={puzzle} context="review" conceptId={null} sessionId={sessionId} packVersion={pool.version}
        allowHints={false} heading={`Review, ${left} due`} onRecorded={onAttempt} onNext={advance} />
    );
  }
  if (itemId.startsWith('sense:')) {
    const item = games ? senseItemsFrom(games).find((x) => x.id === itemId) : undefined;
    if (!item) return <RetiredItem onNext={advance} />;
    return <SenseDrill key={itemId} item={item} sessionId={sessionId} context="review" heading={`Review, ${left} due`} onDone={advance} />;
  }
  if (itemId.startsWith('kpk:')) {
    const [, goal, ...rest] = itemId.split(':');
    return <KpkDrill key={itemId} start={rest.join(':')} goal={goal as KpkGoal} sessionId={sessionId} heading={`Review, ${left} due`} onDone={advance} />;
  }
  if (itemId.startsWith('game:')) {
    const drill = games ? drillPositions(games).find((d) => d.id === itemId) : undefined;
    if (!drill) return <RetiredItem onNext={advance} />;
    return <OwnGameDrill key={itemId} drill={drill} sessionId={sessionId} heading={`Review, ${left} due`} onDone={advance} />;
  }
  if (itemId.startsWith('opening:')) {
    const entry = repertoire.find((e) => drillId(e) === itemId);
    if (!entry) return <RetiredItem onNext={advance} />;
    return <OpeningDrill key={itemId} entry={entry} book={book} band={prefs.band} sessionId={sessionId} heading={`Review, ${left} due`} onDone={advance} />;
  }
  const [, lessonId, stepNo] = itemId.split(':');
  const lesson = lessonId ? LESSON_BY_ID.get(lessonId) : undefined;
  const step = lesson?.steps[Number(stepNo) - 1];
  if (!lesson || !step || step.type !== 'try') return <RetiredItem onNext={advance} />;
  return (
    <section className="puzzle">
      <header className="puzzle-head">
        <p className="kicker">Review, {left} due</p>
        <h2>{CONCEPT_BY_ID.get(lesson.conceptId)?.title ?? lesson.title}</h2>
      </header>
      <LessonTry key={itemId} lesson={lesson} stepIndex={Number(stepNo) - 1} step={step} hideBefore sessionId={sessionId} context="review" onDone={advance} />
    </section>
  );
}

function RetiredItem({ onNext }: { onNext: () => void }) {
  return (
    <div className="empty">
      <p>This review position is no longer in the installed content pack. Its history is kept.</p>
      <div className="actions"><button className="primary" onClick={onNext}>Next</button></div>
    </div>
  );
}
