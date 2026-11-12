/**
 * The result of an answer as moves on one board (owner decision, 2026-11-12; ADR-052).
 *
 * After an answer on a position from his own games up to three moves are in play: the one he
 * just tried, the one he played in the game, and the engine's first choice. They used to be
 * told apart in sentences, with a different set of buttons in each exercise. Here they are
 * chips in a fixed order and fixed colours (you, game, best), merged when two are the same
 * move. The result rests on the position that was asked about, with one arrow per chip.
 * Tapping a chip plays that line on the board; the moves of the line are the stepper, so any
 * move can be gone back to, and one step back from the first move is the starting position.
 *
 * A single line (what a wrong puzzle move leads to, a solution) has no chips: only the moves.
 *
 * A line that plays itself stops where it is decided (the piece that goes, the mate) and
 * marks it, when that can be told from the moves; see consequenceOf in src/chess/line.ts.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { consequenceOf, lineAt, type MoveLine, numberedSans, type Who } from '../chess/line';
import { type Color, fenAfter, positionFromFen } from '../chess/rules';
import { bestLineFor } from '../engine/interactive';

/** Time between two moves of a line that plays itself: long enough to see each move land. */
export const STEP_MS = 650;
/** How many moves of a line are shown when it is not decided earlier. */
const CAP = 6;

const stillMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface LinesOptions {
  /** The learner's colour: needed to say who came out ahead. */
  me: Color;
  /**
   * True where moves are being compared (a position from his own games): chips are shown even
   * for one move, and the result rests on the starting position. False for a plain line.
   */
  compare?: boolean;
  /**
   * A line that is on the board when the result appears. Without it the result rests on the
   * starting position. `play: false` shows it at its end without playing it.
   */
  open?: { kind: Who; to?: 'decided' | 'end'; fallback?: number; play?: boolean } | null;
  /** False for a solution, which is shown to its end; the decisive move is still marked on the way. */
  stopThere?: boolean;
  /** The move that led to the starting position, to show when a single line stands at its start. */
  startLast?: string | null;
  /** Search budget for a line that has to be asked for (the reply to the game move). */
  nodes?: number;
  testid?: string;
}

export interface ResultLines {
  /** What the board shows, or null when there is no result. */
  board: { fen: string; lastMove: string | null; marks: string[]; arrows: { uci: string; who: Who }[]; line: Who | null } | null;
  /** The moves to compare; null for a single line. */
  chips: ReactNode;
  /** The moves of the line on the board, with a step either way; null at the starting position of a comparison. */
  ribbon: ReactNode;
  /** What happened at the decisive move, when the board is standing on it. */
  note: ReactNode;
  /** The line on the board, and how many moves into it. */
  selected: MoveLine | null;
  step: number;
}

type Loaded = { pv: string[]; score: number | null } | 'loading';
interface St { key: string; sel: number | null; step: number; goal: 'decided' | 'end' | null; fallback?: number }

