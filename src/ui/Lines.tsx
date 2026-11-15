/**
 * The result of an answer as moves on one board (owner decision, 2026-11-12; ADR-052).
 *
 * After an answer on a position from his own games up to three moves are in play: the one he
 * just tried, the one he played in the game, and the engine's first choice. They used to be
 * told apart in sentences, with a different set of buttons in each exercise. Here they are
 * chips in a fixed order and fixed colours (you, game, best), merged when two are the same
 * move. Under each move a bar says how good the position is for him after it, with the
 * engine's evaluation in pawns at its end ("+0.11"; plus is good for him). The result rests on the position that was asked about, with one arrow per chip.
 * Tapping a chip plays that line on the board; the moves of the line are the stepper, so any
 * move can be gone back to, and one step back from the first move is the starting position.
 *
 * A single line (what a wrong puzzle move leads to) has no chips: only the moves.
 *
 * Under the chips, while the result rests on the position asked, the engine's other choices
 * (owner request, 2026-11-15; ADR-054): up to three more moves with their numbers, from one
 * search of the position, each of which plays its line when tapped. "Why is that the best
 * move" is often answered by seeing that three others are within a fifth of a pawn of it, or
 * that nothing else comes close; the row is headed "About as good" or "Much worse" when it
 * is plainly one or the other. With a line on the board its moves take the row's place, so
 * that nothing under the board moves and nothing runs under the button.
 *
 * A line that plays itself stops where it is decided (the piece that goes, the mate) and
 * marks it, when that can be told from the moves; see consequenceOf in src/chess/line.ts.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { consequenceOf, lineAt, type MoveLine, numberedSans, otherMoves, othersLabel, replaySpan, type SearchedLine, type Who } from '../chess/line';
import { canonicalUci, type Color, fenAfter, positionFromFen } from '../chess/rules';
import { bestLineFor, otherLinesFor } from '../engine/interactive';
import { evalText } from '../engine/uci';

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
  /** The move that led to the starting position, to show while the board stands on it. */
  startLast?: string | null;
  /** Search budget for a line that has to be asked for (the reply to the game move). */
  nodes?: number;
  /** False to leave out the engine's other choices under the chips (they are shown wherever moves are compared). */
  others?: boolean;
  testid?: string;
}

export interface ResultLines {
  /** What the board shows, or null when there is no result. */
  board: { fen: string; lastMove: string | null; marks: string[]; arrows: { uci: string; who: Who }[]; line: Who | null } | null;
  /** The moves to compare, and under them the engine's other choices; null for a single line. */
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
/** The engine's first few choices in a position: being searched, found, or not to be had (null). */
type Searched = SearchedLine[] | 'loading' | null;

/**
 * Starts the search for the engine's other choices as soon as a position is on screen, so
 * that they are there when the answer is in. Asking twice costs nothing (see otherLinesFor).
 */
export function useOtherMovesAhead(fen: string | null): void {
  useEffect(() => {
    if (fen) void otherLinesFor(fen);
  }, [fen]);
}

/**
 * The expected score (0-100) of the engine's first choice in a position for the side to move,
 * once the search for its first few choices has answered; null until then, or with no answer.
 */
export function useSearchedBest(fen: string | null): number | null {
  const [got, setGot] = useState<{ fen: string; wp: number } | null>(null);
  useEffect(() => {
    if (!fen) return;
    let live = true;
    void otherLinesFor(fen).then((found) => {
      if (live && found?.[0]) setGot({ fen, wp: found[0].wp });
    });
    return () => {
      live = false;
    };
  }, [fen]);
  return fen && got?.fen === fen ? got.wp : null;
}

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

  // The engine's other choices: asked for where moves are compared and it is the learner's
  // move in the starting position (the numbers are for the side to move).
  const wantOthers = !!start && !single && opts.others !== false && lines.length > 0 && turnOf(start) === opts.me;
  const [searches, setSearches] = useState<Record<string, Searched>>({});
  useEffect(() => {
    if (!wantOthers || !start) return;
    let live = true;
    setSearches((x) => (x[start] === undefined ? { ...x, [start]: 'loading' } : x));
    void otherLinesFor(start).then((found) => {
      if (live) setSearches((x) => ({ ...x, [start]: found }));
    });
    return () => {
      live = false;
    };
  }, [start, wantOthers]);
  const searched = wantOthers && start ? searches[start] ?? 'loading' : null;
  const found = searched && searched !== 'loading' ? searched : null;
  const shownUcis = lines.map((l) => l.uci).join(',');
  const extra = useMemo(() => (start && found ? otherMoves(start, found, shownUcis.split(',')) : []), [start, found, shownUcis]);
  // A compared move that came without a number takes the one this search gave it, if it is among its lines.
  const searchedScore = useMemo(() => {
    const by = new Map<string, number>();
    if (!start || !found) return by;
    try {
      const pos = positionFromFen(start);
      for (const l of found) by.set(canonicalUci(pos, l.uci), l.wp);
    } catch {
      // a line that cannot be read gives no numbers
    }
    return by;
  }, [start, found]);
  const label = useMemo(() => (found ? othersLabel(found, extra) : 'Others'), [found, extra]);
  const all = useMemo(() => [...lines, ...extra], [lines, extra]);

