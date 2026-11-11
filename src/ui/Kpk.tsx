import { useMemo, useRef, useState } from 'react';
import { type Learner, useDb, useFocusMode } from '../app/store';
import { applyUci, fenOf, positionFromFen, sanOf } from '../chess/rules';
import { recordAttempt } from '../db/db';
import type { Attempt } from '../db/types';
import { distanceKpk, evaluateMove, fastestWin, HOLD_MOVES, keepingMoves, KPK_DRILLS, KPK_VERSION, type KpkOutcome, learnerColor, opponentReply, outcomeAfter, WIN_MOVE_CAP } from '../endgames/kpk';
import { Board } from './Board';
import { useArmed, useScreenChange } from '../app/tapGuard';

export type KpkGoal = 'win' | 'hold';
export const kpkId = (goal: KpkGoal, fen: string) => `kpk:${goal}:${fen}`;

const OUTCOME_TEXT: Record<KpkOutcome, string> = {
  promoted: 'The pawn has queened safely. Won, with the win kept on every move.',
  held: `Held: ${HOLD_MOVES} defensive moves, each of which kept the draw.`,
  'pawn-captured': 'The pawn is gone: drawn.',
  stalemate: 'Stalemate: drawn.',
  'not-converted': `The win was never thrown away, but the pawn has not queened in ${WIN_MOVE_CAP} moves.`,
};

/** One king-and-pawn ending played out against the exact table. */
export function KpkDrill({ start, goal, sessionId, heading, context = 'practice', allowShow = true, onRecorded, onDone }: {
  start: string; goal: KpkGoal; sessionId: string | null; heading?: string; context?: 'practice' | 'check' | 'review'; allowShow?: boolean; onRecorded?: (a: Attempt) => void; onDone: () => void;
}) {
  const db = useDb();
  useFocusMode();
  const me = useMemo(() => learnerColor(start, goal), [start, goal]);
  const [fen, setFen] = useState(start);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState<{ ok: boolean; text: string; detail?: string } | null>(null);
  useScreenChange(`${start}|${goal}|${!!end}`);
  const armed = useArmed();
  const myMoves = useRef(0);
  const first = useRef<string | null>(null);
  const played = useRef<string[]>([]);
  const started = useRef(Date.now());

  /** A second go at the same start after a failure is practice: it is never recorded. */
  const [retrying, setRetrying] = useState(false);
  function retry() {
    setRetrying(true);
    setFen(start);
    setLastMove(null);
    setEnd(null);
    setBusy(false);
    setResetKey((k) => k + 1);
    myMoves.current = 0;
  }

  async function finish(ok: boolean, shown: boolean, text: string, detail?: string) {
    setEnd({ ok, text, detail });
    if (retrying) return;
    const a = await recordAttempt(db, {
      sessionId, context, exerciseId: kpkId(goal, start), exerciseKind: 'endgame', contentVersion: KPK_VERSION,
      conceptId: 'endgame.opposition', themes: ['kpk', goal], rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current,
      firstMove: first.current, played: played.current, mistakes: ok || shown ? 0 : 1, hints: shown ? 1 : 0,
      outcome: shown ? 'assisted' : ok ? 'success' : 'fail', acceptedAlternative: false,
    });
    onRecorded?.(a);
  }

  function onMove(uci: string) {
    if (end || busy) return;
    const pos = positionFromFen(fen);
    const san = sanOf(pos, uci);
    first.current ??= uci;
    played.current.push(uci);
    const ev = evaluateMove(fen, uci);
    const after = fenOf(applyUci(pos, uci));
    setFen(after);
    setLastMove(uci);
    myMoves.current++;
    if (!ev.kept) {
      const keeping = ev.keeping.map((u) => sanOf(pos, u)).join(', ');
      void finish(false, false, goal === 'win' ? `${san} lets the win go: the position is now a theoretical draw.` : `${san} loses: the pawn now queens by force.`,
        ev.keeping.length === 1 ? `Only ${keeping} kept the ${goal === 'win' ? 'win' : 'draw'}.` : `These kept the ${goal === 'win' ? 'win' : 'draw'}: ${keeping}.`);
      return;
    }
    const o = outcomeAfter(after, goal, myMoves.current);
    if (o) return void finish(o !== 'not-converted', false, OUTCOME_TEXT[o]);
    setBusy(true);
    setTimeout(() => {
      const reply = opponentReply(after, goal);
      const next = fenOf(applyUci(positionFromFen(after), reply));
      played.current.push(reply);
      setFen(next);
      setLastMove(reply);
      setBusy(false);
      const o2 = outcomeAfter(next, goal, myMoves.current);
      if (o2) void finish(o2 !== 'not-converted', false, OUTCOME_TEXT[o2]);
    }, 380);
  }

  function show() {
    const pos = positionFromFen(fen);
    const move = goal === 'win' ? fastestWin(fen) : keepingMoves(fen)[0];
    if (!move) return;
    setFen(fenOf(applyUci(pos, move)));
    setLastMove(move);
    setResetKey((k) => k + 1);
    void finish(false, true, `${sanOf(pos, move)} keeps the ${goal === 'win' ? 'win' : 'draw'}.`, 'Shown: counts as assisted.');
  }

  const dist = goal === 'win' && !end ? distanceKpk(fen) : null;
  return (
    <section className="puzzle" data-testid="kpk-drill" data-goal={goal} data-fen={fen} data-done={!!end} data-keeping={end || busy ? '' : keepingMoves(fen).join(' ')} data-fastest={end || busy || goal !== 'win' ? '' : fastestWin(fen) ?? ''}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>{goal === 'win' ? `${me === 'white' ? 'White' : 'Black'} to play and win` : `${me === 'white' ? 'White' : 'Black'} to play and hold the draw`}</h2>
        <p className="muted">
          {goal === 'win' ? 'Queen the pawn against the best defence. Every move is checked against the exact table of this ending.' : `Keep the draw for ${HOLD_MOVES} moves against the most testing tries. Every move is checked against the exact table of this ending.`}
          {dist ? ` Best play queens in ${Math.ceil(dist / 2)} moves from here.` : ''}
        </p>
      </header>
      <Board fen={fen} orientation={me} movable={end || busy ? null : me} lastMove={lastMove} onMove={onMove} resetKey={resetKey} />
      <div className="feedback" aria-live="polite">
        {end && (
          <div className={`verdict ${end.ok ? 'right' : 'neutral'}`} data-testid="kpk-verdict" data-ok={end.ok}>
            <strong>{end.text}</strong>
            {end.detail && <p>{end.detail}</p>}
            {retrying && <p data-testid="kpk-retry-note">Second go: not recorded.</p>}
          </div>
        )}
      </div>
      <div className="actions">
        {!end && allowShow && <button onClick={show} disabled={!armed || busy}>Show a move that keeps it</button>}
        {end && !end.ok && context !== 'check' && <button data-testid="kpk-retry" disabled={!armed} onClick={retry}>Try this position again</button>}
        {end && <button className="primary" data-testid="kpk-next" disabled={!armed} onClick={onDone}>Continue</button>}
      </div>
    </section>
  );
}

