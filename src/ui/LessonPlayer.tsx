import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { applyUci, fenOf, isCheckmate, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { LESSON_MARGIN, lessonTryEvidence, SOURCE_BY_ID } from '../content';
import { bestLineFor } from '../engine/interactive';
import type { Lesson, LessonStep } from '../content/types';
import { getMeta, recordAttempt, recordLessonEvent, setMeta } from '../db/db';
import { useDb, useFocusMode } from '../app/store';
import { Board } from './Board';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { useItem } from './Stage';
import { lessonPages, pageOfStep, stepOfPage } from '../learn/pages';
import { modernLesson } from '../learn/notation';

type TryStep = Extract<LessonStep, { type: 'try' }>;

/** One "find the author's move" interaction inside a lesson (also reused for spaced review). */
export function LessonTry({ lesson, stepIndex, step, sessionId, context, onDone, hideBefore = false, back, leadIn }: {
  lesson: Lesson; stepIndex: number; step: TryStep; sessionId: string | null; context: 'lesson' | 'review'; onDone: () => void;
  /** A control put beside the main button (the lesson's "Back"). */
  back?: ReactNode;
  /** Review shows the position without the lead-in text, which would give the move away. */
  hideBefore?: boolean;
  /** In a lesson: the book's lead-in to show above the board (ADR-064); long ones are a page of their own. */
  leadIn?: string[];
}) {
  const db = useDb();
  const stage = useItem(onDone);
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
      {/* A question looks like one (ADR-064): "Your turn", the book's short lead-in, the board at full size, the question under it. */}
      {context === 'lesson' && (
        <div className="your-turn" data-testid="your-turn">
          <span className="your-turn-label">Your turn</span>
          {(leadIn ?? (hideBefore ? [] : step.before ?? [])).map((p, i) => <p className="lead-in" key={i}>{p}</p>)}
        </div>
      )}
      <div className="lesson-board">
        <Board fen={fen} orientation={solver} movable={finished || checking ? null : solver} lastMove={lastMove} onMove={(u) => void onMove(u)} resetKey={resetKey} />
      </div>
      <p className="prompt">{finished ? 'The book’s move is on the board.' : `${side} to move. Find the book’s move.`}</p>
      <div aria-live="polite">
        {wrong && !finished && <div className="verdict wrong"><strong>{wrong} is not the move the text plays.</strong></div>}
        {checking && <p className="muted">Checking your move with the engine</p>}
        {other && !finished && (
          <div className="verdict neutral" data-testid="lesson-other" data-kind={other.kind}>
            <strong>{other.kind === 'sound' ? `${other.san} is sound, but not the text’s move.` : `${other.san} could not be checked.`}</strong>
            <p>Not a miss.</p>
          </div>
        )}
      </div>
      {finished && step.after.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
      <div className="actions dock split">
        {back}
        {!finished && <button disabled={!armed} onClick={reveal}>Show the answer</button>}
        {finished && <button className="primary" data-testid="lesson-next" disabled={!armed} onClick={stage.next}>{stage.nextLabel ?? 'Continue'}</button>}
      </div>
    </div>
  );
}

/** A position the book shows, as a small framed figure with its caption: something to look at, not to play. */
function LessonFigure({ fen, caption, half }: { fen: string; caption: string; half: boolean }) {
  return (
    <figure className={`lesson-figure${half ? ' is-half' : ''}`} data-testid="lesson-figure">
      <div className="lesson-figure-board"><Board fen={fen} orientation="white" movable={null} /></div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function LessonPlayer({ lesson: printed, sessionId, onFinished, onExit, showExit = true }: {
  lesson: Lesson; sessionId: string | null; onFinished: () => void; onExit: () => void;
  /** False where the frame around the lesson already has the way out. */
  showExit?: boolean;
}) {
  const db = useDb();
  useFocusMode();
  // The book's words with its moves in modern notation (owner, 2026-11-20); the file is as printed.
  const lesson = useMemo(() => modernLesson(printed).lesson, [printed]);
  const source = SOURCE_BY_ID.get(lesson.sourceId)!;
  const key = `lessonProgress:${lesson.id}@${lesson.revision}`;
  const pages = useMemo(() => lessonPages(lesson), [lesson]);
  const [index, setIndex] = useState<number | null>(null);
  const total = pages.length;

  useEffect(() => {
    let live = true;
    void (async () => {
      // Saved progress is a step index (the format before pages): it opens on the page that holds it.
      const saved = (await getMeta<number>(db, key)) ?? 0;
      if (!live) return;
      setIndex(Math.min(pageOfStep(pages, saved), total - 1));
      if (saved === 0) await recordLessonEvent(db, { conceptId: lesson.conceptId, lessonId: lesson.id, url: null, type: 'local-started', ts: Date.now() });
    })();
    return () => { live = false; };
  }, [db, key, lesson, pages, total]);

  const page = index === null ? null : pages[index];
  useScreenChange(`${lesson.id}|${index}`);
  const stepArmed = useArmed();
  if (index === null || !page) return <p className="muted">Loading lesson</p>;

  async function advance() {
    if (index === null) return;
    if (index + 1 >= total) {
      await recordLessonEvent(db, { conceptId: lesson.conceptId, lessonId: lesson.id, url: null, type: 'local-completed', ts: Date.now() });
      await setMeta(db, key, 0);
      onFinished();
      return;
    }
    await setMeta(db, key, stepOfPage(pages[index + 1]!));
    setIndex(index + 1);
    window.scrollTo(0, 0);
  }

  const back = index > 0 ? <button data-testid="lesson-back" onClick={() => { void setMeta(db, key, stepOfPage(pages[index - 1]!)); setIndex(index - 1); }}>Back</button> : null;
  return (
    <article className={`lesson is-${page.kind}`} data-testid="lesson" data-step={index + 1} data-steps={total} data-page={page.kind}>
      <header>
        <div className="lesson-bar">
          <progress value={index + 1} max={total} aria-label={`Part ${index + 1} of ${total}`} />
          {showExit && <button className="quiet" data-testid="lesson-exit" onClick={onExit}>Leave</button>}
        </div>
        {index === 0 && (
          <>
            <h2 className="lesson-title">{lesson.title}</h2>
            <div className="attribution">
              <span>{source.author}, <cite>{source.title}</cite></span>
              <details className="source-details" data-testid="lesson-provenance">
                <summary aria-label="About this excerpt">ⓘ</summary>
                <p className="note">The words are the book’s own ({lesson.locator}); passages are excerpts and may be shortened or rearranged. Moves are written in modern notation. Every paragraph was matched against the book, positions against its diagrams or moves, and the moves you are asked to find were checked with Stockfish.{lesson.review.ownerReview === 'pending' ? ' Not yet reviewed by you.' : ''} <a href={source.url} target="_blank" rel="noreferrer">The book</a></p>
              </details>
            </div>
            {lesson.notationNote && <p className="notation-note">{lesson.notationNote}</p>}
          </>
        )}
      </header>
      {page.kind === 'read' ? (
        <>
          {page.figures.length > 0 && (
            <div className="lesson-figures">
              {page.figures.map((f) => <LessonFigure key={f.step + f.caption} fen={f.fen} caption={f.caption} half={page.figures.length > 1} />)}
            </div>
          )}
          {page.paragraphs.map((p, i) => <p className="quoted" key={i}>{p}</p>)}
          <div className="actions dock split">{back}<button className="primary" data-testid="lesson-next" disabled={!stepArmed} onClick={() => void advance()}>Continue</button></div>
        </>
      ) : (
        <LessonTry lesson={lesson} stepIndex={page.step} step={lesson.steps[page.step] as TryStep} sessionId={sessionId} context="lesson" leadIn={page.leadIn} onDone={() => void advance()} back={back} />
      )}
    </article>
  );
}
