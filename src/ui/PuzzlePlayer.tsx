import { useEffect, useMemo, useRef, useState } from 'react';
import { applyUci, fenOf, positionFromFen, sanOf } from '../chess/rules';
import { THEMES } from '../content';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext, Outcome } from '../db/types';
import { expectedMove, hintSquare, type PuzzleRun, remainingLine, startRun, submitMove, wrongMoveFor } from '../puzzles/run';
import type { Puzzle } from '../puzzles/types';
import { useDb, useFocusMode } from '../app/store';
import { Board } from './Board';
import { bestLineFor } from '../engine/interactive';
import { lineSan } from '../games/analyse';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { useLineSteps } from './LineSteps';

export interface PuzzlePlayerProps {
  puzzle: Puzzle;
  context: AttemptContext;
  conceptId: string | null;
  sessionId: string | null;
  packVersion: string;
  allowHints: boolean;
  /** Heading shown above the board, e.g. "Review" or the concept title. */
  heading?: string;
  onRecorded?: (a: Attempt) => void;
  onNext: () => void;
  nextLabel?: string;
}

type Phase = 'setup' | 'solving' | 'solved' | 'revealed';

export function PuzzlePlayer(props: PuzzlePlayerProps) {
  const { puzzle, allowHints } = props;
  const db = useDb();
  useFocusMode();
  const initial = useMemo(() => startRun(puzzle), [puzzle]);
  const [run, setRun] = useState<PuzzleRun>(initial);
  const [phase, setPhase] = useState<Phase>('setup');
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [marks, setMarks] = useState<string[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [wrongSan, setWrongSan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The engine's answer to the learner's wrong move: evidence about this position, shown on request. */
  const [reply, setReply] = useState<{ after: string; from: string; uci: string; state: 'loading' | 'none' | 'shown'; line?: string; pv?: string[] } | null>(null);
  /** Playing the position again after seeing the solution: practice, never recorded a second time. */
  const [replaying, setReplaying] = useState(false);
  useScreenChange(`${puzzle.id}|${phase}|${wrongSan ?? ''}`);
  const armed = useArmed();
  const startedAt = useRef(0);
  const decided = useRef(false);

  // Show the position before the opponent's move briefly, then play the setup move.
  useEffect(() => {
    setRun(initial);
    setPhase('setup');
    setLastMove(null);
    setMarks([]);
    setOutcome(null);
    setWrongSan(null);
    setReply(null);
    setReplaying(false);
    decided.current = false;
    const t = setTimeout(() => {
      setLastMove(initial.setupMove);
      setPhase('solving');
      startedAt.current = Date.now();
    }, 450);
    startedAt.current = 0;
    return () => clearTimeout(t);
  }, [initial]);

  // A position that was shown has been seen: if the learner leaves before answering, record
  // it as skipped so it can never be counted as "unseen" later.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    return () => {
      if (decided.current || startedAt.current === 0) return;
      decided.current = true;
      const r = runRef.current;
      void recordAttempt(db, {
        sessionId: props.sessionId, context: props.context, exerciseId: `lichess:${puzzle.id}`, exerciseKind: 'puzzle', contentVersion: props.packVersion,
        conceptId: props.conceptId, themes: puzzle.themes, rating: puzzle.rating, ts: Date.now(), elapsedMs: Date.now() - startedAt.current,
        firstMove: null, played: [], mistakes: 0, hints: r.hints, outcome: 'skipped', acceptedAlternative: false,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  async function decide(o: Outcome, r: PuzzleRun) {
    if (decided.current) return;
    decided.current = true;
    setOutcome(o);
    const now = Date.now();
    const a = await recordAttempt(db, {
      sessionId: props.sessionId,
      context: props.context,
      exerciseId: `lichess:${puzzle.id}`,
      exerciseKind: 'puzzle',
      contentVersion: props.packVersion,
      conceptId: props.conceptId,
      themes: puzzle.themes,
      rating: puzzle.rating,
      ts: now,
      elapsedMs: startedAt.current ? now - startedAt.current : 0,
      firstMove: r.firstMove,
      played: r.played,
      mistakes: r.mistakes,
      hints: r.hints,
      outcome: o,
      acceptedAlternative: r.acceptedAlternative,
    });
    props.onRecorded?.(a);
  }

  function onMove(uci: string) {
    if (phase !== 'solving' || busy) return;
    const before = positionFromFen(run.fen);
    const res = submitMove(run, uci);
    setMarks([]);
    if (res.verdict === 'wrong') {
      setReply({ after: positionAfter(run.fen, uci), from: run.fen, uci, state: 'none' });
      setWrongSan(sanOf(before, uci));
      setRun(res.run);
      setResetKey((k) => k + 1);
      void decide(res.run.hints > 0 ? 'assisted' : 'fail', res.run);
      return;
    }
    setWrongSan(null);
    if (res.verdict === 'solved') {
      setRun(res.run);
      setLastMove(uci);
      setPhase('solved');
      void decide(res.run.hints > 0 ? 'assisted' : res.run.mistakes > 0 ? 'fail' : 'success', res.run);
      return;
    }
    // Correct, with a forced reply: show the learner's move, then the reply.
    setBusy(true);
    const mid = { ...run, fen: positionAfter(run.fen, uci) };
    setRun(mid);
    setLastMove(uci);
    setTimeout(() => {
      setRun(res.run);
      setLastMove(res.reply ?? null);
      setBusy(false);
    }, 380);
  }

  async function showReply() {
    if (!reply || reply.state === 'loading') return;
    const asked = reply;
    const after = asked.after;
    setReply({ ...asked, state: 'loading' });
    const best = await bestLineFor(after);
    // The learner may have moved on meanwhile; only fill in the request that is still on screen.
    setReply((r) => (r && r.after === after ? (best && best.pv.length ? { ...asked, state: 'shown', line: lineSan(after, best.pv), pv: best.pv.slice(0, 5) } : { ...asked, state: 'shown' }) : r));
  }

  function hint() {
    if (busy) return;
    const h = hintSquare(run);
    setRun(h.run);
    setMarks([h.square]);
    void decide('assisted', h.run);
  }

  function reveal() {
    if (busy) return;
    void decide(run.hints > 0 ? 'assisted' : 'fail', run);
    setPhase('revealed');
    setMarks([expectedMove(run).slice(0, 2), expectedMove(run).slice(2, 4)]);
  }

  /** After the solution has been shown: the same position once more, by hand. */
  function replay() {
    setRun(initial);
    setPhase('solving');
    setLastMove(initial.setupMove);
    setMarks([]);
    setWrongSan(null);
    setReply(null);
    setReplaying(true);
    setResetKey((k) => k + 1);
  }

  async function skip() {
    await decide('skipped', run);
    props.onNext();
  }

  useEffect(() => {
    (window as unknown as { __wrongMove?: () => string }).__wrongMove = () => wrongMoveFor(run);
  }, [run]);

  const solver = initial.solver;
  const solutionSan = useMemo(() => {
    if (phase !== 'revealed') return '';
    let pos = positionFromFen(run.fen);
    const out: string[] = [];
    for (const u of remainingLine(run)) {
      out.push(sanOf(pos, u));
      pos = applyUci(pos, u);
    }
    return out.join(' ');
  }, [phase, run]);

  const done = phase === 'solved' || phase === 'revealed';
  // What is played through on the board: the solution once it has been shown, or the wrong
  // move followed by the engine's answer to it.
  const line = phase === 'revealed'
    ? { from: run.fen, pv: remainingLine(run) }
    : phase === 'solving' && wrongSan && reply?.state === 'shown' && reply.pv
      ? { from: reply.from, pv: [reply.uci, ...reply.pv] }
      : null;
  const steps = useLineSteps(line, phase === 'revealed' ? { initial: 0, startLabel: 'Play the solution' } : { initial: 2 });
  const stepping = !!steps.pos && steps.step > 0;
  return (
    <section className="puzzle" data-testid="puzzle" data-puzzle-id={puzzle.id} data-phase={phase} data-outcome={outcome ?? ''} data-expected={phase === 'solving' ? expectedMove(run) : ''}>
      <header className="puzzle-head">
        {props.heading && <p className="kicker">{props.heading}</p>}
        <h2>{phase === 'setup' ? 'Opponent is moving' : `${solver === 'white' ? 'White' : 'Black'} to move`}</h2>
      </header>
      <Board fen={stepping ? steps.pos!.fen : phase === 'setup' ? puzzle.fen : run.fen} orientation={solver} movable={phase === 'solving' && !busy && !stepping ? solver : null} lastMove={stepping ? steps.pos!.last : lastMove} marks={stepping ? [] : marks} onMove={onMove} resetKey={resetKey} />

      <div className="feedback" aria-live="polite">
        {phase === 'solving' && !wrongSan && !outcome && <p className="muted">Find the best move. Any checkmate also counts.</p>}
        {phase === 'solving' && outcome === 'assisted' && !wrongSan && <p className="muted">Hint shown: this attempt is recorded as assisted, not as a first-try solve.</p>}
        {phase === 'solving' && wrongSan && (
          <div className="verdict wrong" data-testid="verdict-wrong">
            <strong>{wrongSan} is not the move.</strong>
            <p>An engine check found one move here clearly better than every other. Recorded as missed; this position returns in your review queue.</p>
            {reply?.state === 'shown' && (
              <p data-testid="engine-reply">
                {reply.line
                  ? `After ${wrongSan} the built-in engine continues ${reply.line}. It is on the board: step back and on through it. This is the engine’s line for this position, not an explanation.`
                  : 'The built-in engine did not answer on this device, so no reply can be shown.'}
              </p>
            )}
          </div>
        )}
        {phase === 'solved' && (
          <div className={`verdict ${outcome === 'success' ? 'right' : 'neutral'}`} data-testid="verdict-solved">
            <strong>{outcome === 'success' ? 'Solved first try.' : replaying ? 'Solved on the second go.' : 'Solved.'}</strong>
            {run.acceptedAlternative && <p>Your checkmate differs from the source game’s move and is equally correct.</p>}
            {replaying && <p data-testid="replay-note">This go was practice. The first attempt stays recorded as {outcome === 'assisted' ? 'assisted' : 'missed'}; the position returns in your review queue.</p>}
            {!replaying && outcome === 'fail' && <p>Recorded as missed because the first move was wrong. It returns in your review queue.</p>}
            {!replaying && outcome === 'assisted' && <p>Recorded as assisted because a hint was used. It returns in your review queue.</p>}
          </div>
        )}
        {phase === 'revealed' && (
          <div className="verdict neutral" data-testid="verdict-revealed">
            <strong>Solution: {solutionSan}</strong>
            <p>Recorded as missed. It returns in your review queue.</p>
          </div>
        )}
      </div>

      {done && (
        <p className="provenance">
          {puzzle.themes.filter((t) => THEMES[t]).map((t) => THEMES[t]!.name).join(', ') || 'Puzzle'}; Lichess puzzle rating {puzzle.rating}.{' '}
          <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">Puzzle {puzzle.id} on Lichess</a>
        </p>
      )}

      <div className="actions">
        {phase === 'solving' && (
          <>
            {wrongSan && <button className="primary" disabled={!armed} onClick={() => { steps.reset(); setWrongSan(null); }}>Try again</button>}
            {wrongSan && steps.controls}
            {wrongSan && reply && reply.state !== 'shown' && <button data-testid="show-reply" disabled={reply.state === 'loading'} onClick={() => void showReply()}>{reply.state === 'loading' ? 'Asking the engine' : `What happens after ${wrongSan}?`}</button>}
            {allowHints && !wrongSan && <button onClick={hint} disabled={!armed || busy || marks.length > 0}>Show which piece</button>}
            {(wrongSan || outcome) && <button onClick={reveal} disabled={!armed || busy}>Show solution</button>}
            {/* A check is a fixed set of positions: skipping one would shrink it. */}
            {!outcome && props.context !== 'check' && <button className="quiet" data-testid="skip" disabled={!armed || busy} onClick={() => void skip()}>Skip</button>}
          </>
        )}
        {phase === 'revealed' && steps.controls}
        {/* A check is a fixed set of first tries: no second go there. */}
        {phase === 'revealed' && props.context !== 'check' && <button data-testid="replay" disabled={!armed} onClick={replay}>Now play it yourself</button>}
        {done && <button className="primary" data-testid="next" disabled={!armed} onClick={props.onNext}>{props.nextLabel ?? 'Next position'}</button>}
      </div>
    </section>
  );
}

function positionAfter(fen: string, uci: string): string {
  return fenOf(applyUci(positionFromFen(fen), uci));
}
