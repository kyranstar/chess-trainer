import { useEffect, useRef, useState } from 'react';
import { useDb, useFocusMode } from '../app/store';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { bestLineFor } from '../engine/interactive';
import { DEVICE_NODES, lineSan } from '../games/analyse';
import { describeFree, describeLoose, GRADE_LABEL, gradeMove, type MoveGrade, type MoveItem, movePicture, type MovePicture, type MoveRating, outcomeOfGrade } from '../games/ownmove';
import { Board } from './Board';

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
  const [fen, setFen] = useState(item.fen);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [mine, setMine] = useState<{ uci: string; san: string } | null>(null);
  const [facts, setFacts] = useState<MovePicture | null>(null);
  // The clock runs only while the move is being chosen, and only while the app is on screen.
  const [left, setLeft] = useState(pace);
  const timedOut = useRef(false);
  const decisionMs = useRef(0);
  useEffect(() => {
    if (pace <= 0 || phase !== 'move' || retrying) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setLeft((x) => {
        const next = Math.max(0, x - 0.25);
        if (next === 0) timedOut.current = true;
        return next;
      });
    }, 250);
    return () => clearInterval(t);
  }, [pace, phase]);
  const [named, setNamed] = useState<{ uci: string; san: string } | null>(null);
  const [result, setResult] = useState<{ verdict: MoveGrade; line: string | null; wp: number | null; pv: string[]; loss: number | null; bestSan: string | null; bestWp: number | null } | null>(null);
  // The engine's first choice for the position is searched for while the learner thinks.
  const bestSearch = useRef<ReturnType<typeof bestLineFor> | null>(null);
  bestSearch.current ??= bestLineFor(item.fen, RATE_NODES);
  // After the answer the engine's line can be played through on the board, a move at a time.
  const [step, setStep] = useState(0);
  // A second try after seeing the facts is practice, not a result: it is never recorded.
  const [retrying, setRetrying] = useState(false);
  const started = useRef(Date.now());
  const recorded = useRef(false);
  useScreenChange(`${item.id}|${phase}`);
  const armed = useArmed();
  const me = item.color === 'white' ? 'White' : 'Black';
  const opponent = item.color === 'white' ? 'black' : 'white';

  // A position that was shown has been seen, answered or not.
  useEffect(() => {
    return () => {
      if (recorded.current || Date.now() - started.current < MIN_SHOWN_MS) return;
      recorded.current = true;
      void recordAttempt(db, {
        sessionId, context, exerciseId: item.id, exerciseKind: 'own-move', contentVersion: 'own-move-v1', conceptId: 'safety.threat-scan', themes: ['own-move', 'left'],
        rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'skipped', acceptedAlternative: false,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

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
    setStep(0);
    setPhase('done');
    if (recorded.current) return;
    recorded.current = true;
    const what = f.mateInOne ? 'mate' : f.loose.length ? 'loose' : 'none';
    const sawIt = !reply ? 'no-reply-named' : reply.uci === f.mateInOne?.uci || f.loose.some((l) => reply.uci.startsWith(`${l.by.from}${l.square}`)) ? 'named-it' : 'named-another';
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: item.id, exerciseKind: 'own-move', contentVersion: 'own-move-v3', conceptId: 'safety.threat-scan',
      themes: [
        'own-move', verdict, what, sawIt, `pace:${pace}`,
        ...(timedOut.current ? ['timeout'] : []),
        ...(f.mateBefore || f.freeBefore.length ? [f.tookFree || my.uci === f.mateBefore?.uci ? 'free-taken' : 'free-left'] : []),
        ...(f.threatsBefore.length ? [f.dealtWith.length === f.threatsBefore.length ? 'threat-met' : 'threat-left'] : []),
      ],
      rating: null, ts: Date.now(), elapsedMs: decisionMs.current, firstMove: my.uci, played: reply ? [my.uci, reply.uci] : [my.uci], mistakes: outcomeOfGrade(grade) === 'fail' ? 1 : 0, hints: 0,
      // A passing move made after the clock ran out is not a pass at this pace: it is not scored.
      outcome: outcomeOfGrade(grade) === 'success' && timedOut.current ? 'skipped' : outcomeOfGrade(grade), acceptedAlternative: false,
    });
    onRecorded?.(a);
  }

  function onMove(uci: string) {
    if (phase === 'move') {
      const my = { uci, san: sanOf(positionFromFen(item.fen), uci) };
      const f = movePicture(item.fen, uci);
      decisionMs.current = Date.now() - started.current;
      setMine(my);
      setFacts(f);
      setFen(f.afterFen);
      setLastMove(uci);
      // The move is committed at once. If it ended the game there is no reply to name.
      if (positionFromFen(f.afterFen).isEnd()) void conclude(f, my, null);
      else setPhase('predict');
    } else if (phase === 'predict' && facts && mine) {
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
    setStep(0);
  }
  // The position `step` moves into the engine's line (0 = right after the learner's move).
  const shown = (() => {
    if (phase !== 'done' || !facts || !result || step === 0) return { fen, last: lastMove };
    try {
      let pos = positionFromFen(facts.afterFen);
      for (const u of result.pv.slice(0, step)) pos = applyUci(pos, u);
      return { fen: fenOf(pos), last: result.pv[step - 1] ?? null };
    } catch {
      return { fen, last: lastMove };
    }
  })();
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
            {left > 0 ? `${Math.ceil(left)} s for this move` : `No move in ${pace} seconds. Play it now; it is recorded as not made in time.`}
          </p>
        )}
      </header>
      <Board fen={shown.fen} orientation={item.color} movable={phase === 'move' ? item.color : phase === 'predict' ? opponent : null} lastMove={shown.last} onMove={onMove} />
      <div className="feedback" aria-live="polite">
        {phase === 'checking' && <p className="muted">Looking at the position after your move</p>}
        {phase === 'done' && result && facts && mine && (
          <div className={`verdict ${result.verdict === 'best' || result.verdict === 'good' ? 'right' : result.verdict === 'mistake' || result.verdict === 'blunder' ? 'wrong' : 'neutral'}`} data-testid="own-move-verdict">
            <strong data-testid="own-move-grade">{GRADE_LABEL[result.verdict]}{timedOut.current ? ', not made in time' : ''}.</strong>
            <p data-testid="own-move-rating">
              {facts.mateInOne
                ? `${mine.san} allows mate in one: ${facts.mateInOne.san}.`
                : result.verdict === 'unrated'
                  ? `The built-in engine did not answer, so ${mine.san} is not rated.`
                  : result.verdict === 'best'
                    ? `${mine.san} is the built-in engine’s first choice (about ${result.bestWp} out of 100 for you).`
                    : `The built-in engine rates ${mine.san} ${result.loss ?? 0} point${result.loss === 1 ? '' : 's'} below its first choice, ${result.bestSan}: ${result.wp} against ${result.bestWp} out of 100.`}
            </p>
            {!facts.mateInOne && facts.loose.length === 0 && <p>After {mine.san} nothing of yours can be taken for nothing or by a cheaper piece, and there is no mate in one.</p>}
            {facts.loose.map((l) => <p key={l.square} data-testid="own-move-loose">{describeLoose(l)}{facts.threatsBefore.some((t) => t.square === l.square) ? ' It could already be taken before your move.' : ''}</p>)}
            {facts.dealtWith.length > 0 && <p data-testid="own-move-met">Before your move {facts.dealtWith.length === 1 ? `your piece on ${facts.dealtWith[0]} could be taken` : `your pieces on ${facts.dealtWith.join(' and ')} could be taken`}; your move dealt with that.</p>}
            {facts.mateBefore && mine.uci !== facts.mateBefore.uci && <p data-testid="own-move-free">There was a mate in one: {facts.mateBefore.san}.</p>}
            {!facts.tookFree && !(facts.mateBefore && mine.uci === facts.mateBefore.uci) && facts.freeBefore.slice(0, 2).map((l) => <p key={`free-${l.square}`} data-testid="own-move-free">{describeFree(l)}</p>)}
            {timedOut.current && <p>The move was not made within {pace} seconds.</p>}
            {named && (facts.mateInOne || facts.loose.length > 0) && (
              <p>{named.uci === facts.mateInOne?.uci || facts.loose.some((l) => named.uci.startsWith(`${l.by.from}${l.square}`)) ? `You named it: ${named.san}.` : `You named ${named.san}.`}</p>
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
        {phase === 'done' && result && result.pv.length > 0 && (
          <span className="line-steps" data-testid="own-move-line" data-step={step}>
            <button data-testid="line-prev" disabled={step === 0} onClick={() => setStep((x) => Math.max(0, x - 1))} aria-label="One move back in the engine’s line">Back</button>
            <button data-testid="line-next" disabled={step >= result.pv.length} onClick={() => setStep((x) => Math.min(result.pv.length, x + 1))} aria-label="One move on in the engine’s line">{step === 0 ? 'Play the engine’s line' : 'On'}</button>
          </span>
        )}
        {phase === 'done' && result && result.verdict !== 'best' && result.verdict !== 'good' && <button data-testid="own-move-retry" disabled={!armed} onClick={retry}>Take it back and try another move</button>}
        {phase === 'done' && <button className="primary" data-testid="own-move-next" disabled={!armed} onClick={onDone}>Continue</button>}
      </div>
    </section>
  );
}

/** "Your move" on its own: positions not yet tried, newest games first, each chosen once and kept. */
export function OwnMoveRun({ items, done, pace, onFinished }: { items: MoveItem[] | null; done: Set<string>; pace: number; onFinished: () => void }) {
  const [n, setN] = useState(0);
  // The pace is fixed with the item: recording an answer may move the ladder, but not under a position on screen.
  const latch = useRef<{ n: number; item: MoveItem; pace: number } | null>(null);
  const shown = useRef(new Set<string>());
  if (!items) return <p className="muted">Loading your games</p>;
  if (latch.current?.n !== n) {
    // Newest game first; within a game, in the order the positions arose.
    const next = items.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.gameId === b.gameId ? a.ply - b.ply : a.gameId < b.gameId ? -1 : 1)).find((m) => !done.has(m.id) && !shown.current.has(m.id));
    if (next) {
      latch.current = { n, item: next, pace };
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
