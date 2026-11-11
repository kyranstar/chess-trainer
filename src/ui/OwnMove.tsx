import { useEffect, useRef, useState } from 'react';
import { useDb, useFocusMode } from '../app/store';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { positionFromFen, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { bestLineFor } from '../engine/interactive';
import { lineEnd, lineSan, material } from '../games/analyse';
import { describeFree, describeLoose, gradeOwnMove, type MoveEvidence, type MoveItem, movePicture, type MovePicture, type MoveVerdict } from '../games/ownmove';
import { Board } from './Board';

type Phase = 'move' | 'predict' | 'checking' | 'done';
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
    if (pace <= 0 || phase !== 'move') return;
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
  const [result, setResult] = useState<{ verdict: MoveVerdict; line: string | null; wp: number | null } | null>(null);
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
    const line = positionFromFen(f.afterFen).isEnd() ? null : await bestLineFor(f.afterFen);
    let evidence: MoveEvidence | null = null;
    if (line) {
      const end = lineEnd(f.afterFen, line.pv, item.color);
      evidence = { loss: Math.max(0, item.bestWp - (100 - line.wp)), swing: end.balance - material(positionFromFen(item.fen), item.color), settled: end.settled };
    }
    const verdict = gradeOwnMove(f, evidence);
    setResult({ verdict, line: line && line.pv.length ? lineSan(f.afterFen, line.pv) : null, wp: line ? Math.round(100 - line.wp) : null });
    setPhase('done');
    if (recorded.current) return;
    recorded.current = true;
    const what = f.mateInOne ? 'mate' : f.loose.length ? 'loose' : 'none';
    const sawIt = !reply ? 'no-reply-named' : reply.uci === f.mateInOne?.uci || f.loose.some((l) => reply.uci.startsWith(`${l.by.from}${l.square}`)) ? 'named-it' : 'named-another';
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: item.id, exerciseKind: 'own-move', contentVersion: 'own-move-v2', conceptId: 'safety.threat-scan',
      themes: [
        'own-move', verdict, what, sawIt, `pace:${pace}`,
        ...(timedOut.current ? ['timeout'] : []),
        ...(f.mateBefore || f.freeBefore.length ? [f.tookFree || my.uci === f.mateBefore?.uci ? 'free-taken' : 'free-left'] : []),
        ...(f.threatsBefore.length ? [f.dealtWith.length === f.threatsBefore.length ? 'threat-met' : 'threat-left'] : []),
      ],
      rating: null, ts: Date.now(), elapsedMs: decisionMs.current, firstMove: my.uci, played: reply ? [my.uci, reply.uci] : [my.uci], mistakes: verdict === 'failed' ? 1 : 0, hints: 0,
      // A clean move made after the clock ran out is not a clean move at this pace: it is not scored.
      outcome: verdict === 'failed' ? 'fail' : verdict === 'clean' && !timedOut.current ? 'success' : 'skipped', acceptedAlternative: false,
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

  const gameSan = sanOf(positionFromFen(item.fen), item.played);
  const title = phase === 'move' ? `${me} to move. Play your move.` : phase === 'predict' ? `You played ${mine?.san}. Now play the reply you had to reckon with.` : phase === 'checking' ? 'Checking' : '';
  return (
    <section className="puzzle" data-testid="own-move" data-phase={phase} data-verdict={result?.verdict ?? ''} data-fen={fen}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        {title && <h2>{title}</h2>}
        <p className="muted">From your game on {item.date}, move {Math.floor(item.ply / 2) + 1}. An ordinary position: there may be nothing special in it.</p>
        {pace > 0 && phase === 'move' && (
          <p className={`move-clock${left === 0 ? ' is-up' : ''}`} data-testid="own-move-clock" data-left={Math.ceil(left)} role="timer">
            {left > 0 ? `${Math.ceil(left)} s for this move` : `No move in ${pace} seconds. Play it now; it is recorded as not made in time.`}
          </p>
        )}
      </header>
      <Board fen={fen} orientation={item.color} movable={phase === 'move' ? item.color : phase === 'predict' ? opponent : null} lastMove={lastMove} onMove={onMove} />
      <div className="feedback" aria-live="polite">
        {phase === 'checking' && <p className="muted">Looking at the position after your move</p>}
        {phase === 'done' && result && facts && mine && (
          <div className={`verdict ${result.verdict === 'clean' ? 'right' : result.verdict === 'failed' ? 'wrong' : 'neutral'}`} data-testid="own-move-verdict">
            <strong>
              {facts.mateInOne
                ? `${mine.san} allows mate in one: ${facts.mateInOne.san}.`
                : facts.loose.length === 0
                  ? `After ${mine.san} nothing of yours can be taken for nothing or by a cheaper piece, and there is no mate in one.`
                  : `After ${mine.san}:`}
            </strong>
            {facts.loose.map((l) => <p key={l.square} data-testid="own-move-loose">{describeLoose(l)}{facts.threatsBefore.some((t) => t.square === l.square) ? ' It could already be taken before your move.' : ''}</p>)}
            {facts.dealtWith.length > 0 && <p data-testid="own-move-met">Before your move {facts.dealtWith.length === 1 ? `your piece on ${facts.dealtWith[0]} could be taken` : `your pieces on ${facts.dealtWith.join(' and ')} could be taken`}; your move dealt with that.</p>}
            {facts.mateBefore && mine.uci !== facts.mateBefore.uci && <p data-testid="own-move-free">There was a mate in one: {facts.mateBefore.san}.</p>}
            {!facts.tookFree && !(facts.mateBefore && mine.uci === facts.mateBefore.uci) && facts.freeBefore.slice(0, 2).map((l) => <p key={`free-${l.square}`} data-testid="own-move-free">{describeFree(l)}</p>)}
            {timedOut.current && <p>The move was not made within {pace} seconds.</p>}
            {named && (facts.mateInOne || facts.loose.length > 0) && (
              <p>{named.uci === facts.mateInOne?.uci || facts.loose.some((l) => named.uci.startsWith(`${l.by.from}${l.square}`)) ? `You named it: ${named.san}.` : `You named ${named.san}.`}</p>
            )}
            {result.line && <p>The built-in engine continues {result.line} and then rates your side at {result.wp} out of 100; the best move it knew here kept about {Math.round(item.bestWp)}. This is the engine’s line, not an explanation.</p>}
            <p className="definition-small">
              {result.verdict === 'failed' ? 'Recorded as missed; it returns in your review queue.' : result.verdict === 'clean' ? 'Recorded as a clean move.' : 'Not scored: a piece that can be taken is a fact, not proof the move is bad, and the engine’s line does not settle it.'}
              {mine.uci !== item.played ? ` In the game you played ${gameSan}.` : ' This is the move you played in the game.'}
            </p>
          </div>
        )}
      </div>
      <div className="actions">
        {phase === 'predict' && facts && mine && <button data-testid="own-move-no-reply" disabled={!armed} onClick={() => void conclude(facts, mine, null)}>No particular reply</button>}
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
