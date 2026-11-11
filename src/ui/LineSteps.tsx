import { type ReactNode, useMemo, useState } from 'react';
import { lineAt } from '../chess/line';

export interface Line {
  /** Position the line starts from. */
  from: string;
  pv: string[];
}

/**
 * A line played through on the board, a move at a time: what a mistake leads to, or how the
 * solution goes, seen on the board instead of read as notation. One control for every exercise.
 */
export function useLineSteps(line: Line | null, opts: { initial?: number; startLabel?: string; testid?: string } = {}): {
  step: number;
  /** The position at the current step (the starting position at step 0); null without a line. */
  pos: { fen: string; last: string | null } | null;
  controls: ReactNode;
  reset: () => void;
} {
  const key = line ? `${line.from}|${line.pv.join(' ')}` : '';
  const n = line?.pv.length ?? 0;
  const initial = Math.min(opts.initial ?? 0, n);
  const [state, setState] = useState({ key, step: initial });
  // A new line starts at its own first step at once, not one render late.
  const step = state.key === key ? state.step : initial;
  const pos = useMemo(() => (line ? lineAt(line.from, line.pv, step) : null), [key, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: number) => setState({ key, step: Math.max(0, Math.min(n, to)) });
  const controls = n > 0 ? (
    <span className="line-steps" data-testid={opts.testid ?? 'line-steps'} data-step={step} data-length={n}>
      <button data-testid="line-prev" disabled={step === 0} onClick={() => go(step - 1)} aria-label="One move back in the line">Back</button>
      <button data-testid="line-next" disabled={step >= n} onClick={() => go(step + 1)} aria-label="One move on in the line">{step === 0 ? opts.startLabel ?? 'Play the line' : 'On'}</button>
    </span>
  ) : null;
  return { step, pos, controls, reset: () => go(0) };
}
