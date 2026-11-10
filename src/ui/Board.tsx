import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Color, isCheck, legalDests, needsPromotion, positionFromFen, type Uci } from '../chess/rules';

export interface BoardProps {
  fen: string;
  orientation: Color;
  /** Which side the learner may move; null makes the board display-only. */
  movable: Color | null;
  lastMove?: Uci | null;
  /** Squares to mark (hints). */
  marks?: string[];
  onMove?: (uci: Uci) => void;
  /** Bump to force the board back to `fen` after a rejected move. */
  resetKey?: number;
  label?: string;
}

const PROMOTION: { role: 'q' | 'r' | 'b' | 'n'; name: string; glyph: string }[] = [
  { role: 'q', name: 'Queen', glyph: '♛' },
  { role: 'r', name: 'Rook', glyph: '♜' },
  { role: 'b', name: 'Bishop', glyph: '♝' },
  { role: 'n', name: 'Knight', glyph: '♞' },
];

export function Board({ fen, orientation, movable, lastMove, marks, onMove, resetKey = 0, label }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const pos = useMemo(() => positionFromFen(fen), [fen]);
  const shown: Color = flipped ? (orientation === 'white' ? 'black' : 'white') : orientation;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { coordinates: true, animation: { duration: 180 }, premovable: { enabled: false }, drawable: { enabled: false, visible: true } });
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
      drawable: { autoShapes: (marks ?? []).map((sq): DrawShape => ({ orig: sq as Key, brush: 'yellow' })) },
    };
    cg.set(config);
  }, [fen, shown, movable, lastMove, marks, pos, resetKey]);

  return (
    <div className="board-wrap">
      <div className="board" ref={el} role="img" aria-label={label ?? `Chess board, ${pos.turn} to move`} data-fen={fen} data-turn={pos.turn} data-orientation={shown} data-movable={movable && movable === pos.turn ? movable : 'none'} />
      {promo && (
        <div className="promo" role="dialog" aria-label="Choose promotion piece">
          {PROMOTION.map((p) => (
            <button key={p.role} onClick={() => { setPromo(null); onMoveRef.current?.(`${promo.from}${promo.to}${p.role}`); }} aria-label={`Promote to ${p.name}`}>
              <span aria-hidden>{p.glyph}</span>
              {p.name}
            </button>
          ))}
          <button className="quiet" onClick={() => { setPromo(null); api.current?.set({ fen }); }}>Cancel</button>
        </div>
      )}
      <button className="flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip board">Flip</button>
    </div>
  );
}
