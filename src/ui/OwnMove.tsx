import { useEffect, useMemo, useRef, useState } from 'react';
import { useDb, useFocusMode } from '../app/store';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { fenAfter, isLegalUci, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { lineAt, mergeLines } from '../chess/line';
import { bestLineFor } from '../engine/interactive';
import { DEVICE_NODES } from '../games/analyse';
import { freeTag, GRADE_MARK, gradeHeadline, gradeMove, isPunishingReply, type MoveGrade, type MoveItem, movePicture, type MovePicture, type MoveRating, outcomeOfGrade, reallyLoose } from '../games/ownmove';
import { isTimed, TIMED_SECONDS } from '../schedule/pace';
import { Board } from './Board';
import { useResultLines } from './Lines';
import { Ask, gameRef, KeepLast, useItem } from './Stage';

type Phase = 'move' | 'predict' | 'checking' | 'done';
/** Both searches behind a rating use the same budget as the game analysis on this device. */
const RATE_NODES = DEVICE_NODES;
const MIN_SHOWN_MS = 1000;

/**
 * "Your move": play your own move in a position from one of your games, then the reply you
 * had to reckon with. The result is the move's rating in a word and three moves side by side
 * on the board: yours, the one you played in the game, and the engine's first choice, each
 * with what follows it (see ./Lines.tsx). See src/games/ownmove.ts for what is scored.
 */
export function OwnMoveDrill({ item, sessionId, context, pace = 0, onRecorded, onDone }: {
  item: MoveItem; sessionId: string | null; context: AttemptContext; onRecorded?: (a: Attempt) => void; onDone: () => void;
  /** Seconds allowed for choosing the move (see src/schedule/pace.ts); 0 = no clock. */
  pace?: number;
}) {
  const db = useDb();
  useFocusMode();
  const stage = useItem(onDone);
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
  const activeRef = useRef(stage.active);
  activeRef.current = stage.active;
  const lastTick = useRef(performance.now());
  useEffect(() => {
    visibleMs.current = 0;
    lastTick.current = performance.now();
    if (phase !== 'move' && phase !== 'predict') return;
    const t = setInterval(() => {
      const now = performance.now();
      // Time spent looking back at the last position is not time spent on this one.
      if (document.visibilityState === 'visible' && activeRef.current) visibleMs.current += now - lastTick.current;
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
  const [result, setResult] = useState<{
    verdict: MoveGrade; wp: number | null; pv: string[]; captureCost: number | null;
    best: { uci: string; wp: number; pv: string[] } | null; game: { wp: number | null; pv: string[] | null };
  } | null>(null);
  // The engine's first choice for the position is searched for while the learner thinks, and
  // after it the reply to the move he played in the game, so that all three are there to compare.
  const bestSearch = useRef<ReturnType<typeof bestLineFor> | null>(null);
  bestSearch.current ??= bestLineFor(item.fen, RATE_NODES);
  const gameSearch = useRef<ReturnType<typeof bestLineFor> | null>(null);
  gameSearch.current ??= (() => {
    try {
      const after = fenAfter(item.fen, [item.played]);
      return positionFromFen(after).isEnd() ? Promise.resolve(null) : bestLineFor(after, RATE_NODES);
    } catch {
      return Promise.resolve(null);
    }
  })();
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
    // A third when something of his can be taken afterwards: what that capture is worth to the
    // opponent, so that "can be taken" is not left standing beside a piece that is not really hanging.
    const captureUci = f.mateInOne ? null : f.captures.map((c) => (isLegalUci(end, c) ? c : isLegalUci(end, `${c}q`) ? `${c}q` : null)).find((c): c is string => !!c) ?? null;
    // His move is the one from the game as often as not: that search is already running.
    const asInGame = sameMove(start, my.uci, item.played);
    const [best, line, afterCapture, afterGame] = await Promise.all([
      bestSearch.current,
      end.isEnd() ? Promise.resolve(null) : asInGame ? gameSearch.current : bestLineFor(f.afterFen, RATE_NODES),
      captureUci && f.loose.length ? bestLineFor(lineAt(f.afterFen, [captureUci], 1).fen, RATE_NODES) : Promise.resolve(null),
      gameSearch.current,
    ]);
    // Points of expected score the capture gives up for the opponent against his best reply.
    const captureCost = line && afterCapture ? Math.round(line.wp - (100 - afterCapture.wp)) : null;
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
      captureCost, verdict, wp: myWp,
      // With no answer from the engine a mate in one that the move allows is still known, and shown.
      pv: line?.pv.length ? line.pv.slice(0, 10) : f.mateInOne ? [f.mateInOne.uci] : [],
      best: best && bestUci ? { uci: bestUci, wp: best.wp, pv: best.pv.slice(1, 11) } : null,
      game: { wp: afterGame ? 100 - afterGame.wp : null, pv: afterGame ? afterGame.pv.slice(0, 10) : null },
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
        ...[freeTag(f, my.uci, bestUci ?? null)].filter((t): t is NonNullable<typeof t> => !!t),
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
  }
  // Whether the engine's own reply is to take what can be taken.
  const engineTakes = !!facts && !!result && !!result.pv[0] && facts.captures.includes(result.pv[0].slice(0, 4));
  // The three moves to compare, once the answer is in: his, the game's, the engine's.
  const lines = useMemo(() => (phase === 'done' && result && mine ? mergeLines(item.fen, [
    { who: 'you', uci: mine.uci, score: result.wp, pv: result.pv },
    { who: 'game', uci: item.played, score: result.game.wp, pv: result.game.pv },
    ...(result.best ? [{ who: 'best' as const, uci: result.best.uci, score: result.best.wp, pv: result.best.pv }] : []),
  ]) : []), [phase, result, mine, item.fen, item.played]);
  const shownLines = useResultLines(phase === 'done' && lines.length ? item.fen : null, lines, { me: item.color, compare: true, nodes: RATE_NODES, testid: 'own-move-line' });
  const onMine = !!shownLines.selected?.who.includes('you') && shownLines.step === 1;
  // A piece of his that can now be taken is ringed on the board, with a thin arrow from what
  // takes it, while his move stands there: only if it is really hanging (see reallyLoose).
  const loose = result && facts && facts.loose.length > 0 && !facts.mateInOne && reallyLoose({ engineTakes, captureCost: result.captureCost }) ? facts.loose : [];
  const mark = result ? GRADE_MARK[result.verdict] : null;
  const shown = phase === 'done' && shownLines.board
    ? { fen: shownLines.board.fen, last: shownLines.board.lastMove, marks: shownLines.board.marks, arrows: shownLines.board.arrows, line: shownLines.board.line }
    : { fen, last: lastMove, marks: [] as string[], arrows: [], line: null };
  // The engine's reply to his move, to set beside the reply he named.
  const replySan = (() => {
    try {
      return facts && result?.pv[0] ? sanOf(positionFromFen(facts.afterFen), result.pv[0]) : null;
    } catch {
      return null;
    }
  })();
  const them = item.color === 'white' ? 'Black' : 'White';
  const source = gameRef(item.date, item.ply);
  const good = result?.verdict === 'best' || result?.verdict === 'good';
  const bad = result?.verdict === 'mistake' || result?.verdict === 'blunder';
  return (
    <section className="puzzle" data-testid="own-move" data-phase={phase} data-verdict={result?.verdict ?? ''} data-fen={fen} data-loose={loose.map((l) => l.square).join(' ')}>
      <Board
        fen={shown.fen} orientation={item.color} movable={phase === 'move' ? item.color : phase === 'predict' ? opponent : null} lastMove={shown.last} marks={shown.marks} onMove={onMove}
        arrows={shown.arrows} line={shown.line}
        rings={onMine ? loose.map((l) => ({ square: l.square, from: l.by.from })) : []}
        badge={onMine && mark && mine ? { square: mine.uci.slice(2, 4), ...mark } : null}
        flash={phase === 'done' && result ? `${good ? 'right' : bad ? 'wrong' : 'none'}:${item.id}:${retrying}` : null}
      />
      <div className="say" aria-live="polite">
        {phase === 'move' && (
          <Ask title={`${me} to move`} meta={retrying ? <span data-testid="own-move-retry-note">Second try: not recorded.</span> : `Play your own move. ${source}.`}>
            {pace > 0 && !retrying && (
              <p className={`ask-meta move-clock${left === 0 ? ' is-up' : ''}`} data-testid="own-move-clock" data-left={Math.ceil(left)} role="timer">
                {left > 0 ? `${Math.ceil(left)} s for this move` : `Over ${pace} s: take your time, it is noted as late.`}
              </p>
            )}
          </Ask>
        )}
        {(phase === 'predict' || phase === 'checking') && (
          <Ask title={`${them}’s reply to ${mine?.san}?`} meta={phase === 'checking' ? 'Checking your move' : 'Play the reply you had to reckon with.'} />
        )}
        {phase === 'done' && result && facts && mine && (
          <div className="result" data-testid="own-move-verdict">
            <p className="result-head">
              {mark && <span className={`grade-mark is-${mark.tone}`} aria-hidden>{mark.text}</span>}
              <strong data-testid="own-move-grade">{gradeHeadline({ grade: result.verdict, late: timedOut.current ? pace : null })}</strong>
              {!good && <button className="result-side" data-testid="own-move-retry" disabled={!armed} onClick={retry}>Try another move</button>}
            </p>
            {shownLines.chips}
            {shownLines.ribbon}
            {shownLines.note}
            {facts.mateInOne && facts.mateUnavoidable && <p>Every move allowed mate in one ({facts.mateInOne.san}).</p>}
            {named && !shownLines.selected && (replySan && sameMove(positionFromFen(facts.afterFen), named.uci, result.pv[0]!)
              ? <p className="muted" data-testid="own-move-named">You named the reply: {named.san}.</p>
              : <p className="muted" data-testid="own-move-named">You expected {named.san}{replySan ? `; the engine plays ${replySan}` : ''}.</p>)}
          </div>
        )}
      </div>
      <div className="actions dock">
        {phase === 'predict' && facts && mine && <button data-testid="own-move-no-reply" disabled={!armed} onClick={() => void conclude(facts, mine, null)}>No particular reply</button>}
        {phase === 'done' && <button className="primary" data-testid="own-move-next" disabled={!armed} onClick={stage.next}>{stage.nextLabel ?? 'Next'}</button>}
      </div>
    </section>
  );
}

/** "Your move" on its own: positions not yet tried, newest games first, each chosen once and kept. */
export function OwnMoveRun({ items, done, met, pace, onFinished }: {
  items: MoveItem[] | null; done: Set<string>;
  /** Positions already met in any exercise ("<game>:<ply>"): not asked again as new ones. */
  met?: Set<string>;
  /** A clock for every position, for trying one out; normally null. */
  pace: number | null; onFinished: () => void;
}) {
  const [n, setN] = useState(0);
  const latch = useRef<{ n: number; item: MoveItem; pace: number } | null>(null);
  const shown = useRef(new Set<string>());
  if (!items) return <p className="muted">Loading your games</p>;
  if (latch.current?.n !== n) {
    // Newest game first; within a game, in the order the positions arose.
    const next = items.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.gameId === b.gameId ? a.ply - b.ply : a.gameId < b.gameId ? -1 : 1)).find((m) => !done.has(m.id) && !shown.current.has(m.id) && !met?.has(`${m.gameId}:${m.ply}`));
    if (next) {
      latch.current = { n, item: next, pace: pace ?? (isTimed(next.id) ? TIMED_SECONDS : 0) };
      shown.current.add(next.id);
    } else latch.current = null;
  }
  const item = latch.current?.item;
  return (
    <KeepLast>
      {item ? <OwnMoveDrill key={item.id} item={item} sessionId={null} context="practice" pace={latch.current!.pace} onDone={() => setN((x) => x + 1)} /> : (
        <div className="empty" data-testid="own-move-done">
          <p>{items.length === 0 ? 'These positions come from your own games at moves 10 to 19, once the games have been fetched and analysed on this device. There are none yet.' : 'No untried positions are left for now; more appear as you play.'}</p>
          <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
        </div>
      )}
    </KeepLast>
  );
}
