import { useEffect, useMemo, useRef, useState } from 'react';
import { applyUci, fenOf, isCheckmate, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { LESSON_MARGIN, lessonTryEvidence, SOURCE_BY_ID } from '../content';
import { bestLineFor } from '../engine/interactive';
import type { Lesson, LessonStep } from '../content/types';
import { getMeta, recordAttempt, recordLessonEvent, setMeta } from '../db/db';
import { useDb, useFocusMode } from '../app/store';
import { Board } from './Board';
import { useArmed, useScreenChange } from '../app/tapGuard';

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
  /**
   * The learner played a move that is not the text's but that the engine check does not fault
   * (or that could not be checked). It is said so and never counted as a mistake; the text's
   * move is still asked for, because the text may prefer it for reasons of its own.
   */
  const [other, setOther] = useState<{ san: string; kind: 'sound' | 'unchecked' } | null>(null);
  const [checking, setChecking] = useState(false);
  /** Where the learner is; lets a late engine answer be dropped if they have moved on. */
  const here = useRef('');
  here.current = `${lesson.id}:${stepIndex}:${ply}`;
  const first = useRef<string | null>(null);
  const started = useRef(Date.now());
  const recorded = useRef(false);
  const solver = step.orientation;
  useScreenChange(`${lesson.id}|${stepIndex}|${finished}`);
  const armed = useArmed();

  useEffect(() => {
    setPly(0); setFen(step.fen); setLastMove(null); setMistakes(0); setRevealed(false); setWrong(null); setFinished(false); setOther(null); setChecking(false);
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

  /** Whether a move that is not the text's is nonetheless not faulted by the engine. */
  async function judgeOther(pos: ReturnType<typeof positionFromFen>, uci: string): Promise<'sound' | 'unchecked' | 'wrong'> {
    const ev = lessonTryEvidence(lesson.id, stepIndex + 1, fen);
    if (ev?.alternatives.some((a) => sameMove(pos, uci, a.uci))) return 'sound';
    const after = applyUci(pos, uci);
    if (isCheckmate(after)) return 'sound';
    if (!ev) return 'unchecked';
    // Not among the moves checked when the lesson was built: ask the engine on the device,
    // with the same margin. If it cannot answer, nothing is held against the learner.
    setChecking(true);
    const reply = await bestLineFor(fenOf(after));
    setChecking(false);
    if (!reply) return 'unchecked';
    return 100 - reply.wp >= ev.bestWinPct - LESSON_MARGIN ? 'sound' : 'wrong';
  }

  async function onMove(uci: string) {
    if (finished || checking) return;
    const pos = positionFromFen(fen);
    const expected = step.moves[ply]!;
    first.current ??= uci;
    if (!sameMove(pos, uci, expected)) {
      const asked = here.current;
      const verdict = await judgeOther(pos, uci);
      if (asked !== here.current) return;
      setResetKey((k) => k + 1);
      if (verdict === 'wrong') {
        setOther(null);
        setWrong(sanOf(pos, uci));
        setMistakes((m) => m + 1);
      } else {
        setWrong(null);
        setOther({ san: sanOf(pos, uci), kind: verdict });
      }
      return;
    }
    setOther(null);
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
      {/* The board stays in view while the text is read: on a phone the two do not fit on one screen. */}
      <div className="lesson-board">
        <Board fen={fen} orientation={solver} movable={finished || checking ? null : solver} lastMove={lastMove} onMove={(u) => void onMove(u)} resetKey={resetKey} />
      </div>
      {!hideBefore && step.before?.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
      <p className="prompt">{finished ? 'The move from the text is on the board.' : `${side} to move. Play the move the text plays here.`}</p>
      <div className="feedback" aria-live="polite">
        {wrong && !finished && <div className="verdict wrong"><strong>{wrong} is not the move the text plays.</strong><p>Try again, or have the move shown.</p></div>}
        {checking && <p className="muted">Checking your move with the engine</p>}
        {other && !finished && (
          <div className="verdict neutral" data-testid="lesson-other" data-kind={other.kind}>
            <strong>{other.kind === 'sound' ? `The engine’s check does not fault ${other.san} here.` : `${other.san} could not be checked on this device.`}</strong>
            <p>The text plays a different move. Try again, or have it shown. Nothing is recorded as missed.</p>
          </div>
        )}
      </div>
      {!finished && <div className="actions"><button disabled={!armed} onClick={reveal}>Show the move</button></div>}
      {finished && (
        <>
          {step.after.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
          <div className="actions"><button className="primary" data-testid="lesson-next" disabled={!armed} onClick={onDone}>Continue</button></div>
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
  useScreenChange(`${lesson.id}|${index}`);
  const stepArmed = useArmed();
  // The position a page of text is about: the board just shown, or else the one that follows.
  // Text and its diagram used to be on separate screens.
  const context = useMemo(() => {
    if (index === null || step?.type !== 'text') return null;
    const prev = lesson.steps[index - 1];
    const next = lesson.steps[index + 1];
    if (prev && prev.type === 'board') return prev;
    if (next && (next.type === 'board' || next.type === 'try')) return next;
    if (prev && prev.type === 'try') {
      let pos = positionFromFen(prev.fen);
      for (const u of prev.moves) pos = applyUci(pos, u);
      return { fen: fenOf(pos), orientation: prev.orientation };
    }
    return null;
  }, [index, step, lesson]);
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
              From <cite>{source.title}</cite> by {source.author} ({lesson.locator}). The words are the book’s own; passages are excerpts and may be shortened or rearranged.{' '}
              <a href={source.url} target="_blank" rel="noreferrer">Source</a>
            </p>
            {lesson.notationNote && <p className="note">{lesson.notationNote}</p>}
            {lesson.review.ownerReview === 'pending' && (
              <p className="note">This excerpt was selected when the app was built and checked mechanically (every paragraph matches the book; positions match its diagrams or moves; the moves you are asked to find were checked with Stockfish). You have not reviewed it yet.</p>
            )}
          </>
        ) : (
          <p className="attribution">{source.author}, <cite>{source.title}</cite></p>
        )}
      </header>
      <progress value={index} max={total} aria-label="Lesson progress" />
      {step.type === 'text' && (
        <>
          {context && (
            <div className="lesson-board" data-testid="lesson-context-board">
              <Board fen={context.fen} orientation={context.orientation} movable={null} />
            </div>
          )}
          {step.paragraphs.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
          <div className="actions"><button className="primary" data-testid="lesson-next" disabled={!stepArmed} onClick={() => void advance()}>Continue</button></div>
        </>
      )}
      {step.type === 'board' && (
        <>
          <div className="lesson-board"><Board fen={step.fen} orientation={step.orientation} movable={null} /></div>
          <p className="prompt">{step.diagram && !step.afterDiagramMoves?.length ? `Diagram ${step.diagram} from the book.` : 'Position from the text.'} {positionFromFen(step.fen).turn === 'white' ? 'White' : 'Black'} to move.</p>
          <div className="actions"><button className="primary" data-testid="lesson-next" disabled={!stepArmed} onClick={() => void advance()}>Continue</button></div>
        </>
      )}
      {step.type === 'try' && <LessonTry lesson={lesson} stepIndex={index} step={step} sessionId={sessionId} context="lesson" onDone={() => void advance()} />}
      {index > 0 && <div className="actions"><button className="quiet" onClick={() => { void setMeta(db, key, index - 1); setIndex(index - 1); }}>Back</button></div>}
    </article>
  );
}