export function useResultLines(start: string | null, lines: MoveLine[], opts: LinesOptions): ResultLines {
  const single = !opts.compare;
  const open = opts.open ?? null;
  const key = start ? `${start}|${lines.map((l) => l.uci).join(',')}|${open ? `${open.kind}:${open.to ?? ''}:${open.play ?? ''}` : ''}` : '';
  const fresh = (): St => {
    const i = open ? lines.findIndex((l) => l.who.includes(open.kind)) : -1;
    if (i < 0) return { key, sel: single && lines.length ? 0 : null, step: 0, goal: null };
    if (open!.play === false) return { key, sel: i, step: Number.MAX_SAFE_INTEGER, goal: null };
    return { key, sel: i, step: 1, goal: open!.to ?? 'decided', fallback: open!.fallback };
  };
  const [state, setState] = useState<St>(fresh);
  // A new result starts at once, not one render late.
  const cur = state.key === key ? state : fresh();
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});

  const line = cur.sel === null ? null : lines[cur.sel] ?? null;
  const got = line && start ? loaded[`${start}|${line.uci}`] : undefined;
  const pv = line ? line.pv ?? (got && got !== 'loading' ? got.pv : null) : null;
  const full = useMemo(() => (line ? [line.uci, ...(pv ?? [])] : []), [line?.uci, pv?.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the line is decided. The whole line is asked first. An engine's line is long and its
  // tail is its least reliable part: when the whole of it claims nothing (it ends in the
  // middle of an exchange, say), the moves that would be shown anyway are asked on their own.
  const decided = useMemo(() => (start && full.length ? consequenceOf(start, full, opts.me) ?? (full.length > CAP ? consequenceOf(start, full.slice(0, CAP), opts.me) : null) : null), [start, full, opts.me]);
  const n = !line ? 0 : decided && opts.stopThere !== false ? decided.ply : opts.stopThere === false ? full.length : Math.min(full.length, CAP);
  // A line asked to play "to where it is decided" stops there even when more of it can be stepped through.
  const target = cur.goal === null ? Math.min(cur.step, n) : cur.goal === 'end' ? n : decided ? Math.min(decided.ply, n) : Math.min(cur.fallback ?? n, n);
  const step = cur.goal !== null && stillMotion() ? target : Math.min(cur.step, n);
  const playing = cur.goal !== null && step < target;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setState({ ...cur, key, step: step + 1 }), STEP_MS);
    return () => clearTimeout(t);
  }, [key, cur.sel, step, target, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // A line with nothing known after its first move (the reply to the game move) is asked for when it is opened.
  useEffect(() => {
    if (!start || !line || line.pv !== null) return;
    const id = `${start}|${line.uci}`;
    if (loaded[id]) return;
    let after: string;
    try {
      after = fenAfter(start, [line.uci]);
    } catch {
      return;
    }
    if (positionFromFen(after).isEnd()) {
      setLoaded((x) => ({ ...x, [id]: { pv: [], score: null } }));
      return;
    }
    setLoaded((x) => ({ ...x, [id]: 'loading' }));
    void bestLineFor(after, opts.nodes).then((best) => setLoaded((x) => ({ ...x, [id]: { pv: best ? best.pv.slice(0, 9) : [], score: best ? 100 - best.wp : null } })));
  }, [start, line?.uci, line?.pv]); // eslint-disable-line react-hooks/exhaustive-deps

  /** By hand: go there and stop any replay. One step back from the first move of a comparison is the starting position. */
  const go = (to: number) => {
    const s = Math.max(0, Math.min(n, to));
    setState({ key, sel: s === 0 && !single ? null : cur.sel, step: s, goal: null });
  };
  const select = (i: number) => setState(cur.sel === i ? { key, sel: null, step: 0, goal: null } : { key, sel: i, step: 1, goal: 'decided' });

  const at = useMemo(() => (start && line ? lineAt(start, full, step) : null), [start, line?.uci, full, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const onIt = !!decided && !!line && step === decided.ply;
  const board = !start ? null : line && at && step > 0
    ? { fen: at.fen, lastMove: at.last, marks: onIt ? [decided!.square] : [], arrows: [], line: single ? null : line.kind }
    : { fen: start, lastMove: single ? opts.startLast ?? null : null, marks: [], arrows: single ? [] : lines.map((l) => ({ uci: l.uci, who: l.kind })), line: null };

  const scoreOf = (l: MoveLine) => {
    const x = start ? loaded[`${start}|${l.uci}`] : undefined;
    return l.score ?? (x && x !== 'loading' ? x.score : null);
  };
  const chips = !start || single || lines.length === 0 ? null : (
    <div className="lines" data-testid="lines" data-selected={line?.kind ?? ''}>
      {lines.map((l, i) => {
        const score = scoreOf(l);
        return (
          <button key={l.uci} className={`line-chip is-${l.kind}`} data-testid={`line-${l.kind}`} data-who={l.who.join(' ')} data-uci={l.uci} aria-pressed={cur.sel === i} onClick={() => select(i)}>
            <span className="line-who">{l.label}</span>
            <span className="line-san">{l.san}</span>
            {score !== null && (
              <span className="line-bar" role="img" aria-label={`${Math.round(score)} out of 100`} data-score={Math.round(score)}>
                <i style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  // The move the board stands on is kept in view when the line is longer than the screen is wide.
  const moves = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const on = moves.current?.querySelector<HTMLElement>('.is-on');
    if (on && moves.current) moves.current.scrollLeft = Math.max(0, on.offsetLeft - moves.current.offsetLeft - moves.current.clientWidth / 2 + on.offsetWidth / 2);
  }, [key, cur.sel, step]);
  const tokens = useMemo(() => (start && line ? numberedSans(start, full.slice(0, n)) : []), [start, line?.uci, full, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const ribbon = !start || !line || n === 0 ? null : (
    <div className={`line-steps is-${single ? 'single' : line.kind}`} data-testid={opts.testid ?? 'line-steps'} data-step={step} data-length={n} data-playing={playing} data-line={line.kind}>
      <button className="step" data-testid="line-prev" disabled={step === 0} onClick={() => go(step - 1)} aria-label={step === 1 && !single ? 'Back to the starting position' : 'One move back'}>‹</button>
      <span className="line-moves" ref={moves}>
        {tokens.map((t, i) => (
          <button key={i} className={`line-move${i + 1 === step ? ' is-on' : ''}`} data-testid="line-move" aria-current={i + 1 === step} onClick={() => go(i + 1)}>
            {t.no && <span className="line-no">{t.no}</span>}{t.san}
          </button>
        ))}
        {got === 'loading' && <span className="line-wait" data-testid="line-wait">…</span>}
      </span>
      <button className="step" data-testid="line-next" disabled={step >= n} onClick={() => go(step + 1)} aria-label="One move on">›</button>
    </div>
  );
  const note = onIt ? <p className="line-note" data-testid="line-consequence">{decided!.text}</p> : null;
  return { board, chips, ribbon, note, selected: line, step };
}