  const line = cur.sel === null ? null : all[cur.sel] ?? null;
  const got = line && start ? loaded[`${start}|${line.uci}`] : undefined;
  const pv = line ? line.pv ?? (got && got !== 'loading' ? got.pv : null) : null;
  const full = useMemo(() => (line ? [line.uci, ...(pv ?? [])] : []), [line?.uci, pv?.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the line is decided is read from the whole line and from nothing less. A shorter
  // piece of it can show a capture that the rest of the line takes back: a fallback to the
  // first moves, tried in ADR-052, told the learner he ended five points ahead after a wrong
  // puzzle move whose rook was won back three moves later (withdrawn in ADR-053).
  const decided = useMemo(() => (start && full.length ? consequenceOf(start, full, opts.me) : null), [start, full, opts.me]);
  // How much of the line can be stepped through, and where a replay "to where it is decided"
  // rests. The line that opens with the result may ask for a least number of moves (the
  // engine's answer to a wrong puzzle move is always shown): see replaySpan.
  const least = line && open && line.who.includes(open.kind) ? open.fallback ?? 0 : 0;
  const span = replaySpan({ length: full.length, decidedPly: decided ? decided.ply : null, stopThere: opts.stopThere !== false, least, cap: CAP });
  const n = !line ? 0 : span.shown;
  const target = cur.goal === null ? Math.min(cur.step, n) : cur.goal === 'end' ? n : Math.min(span.stop, n);
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
    : { fen: start, lastMove: opts.startLast ?? null, marks: [], arrows: single ? [] : lines.map((l) => ({ uci: l.uci, who: l.kind })), line: null };

  const scoreOf = (l: MoveLine) => {
    const x = start ? loaded[`${start}|${l.uci}`] : undefined;
    return l.score ?? (x && x !== 'loading' ? x.score : null) ?? searchedScore.get(l.uci) ?? null;
  };
  const chips = !start || single || lines.length === 0 ? null : (
    <>
    <div className="lines" data-testid="lines" data-selected={line?.kind ?? ''}>
      {lines.map((l, i) => {
        const score = scoreOf(l);
        return (
          <button key={l.uci} className={`line-chip is-${l.kind}`} data-testid={`line-${l.kind}`} data-who={l.who.join(' ')} data-uci={l.uci} aria-pressed={cur.sel === i} onClick={() => select(i)}>
            <span className="line-who">{l.label}</span>
            <span className="line-san">{l.san}</span>
            {score !== null && (
              <span className="line-score">
                <span className="line-bar" role="img" aria-label={`${Math.round(score)} out of 100`} data-score={Math.round(score)}>
                  <i style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
                </span>
                {/* The engine's evaluation in pawns after the move, from the learner's side: plus is good for him. */}
                <span className="line-eval" data-testid="line-eval" aria-label={`${evalText(score)} pawns for you`}>{evalText(score)}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
    {/* Shown while the result rests on the position asked; the moves of a line on the board take its place.
        The row keeps its place while the search runs, so nothing under it moves when the moves arrive. */}
    {wantOthers && !line && (searched === 'loading' || extra.length > 0) && (
      <div className="others" data-testid="others" data-state={searched === 'loading' ? 'loading' : 'shown'} data-label={label}>
        <span className="others-label">{label}</span>
        {searched === 'loading' && <span className="line-wait">…</span>}
        {extra.map((l, j) => (
          <button key={l.uci} className="other-move" data-testid="other-move" data-uci={l.uci} data-score={l.score === null ? '' : Math.round(l.score)} aria-pressed={cur.sel === lines.length + j} onClick={() => select(lines.length + j)}>
            <span className="other-san">{l.san}</span>
            {l.score !== null && <span className="line-eval" data-testid="line-eval" aria-label={`${evalText(l.score)} pawns for you`}>{evalText(l.score)}</span>}
          </button>
        ))}
      </div>
    )}
    </>
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

function turnOf(fen: string): Color | null {
  try {
    return positionFromFen(fen).turn;
  } catch {
    return null;
  }
}
