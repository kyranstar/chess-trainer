import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Color } from '../chess/rules';
import { consequenceOf, lineAt } from '../chess/line';

export interface Line {
  /** Position the line starts from. */
  from: string;
  pv: string[];
  /** The position before the learner's own move, when the line starts after it: what that move took is then counted. */
  before?: string;
}

/** Time between two moves of a line that plays itself: long enough to see each move land. */
export const STEP_MS = 650;

const stillMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A line played through on the board, a move at a time: what a mistake leads to, or how the
 * solution goes, seen on the board instead of read as notation. One control for every exercise.
 *
 * The line plays itself, one move every STEP_MS, from the position the learner is looking at:
 * to `initial` when the exercise shows a consequence unasked, and to the end when the play
 * button is tapped. The two arrows step by hand, and stop a replay that is running.
 *
 * The replay stops where the line is decided (the piece that goes, the mate) and marks it,
 * when that can be told from the moves; otherwise the first `cap` moves are shown and nothing
 * is claimed. See consequenceOf in src/chess/line.ts.
 */
export function useLineSteps(line: Line | null, opts: {
  /**
   * How far the line plays by itself when it appears; 0 waits for the play button. A line
   * whose outcome can be told plays on to that point whatever the number.
   */
  initial?: number; startLabel?: string; testid?: string;
  /** The learner's colour: needed to say who came out ahead. Without it nothing is marked. */
  me?: Color;
  /** False for a solution, which is shown to its end; the decisive move is still marked on the way. */
  stopThere?: boolean;
  /** How many moves to show when the line is not decided. */
  cap?: number;
} = {}): {
  step: number;
  /** The position at the current step (the starting position at step 0); null without a line. */
  pos: { fen: string; last: string | null } | null;
  /** Squares to mark at the current step. */
  marks: string[];
  /** What happened at the decisive move, when the replay is standing on it. */
  note: ReactNode;
  controls: ReactNode;
  reset: () => void;
} {
  const key = line ? `${line.before ?? ''}|${line.from}|${line.pv.join(' ')}` : '';
  const decided = useMemo(() => (line && opts.me ? consequenceOf(line.from, line.pv, opts.me, line.before) : null), [key, opts.me]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = !line ? 0 : decided && opts.stopThere !== false ? decided.ply : Math.min(line.pv.length, opts.cap ?? line.pv.length);
  // Shown unasked, a line plays to where it is decided; one that is not decided stops after `initial` moves.
  const initial = (opts.initial ?? 0) === 0 ? 0 : decided && opts.stopThere !== false ? n : Math.min(opts.initial!, n);
  // A line that appears unasked starts on its first move at once and plays on from there.
  const fresh = () => (stillMotion() ? { key, step: initial, target: initial } : { key, step: Math.min(1, initial), target: initial });
  const [state, setState] = useState(fresh);
  // A new line starts at its own first step at once, not one render late.
  const cur = state.key === key ? state : fresh();
  const step = Math.min(cur.step, n);
  const target = Math.min(cur.target, n);
  const playing = step < target;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setState({ key, step: step + 1, target }), STEP_MS);
    return () => clearTimeout(t);
  }, [key, step, target, playing]);
  const pos = useMemo(() => (line ? lineAt(line.from, line.pv, step) : null), [key, step]); // eslint-disable-line react-hooks/exhaustive-deps
  /** By hand: go there and stop any replay. */
  const go = (to: number) => {
    const s = Math.max(0, Math.min(n, to));
    setState({ key, step: s, target: s });
  };
  const play = () => setState(stillMotion() ? { key, step: n, target: n } : { key, step: Math.min(n, step + 1), target: n });
  const onIt = !!decided && step === decided.ply;
  const controls = n > 0 ? (
    <span className="line-steps" data-testid={opts.testid ?? 'line-steps'} data-step={step} data-length={n} data-playing={playing}>
      <button className="step" data-testid="line-prev" disabled={step === 0} onClick={() => go(step - 1)} aria-label="One move back in the line">‹</button>
      {step === 0
        ? <button data-testid="line-next" onClick={play} aria-label="Play the line on the board">▶ {opts.startLabel ?? 'Play the line'}</button>
        : <button className="step" data-testid="line-next" disabled={step >= n} onClick={() => go(step + 1)} aria-label="One move on in the line">›</button>}
      {step > 0 && <span className="line-count" aria-hidden>{step} / {n}</span>}
    </span>
  ) : null;
  const note = onIt ? <p className="line-note" data-testid="line-consequence">{decided!.text}</p> : null;
  return { step, pos, marks: onIt ? [decided!.square] : [], note, controls, reset: () => go(0) };
}
