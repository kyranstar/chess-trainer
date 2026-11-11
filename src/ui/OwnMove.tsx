import { useEffect, useRef, useState } from 'react';
import { useDb, useFocusMode } from '../app/store';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { isLegalUci, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { lineAt } from '../chess/line';
import { bestLineFor } from '../engine/interactive';
import { DEVICE_NODES, lineSan } from '../games/analyse';
import { describeFree, describeLoose, GRADE_LABEL, gradeMove, isPunishingReply, type MoveGrade, type MoveItem, movePicture, type MovePicture, type MoveRating, outcomeOfGrade } from '../games/ownmove';
import { isTimed, TIMED_SECONDS } from '../schedule/pace';
import { Board } from './Board';
import { useLineSteps } from './LineSteps';

type Phase = 'move' | 'predict' | 'checking' | 'done';
/** Both searches behind a rating use the same budget as the game analysis on this device. */
const RATE_NODES = DEVICE_NODES;
const MIN_SHOWN_MS = 1000;

/**
 * "Your move": play your own move in a position from one of your games, then the reply you
 * had to reckon with. The app answers with exact facts about captures and mate in one, and
 * the engine's line as evidence. See src/games/ownmove.ts for what is and is not scored.
 */
export function OwnMoveDrill({ item, sessionId, context, heading, pace = 0, onRecorded, onDone }: {
  item: MoveItem; sessionId: string | null; context: AttemptContext; heading?: string; onRecorded?: (a: Attempt) => void; onDone: () => void;
  /** Seconds allowed for choosing the move (see src/schedule/pace.ts); 0 = no clock. */
  pace?: number;
}) {
  const db = useDb();
  useFocusMode();
  const [phase, setPhase] = useState<Phase>('move');
  const phaseRef = useRef<Phase>('move');
  phaseRef.current = phase;
  const [fen, setFen] = useState(item.fen);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [mine, setMine] = useState<{ uci: string; san: string } | null>(null);
  const [facts, setFacts] = useState<MovePicture | null>(null);
  // The clock runs only while the move is being chosen, and only while the app is on screen.
  const [retrying, setRetrying] = useState(false);
  const [left, setLeft] = useState(pace);
  const timedOut = useRef(false);
  const decisionMs = useRef(0);
  const replyMs = useRef<number | null>(null);
  // Time is measured, not counted in ticks: the milliseconds the app has been on screen in
  // this phase. A slow tick cannot give extra time, and time in the background is not counted.
  const visibleMs = useRef(0);
  const lastTick = useRef(performance.now());
  useEffect(() => {
    visibleMs.current = 0;
    lastTick.current = performance.now();
    if (phase !== 'move' && phase !== 'predict') return;
    const t = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === 'visible') visibleMs.current += now - lastTick.current;
      lastTick.current = now;
      if (phase === 'move' && pace > 0 && !retrying) {
        const remaining = Math.max(0, pace - visibleMs.current / 1000);
        if (remaining === 0) timedOut.current = true;
        setLeft(remaining);
      }
    }, 250);
    return () => clearInterval(t);
  }, [pace, phase, retrying]);
  const elapsedInPhase = () => Math.round(visibleMs.current + (document.visibilityState === 'visible' ? performance.now() - lastTick.current : 0));
  const [named, setNamed] = useState<{ uci: string; san: string } | null>(null);
  const [result, setResult] = useState<{ verdict: MoveGrade; line: string | null; wp: number | null; pv: string[]; loss: number | null; bestSan: string | null; bestWp: number | null } | null>(null);
  // The engine's first choice for the position is searched for while the learner thinks.
  const bestSearch = useRef<ReturnType<typeof bestLineFor> | null>(null);
  bestSearch.current ??= bestLineFor(item.fen, RATE_NODES);
  // After the answer a line can be played through on the board, a move at a time: the
  // engine's own, or (asked for) what happens if the piece that can be taken is taken.
  const [taken, setTaken] = useState<{ state: 'loading' } | { state: 'shown'; pv: string[]; san: string } | null>(null);
  // A second try after seeing the facts is practice, not a result: it is never recorded.
  const recorded = useRef(false);
  useScreenChange(`${item.id}|${phase}`);
  const armed = useArmed();
  const me = item.color === 'white' ? 'White' : 'Black';
  const opponent = item.color === 'white' ? 'black' : 'white';

  // A position that was shown has been seen, answered or not. That is written down while it
  // is still on screen (not on leaving: a reload or a closed app never gets that far), so the
  // position can never come back later as a first look. The answer replaces this row.
  const exposure = useRef<Promise<Attempt> | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (recorded.current || exposure.current) return;
      exposure.current = recordAttempt(db, {
        sessionId, context, exerciseId: item.id, exerciseKind: 'own-move', contentVersion: 'own-move-v3', conceptId: 'safety.threat-scan', themes: ['own-move', 'left'],
        rating: null, ts: Date.now(), elapsedMs: MIN_SHOWN_MS, firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'skipped', acceptedAlternative: false,
      });
    }, MIN_SHOWN_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  // Hiding the page stops the clock but not the thinking: such an answer is practice and is
  // kept out of the timed comparison.
  const interrupted = useRef(false);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'visible' && phaseRef.current === 'move' && !recorded.current) interrupted.current = true;
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  async function conclude(f: MovePicture, my: { uci: string; san: string }, reply: { uci: string; san: string } | null) {
    setPhase('checking');
    const start = positionFromFen(item.fen);
    const end = positionFromFen(f.afterFen);
    // Two searches at the same budget: the position itself (begun when it appeared, so it is
    // usually ready) and the position after his move.
    const [best, line] = await Promise.all([bestSearch.current, end.isEnd() ? Promise.resolve(null) : bestLineFor(f.afterFen, RATE_NODES)]);
    let rating: MoveRating | null = null;
    let myWp: number | null = null;
    const bestUci = best?.pv[0];
    if (best && bestUci) {
      myWp = end.isCheckmate() ? 100 : end.isEnd() ? 50 : line ? 100 - line.wp : null;
      const isBest = sameMove(start, my.uci, bestUci);
      rating = isBest ? { loss: 0, isBest } : myWp === null ? null : { loss: Math.max(0, best.wp - myWp), isBest };
    }
    const grade = gradeMove(f, rating, my.uci);
    const verdict = grade;
    setResult({
      verdict, line: line && line.pv.length ? lineSan(f.afterFen, line.pv) : null, wp: myWp === null ? null : Math.round(myWp), pv: line ? line.pv.slice(0, 6) : [],
      loss: rating ? Math.round(rating.loss) : null, bestSan: best && bestUci ? sanOf(start, bestUci) : null, bestWp: best ? Math.round(best.wp) : null,
    });
    setPhase('done');
    if (recorded.current) return;
    recorded.current = true;
    const what = f.mateInOne ? 'mate' : f.loose.length ? 'loose' : 'none';
    const sawIt = !reply ? 'no-reply-named' : isPunishingReply(f, reply.uci) ? 'named-it' : 'named-another';
    // The answer takes the place of the "shown" row written while the position was on screen.
    if (exposure.current) await db.attempts.delete((await exposure.current).uuid);
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: item.id, exerciseKind: 'own-move', contentVersion: 'own-move-v3', conceptId: 'safety.threat-scan',
      themes: [
        'own-move', verdict, what, sawIt, `pace:${pace}`,
        ...(timedOut.current ? ['late'] : []),
        ...(interrupted.current ? ['interrupted'] : []),
        ...(replyMs.current !== null ? [`reply-ms:${replyMs.current}`] : []),
        ...(f.mateBefore || f.freeBefore.length ? [f.tookFree || my.uci === f.mateBefore?.uci ? 'free-taken' : 'free-left'] : []),
        ...(f.threatsBefore.length ? [f.dealtWith.length === f.threatsBefore.length ? 'threat-met' : 'threat-left'] : []),
      ],
      rating: null, ts: Date.now(), elapsedMs: decisionMs.current, firstMove: my.uci, played: reply ? [my.uci, reply.uci] : [my.uci], mistakes: outcomeOfGrade(grade) === 'fail' ? 1 : 0, hints: 0,
      // Running over the allowance does not change the rating; it is stored beside it ('late').
      outcome: outcomeOfGrade(grade), acceptedAlternative: false,
    });
    onRecorded?.(a);
  }

  function onMove(uci: string) {
    if (phase === 'move') {
      const my = { uci, san: sanOf(positionFromFen(item.fen), uci) };
      const f = movePicture(item.fen, uci);
      decisionMs.current = elapsedInPhase();
      if (pace > 0 && !retrying && decisionMs.current > pace * 1000) timedOut.current = true;
      setMine(my);
      setFacts(f);
      setFen(f.afterFen);
      setLastMove(uci);
      // The move is committed at once. If it ended the game there is no reply to name.
      if (positionFromFen(f.afterFen).isEnd()) void conclude(f, my, null);
      else setPhase('predict');
    } else if (phase === 'predict' && facts && mine) {
      replyMs.current = elapsedInPhase();
      const reply = { uci, san: sanOf(positionFromFen(facts.afterFen), uci) };
      setNamed(reply);
      void conclude(facts, mine, reply);
    }
  }

  function retry() {
    setRetrying(true);
    setPhase('move');
    setFen(item.fen);
    setLastMove(null);
    setMine(null);
    setFacts(null);
    setNamed(null);
    setResult(null);
    setTaken(null);
  }
  // The capture the facts speak of, as a move that can be played (a capture that promotes gets its queen).
  const capture = (() => {
    if (!facts || facts.mateInOne) return null;
    const pos = positionFromFen(facts.afterFen);
    for (const c of facts.captures) {
      const uci = isLegalUci(pos, c) ? c : isLegalUci(pos, `${c}q`) ? `${c}q` : null;
      if (uci) return uci;
    }
    return null;
  })();
  // Whether the engine's own reply is to take what can be taken.
  const engineTakes = !!facts && !!result && !!result.pv[0] && facts.captures.includes(result.pv[0].slice(0, 4));
  async function showTaken() {
    if (!facts || !capture || taken) return;
    setTaken({ state: 'loading' });
    const pos = positionFromFen(facts.afterFen);
    const san = sanOf(pos, capture);
    const after = lineAt(facts.afterFen, [capture], 1).fen;
    const best = await bestLineFor(after, RATE_NODES);
    setTaken({ state: 'shown', pv: [capture, ...(best?.pv.slice(0, 5) ?? [])], san });
  }
  const line = phase === 'done' && facts && result ? (taken?.state === 'shown' ? { from: facts.afterFen, pv: taken.pv } : { from: facts.afterFen, pv: result.pv }) : null;
  const steps = useLineSteps(line, taken?.state === 'shown' ? { initial: 1, testid: 'own-move-line' } : { initial: 0, startLabel: 'Play the engine’s line', testid: 'own-move-line' });
  const shown = steps.pos && steps.step > 0 ? { fen: steps.pos.fen, last: steps.pos.last } : { fen, last: lastMove };
  const passed = result ? outcomeOfGrade(result.verdict) === 'success' : false;
  const gameSan = sanOf(positionFromFen(item.fen), item.played);
  const title = phase === 'move' ? `${me} to move. Play your move.` : phase === 'predict' ? `You played ${mine?.san}. Now play the reply you had to reckon with.` : phase === 'checking' ? 'Checking' : '';
  return (
    <section className="puzzle" data-testid="own-move" data-phase={phase} data-verdict={result?.verdict ?? ''} data-fen={fen}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        {title && <h2>{title}</h2>}
        <p className="muted">From your game on {item.date}, move {Math.floor(item.ply / 2) + 1}. An ordinary position: there may be nothing special in it.</p>
        {retrying && phase !== 'done' && <p className="muted" data-testid="own-move-retry-note">Second try. This one is not recorded.</p>}
        {pace > 0 && phase === 'move' && !retrying && (
          <p className={`move-clock${left === 0 ? ' is-up' : ''}`} data-testid="own-move-clock" data-left={Math.ceil(left)} role="timer">
            {left > 0 ? `${Math.ceil(left)} s for this move` : `${pace} seconds are up. Take the time you need; the move is rated as usual and noted as late.`}
          </p>
        )}
      </header>
      <Board fen={shown.fen} orientation={item.color} movable={phase === 'move' ? item.color : phase === 'predict' ? opponent : null} lastMove={shown.last} onMove={onMove} />
      <div className="feedback" aria-live="polite">
        {phase === 'checking' && <p className="muted">Looking at the position after your move</p>}
        {phase === 'done' && result && facts && mine && (
          <div className={`verdict ${result.verdict === 'best' || result.verdict === 'good' ? 'right' : result.verdict === 'mistake' || result.verdict === 'blunder' ? 'wrong' : 'neutral'}`} data-testid="own-move-verdict">
            <strong data-testid="own-move-grade">{GRADE_LABEL[result.verdict]}{timedOut.current ? `, made after the ${pace} seconds` : ''}.</strong>
            <p data-testid="own-move-rating">
              {facts.mateInOne && !facts.mateUnavoidable
                ? `${mine.san} allows mate in one: ${facts.mateInOne.san}.`
                : result.verdict === 'unrated'
                  ? `The built-in engine did not answer, so ${mine.san} is not rated.`
                  : result.verdict === 'best'
                    ? `${mine.san} is the built-in engine’s first choice (about ${result.bestWp} out of 100 for you).`
                    : `The built-in engine rates ${mine.san} ${result.loss ?? 0} point${result.loss === 1 ? '' : 's'} below its first choice, ${result.bestSan}: ${result.wp} against ${result.bestWp} out of 100.`}
            </p>
            {facts.mateInOne && facts.mateUnavoidable && <p>Mate in one follows ({facts.mateInOne.san}), but every legal move allowed one.</p>}
            {!facts.mateInOne && facts.loose.length === 0 && <p>After {mine.san} no piece of yours can be taken without an immediate recapture or by a cheaper piece, and there is no mate in one.</p>}
            {facts.loose.map((l) => <p key={l.square} data-testid="own-move-loose">{describeLoose(l)}{facts.threatsBefore.some((t) => t.square === l.square) ? ' It could already be taken before your move.' : ''}</p>)}
            {facts.loose.length > 0 && !facts.mateInOne && result.verdict !== 'unrated' && (
              <p data-testid="own-move-loose-note">
                {passed
                  ? engineTakes
                    ? 'That it can be taken is a fact about the board, not the rating. The engine does take it in its line and still rates your move as above: play the line through to see what you get for it.'
                    : 'That it can be taken is a fact about the board, not the rating. The engine does not take it: by its reckoning the capture is not your opponent’s best move. That alone does not show the capture is harmless; “If it is taken” plays it out on the board.'
                  : engineTakes
                    ? 'The engine’s line takes it. Play the line through to see where the material goes.'
                    : 'The engine’s line starts with a different move, so the rating may be about something else than this piece. “If it is taken” plays the capture out on the board.'}
              </p>
            )}
            {taken?.state === 'shown' && <p data-testid="own-move-taken">On the board: {taken.san}, and the engine’s line from there{taken.pv.length > 1 ? ` (${lineSan(lineAt(facts.afterFen, taken.pv.slice(0, 1), 1).fen, taken.pv.slice(1))})` : ''}. Step back and on through it.</p>}
            {facts.dealtWith.length > 0 && <p data-testid="own-move-met">Before your move {facts.dealtWith.length === 1 ? `your piece on ${facts.dealtWith[0]} could be taken` : `your pieces on ${facts.dealtWith.join(' and ')} could be taken`}; after your move that capture is no longer there.</p>}
            {facts.mateBefore && mine.uci !== facts.mateBefore.uci && <p data-testid="own-move-free">There was a mate in one: {facts.mateBefore.san}.</p>}
            {!facts.tookFree && !(facts.mateBefore && mine.uci === facts.mateBefore.uci) && facts.freeBefore.slice(0, 2).map((l) => <p key={`free-${l.square}`} data-testid="own-move-free">{describeFree(l)}</p>)}
            {named && (facts.mateInOne || facts.loose.length > 0) && (
              <p>{isPunishingReply(facts, named.uci) ? `You named it: ${named.san}.` : `You named ${named.san}.`}</p>
            )}
            {result.line && <p>After {mine.san} the built-in engine continues {result.line}.</p>}
            <p className="definition-small">
              {result.verdict === 'mistake' || result.verdict === 'blunder' ? 'Recorded as a miss; it returns in your review queue.' : result.verdict === 'unrated' ? 'Not recorded as a pass or a miss.' : 'Recorded as a pass.'}
              {' '}Ratings are the built-in engine’s, a small one: under 5 points below its first choice is good, under 10 an inaccuracy, under 20 a mistake, more a blunder.
              {mine.uci !== item.played ? ` In the game you played ${gameSan}.` : ' This is the move you played in the game.'}
            </p>
          </div>
        )}
      </div>
      <div className="actions">
        {phase === 'predict' && facts && mine && <button data-testid="own-move-no-reply" disabled={!armed} onClick={() => void conclude(facts, mine, null)}>No particular reply</button>}
        {phase === 'done' && steps.controls}
        {phase === 'done' && result && capture && !engineTakes && facts && facts.loose.length > 0 && (
          taken?.state === 'shown'
            ? <button data-testid="own-move-engine-line" onClick={() => setTaken(null)}>Back to the engine’s line</button>
            : <button data-testid="own-move-if-taken" disabled={taken?.state === 'loading'} onClick={() => void showTaken()}>{taken?.state === 'loading' ? 'Asking the engine' : 'If it is taken'}</button>
        )}
        {phase === 'done' && result && result.verdict !== 'best' && result.verdict !== 'good' && <button data-testid="own-move-retry" disabled={!armed} onClick={retry}>Take it back and try another move</button>}
        {phase === 'done' && <button className="primary" data-testid="own-move-next" disabled={!armed} onClick={onDone}>Continue</button>}
      </div>
    </section>
  );
}

