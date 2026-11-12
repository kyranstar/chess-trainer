import { useEffect, useMemo, useRef, useState } from 'react';
import { type Learner, useDb, useFocusMode } from '../app/store';
import { applyUci, fenAfter, fenOf, positionFromFen, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt, AttemptContext } from '../db/types';
import { bestLineFor } from '../engine/interactive';
import { chanceItems, gradeChance, gradeSafety, pickSense, safetyItems, type SenseGrade, type SenseItem, type SenseKind, senseThemes, senseWords, verifyReply } from '../games/sense';
import type { GameRecord } from '../games/types';
import { Board } from './Board';
import { useGames } from './Games';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { type Candidate, mergeLines, ucisOfSanLine } from '../chess/line';
import { useResultLines } from './Lines';
import { Ask, gameRef, KeepLast, useItem } from './Stage';
import { seenPositions } from '../schedule/position';

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


/**
 * One yes/no question about a real position from the learner's own games. After the answer
 * the moves stand side by side on the board: the one played in the game, the engine's best
 * where there was something to see, and his own if he played one (see ./Lines.tsx).
 */
export function SenseDrill({ item, sessionId, context, onRecorded, onDone }: {
  item: SenseItem; sessionId: string | null; context: AttemptContext; onRecorded?: (a: Attempt) => void; onDone: () => void;
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
  // The move he played for himself ("there is something": this one), and what the engine answered if it was asked.
  const [mine, setMine] = useState<{ uci: string; pv: string[] | null; wp: number | null } | null>(null);
  const stage = useItem(onDone);
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
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: item.id, exerciseKind: 'sense', contentVersion: 'sense-v1', conceptId: 'safety.threat-scan',
      themes: senseThemes(item, g), rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: move, played: move ? [move] : [],
      mistakes: g.correct ? 0 : 1, hints: 0, outcome: g.response === 'unverified-reply' || g.response === 'label-disputed' ? 'skipped' : g.correct ? 'success' : 'fail', acceptedAlternative: !!g.alternative,
    });
    onRecorded?.(a);
  }

  function answer(yes: boolean) {
    if (safety) {
      if (!yes) return void finish(gradeSafety(item, 'safe', null), null);
      // A claim is followed by its evidence whether or not something is stored for this item:
      // ending at once on a "nothing here" item would also give the answer away.
      setFen(item.afterFen ?? fenOf(applyUci(positionFromFen(item.fen), item.proposed!)));
      setLastMove(item.proposed!);
    } else {
      if (!yes) return void finish(gradeChance(item, 'nothing', null), null);
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
    let answer: Awaited<ReturnType<typeof bestLineFor>> = null;
    if (g.needsEngine) {
      // A different move from the stored one: judged by what it does on the board (mate, or
      // material at the end of the engine's line), never by the score alone. A mate needs no engine.
      let verified = verifyReply(item, uci, null);
      if (verified === 'unresolved') {
        setPhase('checking');
        answer = await bestLineFor(afterFen);
        verified = verifyReply(item, uci, answer);
      }
      g = safety ? gradeSafety(item, 'unsafe', uci, verified) : gradeChance(item, 'something', uci, verified);
    }
    // His own move for himself is one of the moves compared afterwards, with the engine's answer to it.
    if (!safety) setMine({ uci, pv: answer ? answer.pv.slice(0, 10) : null, wp: answer ? 100 - answer.wp : null });
    await finish(g, uci);
  }

  // The moves to compare once the answer is in. What follows the game's move is on record when
  // it was an error; otherwise it is asked for when that line is opened.
  const lines = useMemo(() => {
    if (phase !== 'done') return [];
    const follow = (uci: string, line: string | undefined): string[] | null => {
      try {
        const pv = line ? ucisOfSanLine(fenAfter(item.fen, [uci]), line) : [];
        return pv.length ? pv : null;
      } catch {
        return null;
      }
    };
    const candidates: Candidate[] = [];
    if (mine) candidates.push({ who: 'you', uci: mine.uci, score: mine.wp, pv: mine.pv });
    if (item.played) candidates.push({ who: 'game', uci: item.played, score: item.playedWp ?? null, pv: follow(item.played, item.replyLine) });
    if (item.best) {
      const pv = ucisOfSanLine(item.fen, item.bestLine ?? '');
      candidates.push({ who: 'best', uci: item.best, score: item.bestWp ?? null, pv: pv[0] === item.best ? pv.slice(1) : [] });
    }
    return mergeLines(item.fen, candidates);
  }, [phase, item, mine]);
  const shown = useResultLines(phase === 'done' ? item.fen : null, lines, { me: item.color, compare: true });
  const words = grade ? senseWords(item, grade, playedSan) : null;
  const them = item.color === 'white' ? 'Black' : 'White';
  const source = gameRef(item.date, item.ply);
  const mover = phase === 'play' ? (safety ? opponent : item.color) : null;
  const unscored = grade?.response === 'unverified-reply' || grade?.response === 'label-disputed';
  return (
    <section className="puzzle" data-testid="sense-drill" data-kind={item.kind} data-truth={item.truth} data-phase={phase} data-expected={phase === 'play' ? (safety ? item.replyUci : item.best) : ''} data-response={grade?.response ?? ''}>
      <Board
        fen={shown.board ? shown.board.fen : fen} orientation={item.color} movable={mover} lastMove={shown.board ? shown.board.lastMove : lastMove}
        marks={shown.board?.marks ?? []} arrows={shown.board?.arrows ?? []} line={shown.board?.line ?? null}
        arrow={phase === 'ask' && safety ? item.proposed : null} onMove={(u) => void onMove(u)} flash={grade ? `${grade.correct ? 'right' : unscored ? 'none' : 'wrong'}:${item.id}` : null}
      />
      <div className="say" aria-live="polite">
        {phase === 'ask' && (safety
          ? <Ask title={`Is ${item.proposedSan} safe for ${me}?`} meta={`${source}.`} />
          : <Ask title={`${me} to move. Anything to win?`} meta={`${source}.`} />)}
        {(phase === 'play' || phase === 'checking') && (
          <Ask title={safety ? `Play ${them}’s reply that punishes it` : 'Play the winning move'} meta={phase === 'checking' ? 'Checking your move with the engine' : undefined} />
        )}
        {grade && (
          <div className="result" data-testid="sense-verdict" data-correct={grade.correct}>
            <p className="result-head">
              {!unscored && <span className={`grade-mark is-${grade.correct ? 'good' : 'bad'}`} aria-hidden>{grade.correct ? '✓' : '✗'}</span>}
              <strong>{words!.title}</strong>
            </p>
            {words!.detail && <p>{words!.detail}</p>}
            {shown.chips}
            {shown.ribbon}
            {shown.note}
          </div>
        )}
      </div>
      <div className={`actions dock${phase === 'ask' ? ' split' : ''}`}>
        {phase === 'ask' && (
          <>
            <button className="primary" data-testid="sense-no" disabled={!armed} onClick={() => answer(false)}>{safety ? 'Safe' : 'Nothing'}</button>
            <button className="primary" data-testid="sense-yes" disabled={!armed} onClick={() => answer(true)}>{safety ? 'Loses something' : 'Something'}</button>
          </>
        )}
        {phase === 'play' && <button data-testid="sense-giveup" disabled={!armed} onClick={() => void finish(safety ? gradeSafety(item, 'unsafe', null, 'no') : gradeChance(item, 'something', null, 'no'), null)}>I cannot find it</button>}
        {phase === 'done' && <button className="primary" data-testid="sense-next" disabled={!armed} onClick={stage.next}>{stage.nextLabel ?? 'Next'}</button>}
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
  // A position already met in another exercise is not asked as a new question (see src/schedule/position.ts).
  const metAtStart = useRef<Set<string> | null>(null);
  if (metAtStart.current === null && learner.ready) metAtStart.current = seenPositions(learner.attempts);
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
      const pick = pickSense(items.filter((x) => !metAtStart.current!.has(`${x.gameId}:${x.ply}`)), kind, seen, 2, `sense|${n}`)[0];
      if (pick) {
        current = pick;
        break;
      }
    }
    // Only a real question is kept: while there is none yet, newly analysed games may supply one.
    if (current) latch.current = { n, item: current };
  }
  if (current === undefined) return <p className="muted">Loading your games</p>;
  if (current) shown.current.add(current.id);
  return (
    <KeepLast>
      {current ? <SenseDrill key={current.id} item={current} sessionId={null} context="practice" onDone={() => setN(n + 1)} /> : (
        <div className="empty" data-testid="sense-done">
          <p>{items && items.length === 0 ? 'These questions are built from your own analysed games, and there are none on this device yet. They appear once your games have been fetched and analysed.' : 'No unseen questions are left for now; more appear as you play.'}</p>
          <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
        </div>
      )}
    </KeepLast>
  );
}
