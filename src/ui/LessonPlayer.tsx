import { useEffect, useMemo, useRef, useState } from 'react';
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { SOURCE_BY_ID } from '../content';
import type { Lesson, LessonStep } from '../content/types';
import { getMeta, recordAttempt, recordLessonEvent, setMeta } from '../db/db';
import { useDb, useFocusMode } from '../app/store';
import { Board } from './Board';

type TryStep = Extract<LessonStep, { type: 'try' }>;

/** One "find the author's move" interaction inside a lesson (also reused for spaced review). */
export function LessonTry({ lesson, stepIndex, step, sessionId, context, onDone, hideBefore = false }: {
  lesson: Lesson; stepIndex: number; step: TryStep; sessionId: string | null; context: 'lesson' | 'review'; onDone: () => void;
  /** Review shows the position without the lead-in text, which would give the move away. */
  hideBefore?: boolean;
}) {
  const db = useDb();
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(step.fen);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [finished, setFinished] = useState(false);
  const first = useRef<string | null>(null);
  const started = useRef(Date.now());
  const recorded = useRef(false);
  const solver = step.orientation;

  useEffect(() => {
    setPly(0); setFen(step.fen); setLastMove(null); setMistakes(0); setRevealed(false); setWrong(null); setFinished(false);
    first.current = null; started.current = Date.now(); recorded.current = false;
    // Keyed on what the example is, not on the object passed in: a parent that builds a new
    // `step` object on every render must not reset the board in the middle of the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, lesson.revision, stepIndex]);

  async function finish(m: number, shown: boolean) {
    setFinished(true);
    if (recorded.current) return;
    recorded.current = true;
    await recordAttempt(db, {
      sessionId, context, exerciseId: `lesson:${lesson.id}:${stepIndex + 1}`, exerciseKind: 'lesson-try',
      contentVersion: `${lesson.id}@${lesson.revision}`, conceptId: lesson.conceptId, themes: [], rating: null, ts: Date.now(),
      elapsedMs: Date.now() - started.current, firstMove: first.current, played: step.moves.slice(0, ply + 1), mistakes: m, hints: shown ? 1 : 0,
      outcome: shown ? 'assisted' : m > 0 ? 'fail' : 'success', acceptedAlternative: false,
    });
  }

  function onMove(uci: string) {
    if (finished) return;
    const pos = positionFromFen(fen);
    const expected = step.moves[ply]!;
    first.current ??= uci;
    if (!sameMove(pos, uci, expected)) {
      setWrong(sanOf(pos, uci));
      setMistakes((m) => m + 1);
      setResetKey((k) => k + 1);
      return;
    }
    setWrong(null);
    let next = applyUci(pos, expected);
    setLastMove(expected);
    const reply = step.moves[ply + 1];
    if (reply === undefined) {
      setFen(fenOf(next));
      void finish(mistakes, revealed);
      return;
    }
    setFen(fenOf(next));
    setTimeout(() => {
      next = applyUci(next, reply);
      setFen(fenOf(next));
      setLastMove(reply);
      setPly(ply + 2);
    }, 420);
  }

  function reveal() {
    setRevealed(true);
    const pos = positionFromFen(fen);
    const expected = step.moves[ply]!;
    setWrong(null);
    setFen(fenOf(applyUci(pos, expected)));
    setLastMove(expected);
    const reply = step.moves[ply + 1];
    if (reply === undefined) void finish(mistakes, true);
    else setTimeout(() => { setFen((f) => fenOf(applyUci(positionFromFen(f), reply))); setLastMove(reply); setPly(ply + 2); }, 600);
  }

  const side = solver === 'white' ? 'White' : 'Black';
  return (
    <div className="lesson-try" data-testid="lesson-try" data-expected={finished ? '' : step.moves[ply]} data-finished={finished}>
      {!hideBefore && step.before?.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
      <p className="prompt">{finished ? 'The move from the text is on the board.' : `${side} to move. Play the move the text goes on to explain.`}</p>
      <Board fen={fen} orientation={solver} movable={finished ? null : solver} lastMove={lastMove} onMove={onMove} resetKey={resetKey} />
      <div className="feedback" aria-live="polite">
        {wrong && !finished && <div className="verdict wrong"><strong>{wrong} is not the move the text plays.</strong><p>Try again, or have the move shown.</p></div>}
      </div>
      {!finished && <div className="actions"><button onClick={reveal}>Show the move</button></div>}
      {finished && (
        <>
          {step.after.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
          <div className="actions"><button className="primary" data-testid="lesson-next" onClick={onDone}>Continue</button></div>
        </>
      )}
    </div>
  );
}

export function LessonPlayer({ lesson, sessionId, onFinished, onExit }: { lesson: Lesson; sessionId: string | null; onFinished: () => void; onExit: () => void }) {
  const db = useDb();
  useFocusMode();
  const source = SOURCE_BY_ID.get(lesson.sourceId)!;
  const key = `lessonProgress:${lesson.id}@${lesson.revision}`;
  const [index, setIndex] = useState<number | null>(null);
  const total = lesson.steps.length;

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = (await getMeta<number>(db, key)) ?? 0;
      if (!live) return;
      setIndex(Math.min(saved, total - 1));
      if (saved === 0) await recordLessonEvent(db, { conceptId: lesson.conceptId, lessonId: lesson.id, url: null, type: 'local-started', ts: Date.now() });
    })();
    return () => { live = false; };
  }, [db, key, lesson, total]);

  const step = useMemo(() => (index === null ? null : lesson.steps[index]), [index, lesson]);
  if (index === null || !step) return <p className="muted">Loading lesson</p>;

  async function advance() {
    if (index === null) return;
    if (index + 1 >= total) {
      await recordLessonEvent(db, { conceptId: lesson.conceptId, lessonId: lesson.id, url: null, type: 'local-completed', ts: Date.now() });
      await setMeta(db, key, 0);
      onFinished();
      return;
    }
    await setMeta(db, key, index + 1);
    setIndex(index + 1);
    window.scrollTo(0, 0);
  }

  return (
    <article className="lesson" data-testid="lesson" data-step={index + 1} data-steps={total}>
      <header>
        <div className="lesson-bar">
          <p className="kicker">Lesson, part {index + 1} of {total}</p>
          <button className="quiet" data-testid="lesson-exit" onClick={onExit}>Leave lesson</button>
        </div>
        {index === 0 ? (
          <>
            <h2>{lesson.title}</h2>
            <p className="attribution">
              From <cite>{source.title}</cite> by {source.author} ({lesson.locator}). The text is unaltered.{' '}
              <a href={source.url} target="_blank" rel="noreferrer">Source</a>
            </p>
            {lesson.notationNote && <p className="note">{lesson.notationNote}</p>}
            {lesson.review.ownerReview === 'pending' && (
              <p className="note">This excerpt was selected when the app was built and checked mechanically (text matches the book; moves are legal and agree with Stockfish). You have not reviewed it yet.</p>
            )}
          </>
        ) : (
          <p className="attribution">{source.author}, <cite>{source.title}</cite></p>
        )}
      </header>
      <progress value={index} max={total} aria-label="Lesson progress" />
      {step.type === 'text' && (
        <>
          {step.paragraphs.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
          <div className="actions"><button className="primary" data-testid="lesson-next" onClick={() => void advance()}>Continue</button></div>
        </>
      )}
      {step.type === 'board' && (
        <>
          <p className="prompt">{step.diagram ? `Diagram ${step.diagram} from the book.` : 'Position from the text.'} {positionFromFen(step.fen).turn === 'white' ? 'White' : 'Black'} to move.</p>
          <Board fen={step.fen} orientation={step.orientation} movable={null} />
          <div className="actions"><button className="primary" data-testid="lesson-next" onClick={() => void advance()}>Continue</button></div>
        </>
      )}
      {step.type === 'try' && <LessonTry lesson={lesson} stepIndex={index} step={step} sessionId={sessionId} context="lesson" onDone={() => void advance()} />}
      {index > 0 && <div className="actions"><button className="quiet" onClick={() => { void setMeta(db, key, index - 1); setIndex(index - 1); }}>Back</button></div>}
    </article>
  );
}