/** "Your move" on its own: positions not yet tried, newest games first, each chosen once and kept. */
export function OwnMoveRun({ items, done, pace, onFinished }: { items: MoveItem[] | null; done: Set<string>; /** A clock for every position, for trying one out; normally null. */ pace: number | null; onFinished: () => void }) {
  const [n, setN] = useState(0);
  const latch = useRef<{ n: number; item: MoveItem; pace: number } | null>(null);
  const shown = useRef(new Set<string>());
  if (!items) return <p className="muted">Loading your games</p>;
  if (latch.current?.n !== n) {
    // Newest game first; within a game, in the order the positions arose.
    const next = items.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.gameId === b.gameId ? a.ply - b.ply : a.gameId < b.gameId ? -1 : 1)).find((m) => !done.has(m.id) && !shown.current.has(m.id));
    if (next) {
      latch.current = { n, item: next, pace: pace ?? (isTimed(next.id) ? TIMED_SECONDS : 0) };
      shown.current.add(next.id);
    } else latch.current = null;
  }
  const item = latch.current?.item;
  if (!item) {
    return (
      <div className="empty" data-testid="own-move-done">
        <p>{items.length === 0 ? 'These positions come from your own games at moves 10 to 19, once the games have been fetched and analysed on this device. There are none yet.' : 'No untried positions are left for now; more appear as you play.'}</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
      </div>
    );
  }
  return <OwnMoveDrill key={item.id} item={item} sessionId={null} context="practice" heading="Your move" pace={latch.current!.pace} onDone={() => setN((x) => x + 1)} />;
}
