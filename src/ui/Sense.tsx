import { useEffect, useMemo, useRef, useState } from 'react';
import { href } from '../app/router';
import { type Learner, useDb, useFocusMode } from '../app/store';
import { applyUci, fenOf, positionFromFen, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { bestLineFor } from '../engine/interactive';
import { chanceItems, gradeChance, gradeSafety, pickSense, safetyItems, type SenseGrade, type SenseItem, type SenseKind, senseThemes, verifyReply } from '../games/sense';
import type { GameRecord } from '../games/types';
import { Board } from './Board';
import { useGames } from './Games';
import { useArmed, useScreenChange } from '../app/tapGuard';

/** Controls come from move 7 on when there are enough of them: the first moves are not interesting. */
export function senseItemsFrom(games: GameRecord[]): SenseItem[] {
  const late = [...safetyItems(games, { minControlPly: 12 }), ...chanceItems(games, { minControlPly: 12 })];
  return late.filter((i) => !i.truth).length >= 20 ? late : [...safetyItems(games), ...chanceItems(games)];
}

/** A question by its id, from every question the games can supply (a review item may predate the "move 7 onwards" rule). */
export function senseItemById(games: GameRecord[], id: string): SenseItem | undefined {
  return [...safetyItems(games), ...chanceItems(games)].find((x) => x.id === id);
}

/** A question on screen for less than this was not really shown (a screen passing through). */
const MIN_SHOWN_MS = 1000;

type Phase = 'ask' | 'play' | 'checking' | 'done';

const RESULT_TITLE: Record<string, string> = {
  hit: 'Correct, and you found the move.',
  miss: 'There was something here.',
  'wrong-reply': 'Right that something is there; that move is not it.',
  'unverified-reply': 'Right that something is there. Your move could not be checked, so it is not scored.',
  'correct-rejection': 'Correct: nothing special here.',
  'false-alarm': 'Nothing was there.',
};

/** One yes/no question about a real position from the learner's own games. */
export function SenseDrill({ item, sessionId, context, heading, onRecorded, onDone }: {
  item: SenseItem; sessionId: string | null; context: AttemptContext; heading?: string; onRecorded?: (a: Attempt) => void; onDone: () => void;
}) {
  const db = useDb();
  useFocusMode();
  const safety = item.kind === 'safe-or-not';
  const opponent = item.color === 'white' ? 'black' : 'white';
  const [phase, setPhase] = useState<Phase>('ask');
  const [fen, setFen] = useState(item.fen);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [grade, setGrade] = useState<SenseGrade | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const started = useRef(Date.now());
  const me = item.color === 'white' ? 'White' : 'Black';
  useScreenChange(`${item.id}|${phase}`);
  const armed = useArmed();

  // A question that was shown has been seen: if the learner leaves before answering, record
  // it as skipped so it is never counted or asked as a first-time question later.
  const answered = useRef(false);
  useEffect(() => {
    return () => {
      if (answered.current || Date.now() - started.current < MIN_SHOWN_MS) return;
      answered.current = true;
      void recordAttempt(db, {
        sessionId, context, exerciseId: item.id, exerciseKind: 'sense', contentVersion: 'sense-v1', conceptId: 'safety.threat-scan',
        themes: [item.kind, item.kind === 'safe-or-not' ? (item.truth ? 'unsafe' : 'safe') : item.truth ? 'chance' : 'none', 'left'], rating: null, ts: Date.now(),
        elapsedMs: Date.now() - started.current, firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'skipped', acceptedAlternative: false,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function finish(g: SenseGrade, move: string | null) {
    answered.current = true;
    setGrade(g);
    setPhase('done');
    // Show the reference line's first move on the board when there was something to see.
    if (item.truth) {
      if (safety) {
        setFen(fenOf(applyUci(positionFromFen(item.afterFen!), item.replyUci!)));
        setLastMove(item.replyUci!);
      } else if (g.response !== 'hit' || !g.alternative) {
        setFen(fenOf(applyUci(positionFromFen(item.fen), item.best!)));
        setLastMove(item.best!);
      }
    }
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: item.id, exerciseKind: 'sense', contentVersion: 'sense-v1', conceptId: 'safety.threat-scan',
      themes: senseThemes(item, g), rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: move, played: move ? [move] : [],
      mistakes: g.correct ? 0 : 1, hints: 0, outcome: g.response === 'unverified-reply' ? 'skipped' : g.correct ? 'success' : 'fail', acceptedAlternative: !!g.alternative,
    });
    onRecorded?.(a);
  }

  function answer(yes: boolean) {
    if (safety) {
      if (!yes) return void finish(gradeSafety(item, 'safe', null), null);
      if (!item.truth) return void finish(gradeSafety(item, 'unsafe', null), null);
      setFen(item.afterFen!);
      setLastMove(item.proposed!);
    } else {
      if (!yes) return void finish(gradeChance(item, 'nothing', null), null);
      if (!item.truth) return void finish(gradeChance(item, 'something', null), null);
    }
    setPhase('play');
  }

  async function onMove(uci: string) {
    if (phase !== 'play') return;
    const before = positionFromFen(fen);
    setPlayedSan(sanOf(before, uci));
    const afterFen = fenOf(applyUci(before, uci));
    setFen(afterFen);
    setLastMove(uci);
    let g = safety ? gradeSafety(item, 'unsafe', uci) : gradeChance(item, 'something', uci);
    if (g.needsEngine) {
      // A different move from the stored one: judged by what it does on the board (mate, or
      // material at the end of the engine's line), never by the score alone. A mate needs no engine.
      let verified = verifyReply(item, uci, null);
      if (verified === 'unresolved') {
        setPhase('checking');
        verified = verifyReply(item, uci, await bestLineFor(afterFen));
      }
      g = safety ? gradeSafety(item, 'unsafe', uci, verified) : gradeChance(item, 'something', uci, verified);
    }
    await finish(g, uci);
  }

  const question = safety ? `You are ${me}. Is ${item.proposedSan} safe to play?` : `${me} to move. Is there something to win here?`;
  const mover = phase === 'play' ? (safety ? opponent : item.color) : null;
  return (
    <section className="puzzle" data-testid="sense-drill" data-kind={item.kind} data-truth={item.truth} data-phase={phase} data-expected={phase === 'play' ? (safety ? item.replyUci : item.best) : ''} data-response={grade?.response ?? ''}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>{phase === 'play' ? (safety ? 'Play the reply that punishes it' : 'Play it') : question}</h2>
        <p className="muted">From your game on {item.date}, move {Math.floor(item.ply / 2) + 1}. Many of these have nothing in them.</p>
      </header>
      <Board fen={fen} orientation={item.color} movable={mover} lastMove={lastMove} arrow={phase === 'ask' && safety ? item.proposed : null} onMove={(u) => void onMove(u)} />
      <div className="feedback" aria-live="polite">
        {phase === 'checking' && <p className="muted">Checking your move with the engine</p>}
        {grade && (
          <div className={`verdict ${grade.correct ? 'right' : grade.response === 'unverified-reply' ? 'neutral' : 'wrong'}`} data-testid="sense-verdict" data-correct={grade.correct}>
            <strong>{RESULT_TITLE[grade.response]}</strong>
            {item.truth && safety && <p>After {item.proposedSan} the engine’s reply is {item.replyLine}. In the game this move cost about {Math.round(item.loss ?? 0)} points of expected score.{grade.alternative ? ` Your reply ${playedSan} also wins material or mates, by the engine’s check.` : ''}</p>}
            {item.truth && !safety && <p>The engine’s line is {item.bestLine} (about {Math.round(item.bestWp ?? 0)}% expected score).{grade.alternative ? ` Your move ${playedSan} also mates or wins material, by the engine’s check.` : ''}</p>}
            {!item.truth && safety && <p>The engine found no reply to {item.proposedSan} that mates or wins any material in a short line. That is all “safe” means here.</p>}
            {!item.truth && !safety && <p>The engine’s best line here neither mates nor wins any material in a short line.</p>}
          </div>
        )}
      </div>
      <div className="actions">
        {phase === 'ask' && (
          <>
            <button className="primary" data-testid="sense-no" disabled={!armed} onClick={() => answer(false)}>{safety ? 'Safe to play' : 'Nothing special'}</button>
            <button className="primary" data-testid="sense-yes" disabled={!armed} onClick={() => answer(true)}>{safety ? 'It loses something' : 'There is something'}</button>
          </>
        )}
        {phase === 'done' && (
          <>
            <button className="primary" data-testid="sense-next" disabled={!armed} onClick={onDone}>Continue</button>
            {item.truth && <a className="button" href={href(`progress/game-event/${item.gameId}/${item.ply}`)}>See it in the game</a>}
          </>
        )}
      </div>
    </section>
  );
}

/** Stream of unseen game-sense questions, alternating the two kinds. */
export function SenseRun({ learner, onFinished }: { learner: Learner; onFinished: () => void }) {
  const games = useGames();
  const [n, setN] = useState(0);
  const shown = useRef(new Set<string>());
  const items = useMemo(() => (games ? senseItemsFrom(games) : null), [games]);
  const seenAtStart = useRef<Set<string> | null>(null);
  if (seenAtStart.current === null && learner.ready) seenAtStart.current = new Set(learner.attempts.filter((a) => a.exerciseKind === 'sense').map((a) => a.exerciseId));
  // The question for turn `n` is chosen once and kept. The games list changes underneath all
  // the time (a game is fetched or its analysis finishes every few seconds while the app is
  // open); choosing again on every change swapped the position out from under the learner
  // before they could answer.
  const latch = useRef<{ n: number; item: SenseItem } | null>(null);
  let current: SenseItem | null | undefined;
  if (!items || !seenAtStart.current) current = undefined;
  else if (latch.current?.n === n) current = latch.current.item;
  else {
    const seen = new Set([...seenAtStart.current, ...shown.current]);
    const kinds: SenseKind[] = n % 2 === 0 ? ['safe-or-not', 'chance-or-not'] : ['chance-or-not', 'safe-or-not'];
    current = null;
    for (const kind of kinds) {
      // Ask for a pair so truth alternates over time; take the first.
      const pick = pickSense(items, kind, seen, 2, `sense|${n}`)[0];
      if (pick) {
        current = pick;
        break;
      }
    }
    // Only a real question is kept: while there is none yet, newly analysed games may supply one.
    if (current) latch.current = { n, item: current };
  }
  if (current === undefined) return <p className="muted">Loading your games</p>;
  if (current === null) {
    return (
      <div className="empty" data-testid="sense-done">
        <p>{items && items.length === 0 ? 'These questions are built from your own analysed games, and there are none on this device yet. They appear once your games have been fetched and analysed.' : 'No unseen questions are left for now; more appear as you play.'}</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
      </div>
    );
  }
  shown.current.add(current.id);
  return <SenseDrill key={current.id} item={current} sessionId={null} context="practice" heading="From your own games" onDone={() => setN(n + 1)} />;
}