/** Unseen starts, alternating "win it" and "hold it", in the table's fixed order. */
export function KpkRun({ learner, onFinished }: { learner: Learner; onFinished: () => void }) {
  const [n, setN] = useState(0);
  const seenAtStart = useRef<Set<string> | null>(null);
  if (seenAtStart.current === null && learner.ready) seenAtStart.current = new Set(learner.attempts.filter((a) => a.exerciseKind === 'endgame').map((a) => a.exerciseId));
  if (!seenAtStart.current) return <p className="muted">Loading</p>;
  const fresh = (goal: KpkGoal) => KPK_DRILLS[goal].filter((f) => !seenAtStart.current!.has(kpkId(goal, f)));
  const win = fresh('win');
  const hold = fresh('hold');
  const goal: KpkGoal = n % 2 === 0 ? (win.length > n / 2 ? 'win' : 'hold') : hold.length > (n - 1) / 2 ? 'hold' : 'win';
  const start = (goal === 'win' ? win : hold)[Math.floor(n / 2)];
  if (!start) {
    return (
      <div className="empty" data-testid="kpk-done">
        <p>No unseen king-and-pawn starts are left in this set.</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back to Practice</button></div>
      </div>
    );
  }
  return <KpkDrill key={`${goal}:${start}`} start={start} goal={goal} sessionId={null} heading="King and pawn against king" onDone={() => setN(n + 1)} />;
}

/** Unseen starts for a check: three to win, two to hold, in the table's fixed order. */
export function kpkCheckSet(seen: Set<string>, size: number): { goal: KpkGoal; start: string }[] {
  const fresh = (goal: KpkGoal) => KPK_DRILLS[goal].filter((f) => !seen.has(kpkId(goal, f)));
  const win = fresh('win');
  const hold = fresh('hold');
  const out: { goal: KpkGoal; start: string }[] = [];
  for (let i = 0; out.length < size && (win[i] || hold[i]); i++) {
    if (win[i]) out.push({ goal: 'win', start: win[i]! });
    if (hold[i] && out.length < size) out.push({ goal: 'hold', start: hold[i]! });
  }
  return out.slice(0, size);
}
