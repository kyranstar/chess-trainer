import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Who } from '../chess/line';
import { type Color, isCheck, legalDests, needsPromotion, positionFromFen, type Uci } from '../chess/rules';

/**
 * The colours of the three moves compared after an answer, on the board. The engine's move is
 * blue, not green: the board is green. The same three colours mark the chips under the board.
 */
const LINE_BRUSH: Record<Who, { key: string; color: string; opacity: number; lineWidth: number }> = {
  you: { key: 'you', color: '#e68f00', opacity: 1, lineWidth: 11 },
  game: { key: 'game', color: '#3f4a55', opacity: 0.8, lineWidth: 11 },
  best: { key: 'best', color: '#1557b0', opacity: 1, lineWidth: 11 },
};
const TONE = { good: '#26734a', mid: '#96600a', bad: '#b0362d' };

export interface BoardProps {
  fen: string;
  orientation: Color;
  /** Which side the learner may move; null makes the board display-only. */
  movable: Color | null;
  lastMove?: Uci | null;
  /** Squares to mark (hints). */
  marks?: string[];
  /** A move to show as an arrow (a proposed move), UCI. */
  arrow?: Uci | null;
  /** The moves compared after an answer, each as an arrow in its own colour. */
  arrows?: { uci: Uci; who: Who }[];
  /** Pieces that can be taken: a red ring, and a thin arrow from what takes it. */
  rings?: { square: string; from?: string }[];
  /** The rating of a move, as a mark on the corner of the square its piece stands on. */
  badge?: { square: string; text: string; tone: 'good' | 'mid' | 'bad' } | null;
  /** Whose line is being played through: the last move is tinted in that colour. */
  line?: Who | null;
  onMove?: (uci: Uci) => void;
  /** Bump to force the board back to `fen` after a rejected move. */
  resetKey?: number;
  label?: string;
  /** A brief signal on the board itself: `right:<n>` or `wrong:<n>`; a new value plays it again. */
  flash?: string | null;
}

/** Asks the board on screen to turn round (sent by the run bar). */
export const FLIP_EVENT = 'trainer:flip-board';

const PROMOTION: { role: 'q' | 'r' | 'b' | 'n'; name: string; glyph: string }[] = [
  { role: 'q', name: 'Queen', glyph: '♛' },
  { role: 'r', name: 'Rook', glyph: '♜' },
  { role: 'b', name: 'Bishop', glyph: '♝' },
  { role: 'n', name: 'Knight', glyph: '♞' },
];

export function Board({ fen, orientation, movable, lastMove, marks, arrow, arrows, rings, badge, line, onMove, resetKey = 0, label, flash }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [flipped, setFlipped] = useState(false);
  /** Bumped to re-apply the whole position (pieces, legal moves, handlers) after a cancelled promotion. */
  const [redraw, setRedraw] = useState(0);
  const pos = useMemo(() => positionFromFen(fen), [fen]);
  const remeasure = () => api.current?.state.dom.bounds.clear();
  const shapes = JSON.stringify([marks ?? [], arrow ?? null, arrows ?? [], rings ?? [], badge ?? null]);
  const shown: Color = flipped ? (orientation === 'white' ? 'black' : 'white') : orientation;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { coordinates: true, animation: { enabled: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, duration: 240 }, premovable: { enabled: false }, drawable: { enabled: false, visible: true, brushes: { ...LINE_BRUSH, loose: { key: 'loose', color: '#b0362d', opacity: 1, lineWidth: 10 } } as never } });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    setPromo(null);
    const config: Config = {
      fen,
      orientation: shown,
      turnColor: pos.turn,
      check: isCheck(pos) ? pos.turn : false,
      lastMove: lastMove ? ([lastMove.slice(0, 2), lastMove.slice(2, 4)] as Key[]) : undefined,
      movable: {
        free: false,
        color: movable && movable === pos.turn ? movable : undefined,
        dests: movable && movable === pos.turn ? (legalDests(pos) as Map<Key, Key[]>) : new Map(),
        showDests: true,
        events: {
          after: (from, to) => {
            if (needsPromotion(pos, from, to)) setPromo({ from, to });
            else onMoveRef.current?.(`${from}${to}`);
          },
        },
      },
      drawable: {
        autoShapes: [
          ...(marks ?? []).map((sq): DrawShape => ({ orig: sq as Key, brush: 'yellow' })),
          ...(arrow ? [{ orig: arrow.slice(0, 2) as Key, dest: arrow.slice(2, 4) as Key, brush: 'yellow' } satisfies DrawShape] : []),
          ...(arrows ?? []).map((a): DrawShape => ({ orig: a.uci.slice(0, 2) as Key, dest: a.uci.slice(2, 4) as Key, brush: a.who })),
          ...(rings ?? []).flatMap((r): DrawShape[] => [
            { orig: r.square as Key, brush: 'loose' },
            ...(r.from ? [{ orig: r.from as Key, dest: r.square as Key, brush: 'loose', modifiers: { lineWidth: 5 } } satisfies DrawShape] : []),
          ]),
          ...(badge ? [{ orig: badge.square as Key, label: { text: badge.text, fill: TONE[badge.tone] } } satisfies DrawShape] : []),
        ],
      },
    };
    cg.set(config);
    // The shapes are compared by what they are, not by which array holds them this time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, shown, movable, lastMove, shapes, pos, resetKey, redraw]);

  // A run page has its flip control in the bar at the top, not under each board.
  useEffect(() => {
    const flip = () => setFlipped((f) => !f);
    window.addEventListener(FLIP_EVENT, flip);
    return () => window.removeEventListener(FLIP_EVENT, flip);
  }, []);

  useEffect(() => {
    const box = wrap.current;
    if (!flash || !box) return;
    const cls = `flash-${flash.split(':')[0]}`;
    box.classList.remove('flash-right', 'flash-wrong');
    void box.offsetWidth; // restart the animation when the same signal is given twice
    box.classList.add(cls);
    const t = setTimeout(() => box.classList.remove(cls), 700);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    // Chessground remembers where the board is on screen and only re-measures on scroll or
    // resize. When something above the board appears or disappears (a notice, the offline
    // strip) the board moves without either, and a tap would land on the wrong square. So
    // the board is measured again at the start of every touch, before Chessground sees it.
    <div className="board-wrap" ref={wrap} data-line={line ?? undefined} onTouchStartCapture={remeasure} onMouseDownCapture={remeasure} onPointerDownCapture={remeasure}>
      <div
        className="board" ref={el} role="img" aria-label={label ?? `Chess board, ${pos.turn} to move`} data-fen={fen} data-turn={pos.turn} data-orientation={shown} data-movable={movable && movable === pos.turn ? movable : 'none'}
        data-arrows={(arrows ?? []).map((a) => `${a.who}:${a.uci}`).join(' ')} data-rings={(rings ?? []).map((r) => r.square).join(' ')} data-badge={badge ? `${badge.text}@${badge.square}` : ''}
      />
      {promo && (
        <div className="promo" role="dialog" aria-label="Choose promotion piece">
          {PROMOTION.map((p) => (
            <button key={p.role} onClick={() => { setPromo(null); onMoveRef.current?.(`${promo.from}${promo.to}${p.role}`); }} aria-label={`Promote to ${p.name}`}>
              <span aria-hidden>{p.glyph}</span>
              {p.name}
            </button>
          ))}
          <button className="quiet" data-testid="promo-cancel" onClick={() => { setPromo(null); setRedraw((n) => n + 1); }}>Cancel</button>
        </div>
      )}
      <button className="flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip board">Flip</button>
    </div>
  );
}
