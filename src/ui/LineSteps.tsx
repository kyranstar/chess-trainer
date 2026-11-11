import { type ReactNode, useMemo, useState } from 'react';
import type { Color } from '../chess/rules';
import { consequenceOf, lineAt } from '../chess/line';

export interface Line {
  /** Position the line starts from. */
  from: string;
  pv: string[];
  /** The position before the learner's own move, when the line starts after it: what that move took is then counted. */
  before?: string;
}

/**
 * A line played through on the board, a move at a time: what a mistake leads to, or how the
 * solution goes, seen on the board instead of read as notation. One control for every exercise.
 *
 * The replay stops where the line is decided (the piece that goes, the mate) and marks it,
 * when that can be told from the moves; otherwise the first `cap` moves are shown and nothing
 * is claimed. See consequenceOf in src/chess/line.ts.
 */
export function useLineSteps(line: Line | null, opts: {
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
  const shownTo = !line ? 0 : decided && opts.stopThere !== false ? decided.ply : Math.min(line.pv.length, opts.cap ?? line.pv.length);
  const n = shownTo;
  const initial = Math.min(opts.initial ?? 0, n);
  const [state, setState] = useState({ key, step: initial });
  // A new line starts at its own first step at once, not one render late.
  const step = state.key === key ? Math.min(state.step, n) : initial;
  const pos = useMemo(() => (line ? lineAt(line.from, line.pv, step) : null), [key, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: number) => setState({ key, step: Math.max(0, Math.min(n, to)) });
  const onIt = !!decided && step === decided.ply;
  const controls = n > 0 ? (
    <span className="line-steps" data-testid={opts.testid ?? 'line-steps'} data-step={step} data-length={n}>
      <button data-testid="line-prev" disabled={step === 0} onClick={() => go(step - 1)} aria-label="One move back in the line">Back</button>
      <button data-testid="line-next" disabled={step >= n} onClick={() => go(step + 1)} aria-label="One move on in the line">{step === 0 ? opts.startLabel ?? 'Play the line' : 'On'}</button>
    </span>
  ) : null;
  const note = onIt ? <p className="line-note" data-testid="line-consequence">{decided!.text}</p> : null;
  return { step, pos, marks: onIt ? [decided!.square] : [], note, controls, reset: () => go(0) };
}
