/**
 * The deep-dive charts (ADR-062), plain SVG like src/ui/charts.tsx: an opening tree as an
 * icicle, a two-sided bar, a board of where pieces fell, a row of colour per game, two clock
 * lines, dots on a worse–better axis, rates by band. Colour for standing and score is one
 * diverging ramp (`--dv-*`: red, gray at level, blue), won/drawn/lost are blue/gray/red with a
 * legend, and every chart names what it shows. Tapping a mark shows its values in a readout.
 */
import type { ReactNode } from 'react';
import type { Rate } from '../progress/series';
import type { Ribbon, TreeNode, StandingRow, ClockPoint, Results, Castle } from '../progress/deep';

const W = 330;
const pct = (x: number) => `${Math.round(100 * x)}%`;

function Readout({ children }: { children: ReactNode }) {
  return <div className="ch-readout" aria-live="polite">{children}</div>;
}

function Hit({ x, y, w, h, onPick, label }: { x: number; y: number; w: number; h: number; onPick: () => void; label: string }) {
  return <rect x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} fill="transparent" className="ch-hit" onClick={onPick} onPointerEnter={(e) => e.pointerType === 'mouse' && onPick()} aria-label={label} />;
}

/** One of seven steps of the diverging ramp for an expected score or a score, 0–100. */
export function dvStep(v: number): string {
  if (v < 15) return 'dv-n3';
  if (v < 35) return 'dv-n2';
  if (v < 45) return 'dv-n1';
  if (v <= 55) return 'dv-0';
  if (v <= 65) return 'dv-p1';
  if (v <= 85) return 'dv-p2';
  return 'dv-p3';
}
const DV = ['dv-n3', 'dv-n2', 'dv-n1', 'dv-0', 'dv-p1', 'dv-p2', 'dv-p3'];

/** The ramp as a legend: worse on the left, better on the right. */
export function RampLegend({ left = 'Worse', mid = 'Level', right = 'Better' }: { left?: string; mid?: string; right?: string }) {
  return (
    <div className="ramp-legend" aria-hidden>
      <span>{left}</span>
      <span className="ramp-steps">{DV.map((c) => <span key={c} className={`ramp-step ${c}`} />)}</span>
      <span>{right}</span>
      <span className="ramp-mid">{mid} in the middle</span>
    </div>
  );
}

// ---------------------------------------------------------------- openings

/** Score bin of a tree cell: mostly won, mixed, mostly lost; under three games, few. */
export function scoreClass(r: Results): string {
  if (r.n < 3 || r.score === null) return 'oc-few';
  if (r.score >= 0.6) return 'oc-won';
  if (r.score <= 0.4) return 'oc-lost';
  return 'oc-mixed';
}

export function resultsText(r: Results): string {
  return `${r.n} game${r.n === 1 ? '' : 's'} · ${r.w} won, ${r.d} drawn, ${r.l} lost`;
}

/** SAN path with move numbers: "1.e4 e5 2.Nf3". */
export function lineText(path: string[]): string {
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

/** A cell of the icicle: a move, or several rare moves folded into one ("+3"). */
export interface IcicleCell {
  node: TreeNode;
  /** How many moves were folded into this cell, when it stands for several. */
  others?: number;
}

/** Cells narrower than this are folded together with the rest of their rare siblings. */
const MIN_CELL = 16;

/**
 * The opening tree as an icicle: one band per ply, each cell as wide as the share of games
 * that went that way, coloured by his score from them. Rare moves at the end of a band are one
 * outlined cell, "+n".
 */
export function OpeningIcicle({ root, plies, rowH = 28, interactive, title, onPick, picked }: { root: TreeNode; plies: number; rowH?: number; interactive?: boolean; title: string; onPick?: (c: IcicleCell) => void; picked?: string[] | null }) {
  const gap = 2;
  const H = plies * (rowH + gap);
  const cells: { c: IcicleCell; x: number; w: number; d: number }[] = [];
  const lay = (n: TreeNode, x: number, w: number, d: number) => {
    if (d >= plies) return;
    let at = x;
    const kids = n.children;
    const width = (k: TreeNode) => (w * k.games.length) / Math.max(1, n.games.length);
    // From the first child that is too narrow, the rest (all narrower still) are folded.
    const cut = kids.findIndex((k, i) => i > 0 && width(k) < MIN_CELL);
    const shown = cut < 0 || kids.length - cut < 2 ? kids : kids.slice(0, cut);
    for (const k of shown) {
      const cw = width(k);
      cells.push({ c: { node: k }, x: at, w: cw, d });
      // Under a cell too narrow to read, nothing more is drawn: a tap on it gives its games.
      if (cw >= 1.5 * MIN_CELL) lay(k, at, cw, d + 1);
      at += cw;
    }
    if (shown.length < kids.length) {
      const rest = kids.slice(shown.length);
      const games = rest.flatMap((k) => k.games);
      const r = { n: 0, w: 0, d: 0, l: 0, score: null as number | null };
      for (const k of rest) {
        r.n += k.results.n;
        r.w += k.results.w;
        r.d += k.results.d;
        r.l += k.results.l;
      }
      r.score = r.n ? (r.w + r.d / 2) / r.n : null;
      const node: TreeNode = { path: [...n.path, `+${rest.length}`], san: `+${rest.length}`, games, results: r, name: null, children: [] };
      cells.push({ c: { node, others: rest.length }, x: at, w: x + w - at, d });
    }
  };
  lay(root, 0, W, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {cells.map(({ c, x, w: cw, d }, i) => {
        const y = d * (rowH + gap);
        const w = Math.max(0, cw - (cw > 4 ? gap : 0));
        const on = !!picked && picked.join(' ') === c.node.path.join(' ');
        const cls = c.others ? 'oc-few' : scoreClass(c.node.results);
        return (
          <g key={i}>
            <rect x={x + (c.others ? 0.6 : 0)} y={y + (c.others ? 0.6 : 0)} width={Math.max(0, w - (c.others ? 1.2 : 0))} height={rowH - (c.others ? 1.2 : 0)} rx={Math.min(4, w / 2)} className={`oc ${cls}${on ? ' is-picked' : ''}`} />
            {w >= (c.others ? 22 : 26) && rowH >= 18 && <text x={x + w / 2} y={y + rowH / 2 + 4} textAnchor="middle" className={`oc-label ${cls}`}>{c.node.san}</text>}
            {interactive && onPick && <Hit x={x} y={y} w={cw} h={rowH + gap} onPick={() => onPick(c)} label={c.others ? `${c.others} other moves: ${c.node.games.length} games` : `${lineText(c.node.path)}: ${resultsText(c.node.results)}`} />}
          </g>
        );
      })}
    </svg>
  );
}

export function ScoreLegend() {
  return (
    <ul className="ch-legend">
      <li><span className="sw oc-won" aria-hidden />Mostly won</li>
      <li><span className="sw oc-mixed" aria-hidden />Mixed</li>
      <li><span className="sw oc-lost" aria-hidden />Mostly lost</li>
      <li><span className="sw oc-few" aria-hidden />Under 3 games</li>
    </ul>
  );
}

/** A thin won/drawn/lost bar, no text: the row beside it carries the figures. */
export function WdlBar({ r }: { r: Results }) {
  const parts = [
    { k: 'w', v: r.w },
    { k: 'd', v: r.d },
    { k: 'l', v: r.l },
  ].filter((p) => p.v > 0);
  return (
    <span className="wdl" role="img" aria-label={`${r.w} won, ${r.d} drawn, ${r.l} lost`}>
      {parts.map((p) => <span key={p.k} className={`wdl-${p.k}`} style={{ flexGrow: p.v }} />)}
    </span>
  );
}

export function WdlLegend() {
  return (
    <ul className="ch-legend">
      <li><span className="sw wdl-w" aria-hidden />Won</li>
      <li><span className="sw wdl-d" aria-hidden />Drawn</li>
      <li><span className="sw wdl-l" aria-hidden />Lost</li>
    </ul>
  );
}

/**
 * Dots on one worse–level–better axis, a row per group, one dot per game; dots that would
 * touch are stacked. The level band (40 to 60) is shaded.
 */
export function StandingDots({ rows, title, onPick, picked }: { rows: StandingRow[]; title: string; onPick?: (p: { label: string; i: number }) => void; picked?: { label: string; i: number } | null }) {
  const L = 92;
  const R = 8;
  const r = 4.5;
  const lane = 9.5;
  const sx = (v: number) => L + (v / 100) * (W - L - R);
  const laid = rows.map((row) => {
    const placed: { x: number; lane: number; i: number; wp: number }[] = [];
    row.points.map((p, i) => ({ x: sx(p.wp), i, wp: p.wp })).sort((a, b) => a.x - b.x).forEach((p) => {
      let k = 0;
      while (placed.some((q) => q.lane === k && Math.abs(q.x - p.x) < 2 * r + 1)) k++;
      placed.push({ ...p, lane: Math.min(k, 3) });
    });
    const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
    return { row, placed, h: Math.max(24, lanes * lane + 10) };
  });
  const H = laid.reduce((t, x) => t + x.h, 0) + 18;
  let y0 = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      <rect x={sx(40)} y={0} width={sx(60) - sx(40)} height={H - 18} className="lvl-band" />
      <line x1={sx(50)} x2={sx(50)} y1={0} y2={H - 18} className="ch-grid" />
      {laid.map(({ row, placed, h }) => {
        const top = y0;
        y0 += h;
        const mid = top + h / 2;
        const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
        return (
          <g key={row.label}>
            <text x={0} y={mid + 4} className="ch-label">{row.label.length > 14 ? `${row.label.slice(0, 13)}…` : row.label}</text>
            {placed.map((p) => {
              const cy = mid + (p.lane - (lanes - 1) / 2) * lane;
              const on = picked?.label === row.label && picked.i === p.i;
              return (
                <g key={p.i}>
                  <circle cx={p.x} cy={cy} r={r} className={`sd ${dvStep(p.wp)}`} />
                  {on && <circle cx={p.x} cy={cy} r={r + 3} className="ch-pick" />}
                  {onPick && <Hit x={p.x - 7} y={cy - 7} w={14} h={14} onPick={() => onPick({ label: row.label, i: p.i })} label={`${row.label}: ${Math.round(p.wp)}`} />}
                </g>
              );
            })}
            <line x1={L} x2={W - R} y1={top + h} y2={top + h} className="ch-grid" />
          </g>
        );
      })}
      <text x={L} y={H - 3} className="ch-axis">Worse</text>
      <text x={sx(50)} y={H - 3} className="ch-axis" textAnchor="middle">Level</text>
      <text x={W - R} y={H - 3} className="ch-axis" textAnchor="end">Better</text>
    </svg>
  );
}

// ---------------------------------------------------------------- two-sided bars

export interface SideRow {
  key: string;
  label: string;
  left: number;
  /** Filled part of the right bar, then the outlined part after it. */
  right: number;
  rightHollow?: number;
}

/**
 * A two-sided bar per row on one count scale: the left bar grows left from the middle, the
 * right one right; the row's name sits in the middle column, the counts at the bar ends.
 */
export function SideBars({ rows, headLeft, headRight, title, onPick, picked, compact }: { rows: SideRow[]; headLeft: string; headRight: string; title: string; onPick?: (key: string) => void; picked?: string | null; compact?: boolean }) {
  const mid = compact ? 92 : 104;
  const cx = W / 2;
  const half = cx - mid / 2 - 4;
  const rowH = compact ? 18 : 26;
  const bar = compact ? 9 : 12;
  const top = compact ? 0 : 18;
  const H = top + rows.length * rowH + 2;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.left, r.right + (r.rightHollow ?? 0))));
  const sc = (v: number) => (v / max) * (half - 22);
  const lx = cx - mid / 2 - 2;
  const rx = cx + mid / 2 + 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {!compact && (
        <>
          <text x={lx} y={11} className="ch-axis" textAnchor="end">{headLeft}</text>
          <text x={rx} y={11} className="ch-axis">{headRight}</text>
        </>
      )}
      {rows.map((r, i) => {
        const y = top + i * rowH;
        const by = y + (rowH - bar) / 2;
        const lw = sc(r.left);
        const fw = sc(r.right);
        const hw = sc(r.rightHollow ?? 0);
        const on = picked === r.key;
        return (
          <g key={r.key}>
            {on && <rect x={0} y={y} width={W} height={rowH} className="ch-pickbar" rx={4} />}
            <text x={cx} y={y + rowH / 2 + 4} textAnchor="middle" className="ch-label">{r.label}</text>
            {lw > 0 && <rect x={lx - lw} y={by} width={lw} height={bar} rx={Math.min(3, lw / 2)} className="sb-left" />}
            <text x={lx - lw - 4} y={y + rowH / 2 + 4} textAnchor="end" className="ch-value">{r.left}</text>
            {fw > 0 && <rect x={rx} y={by} width={fw} height={bar} rx={Math.min(3, fw / 2)} className="sb-right" />}
            {hw > 0 && <rect x={rx + fw + (fw > 0 ? 2 : 0) + 0.75} y={by + 0.75} width={Math.max(0, hw - 1.5)} height={bar - 1.5} rx={Math.min(3, hw / 2)} className="sb-hollow" />}
            <text x={rx + fw + hw + (fw > 0 && hw > 0 ? 2 : 0) + 4} y={y + rowH / 2 + 4} className="ch-value">{r.rightHollow !== undefined ? `${r.right}/${r.right + r.rightHollow}` : r.right}</text>
            {onPick && <Hit x={0} y={y} w={W} h={rowH} onPick={() => onPick(r.key)} label={`${r.label}: ${headLeft} ${r.left}, ${headRight} ${r.right}${r.rightHollow !== undefined ? ` of ${r.right + r.rightHollow}` : ''}`} />}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- the board

const GLYPH: Record<string, string> = { queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' };

/**
 * The board from his side, each square shaded by how often a piece of his was taken there;
 * the count is printed on the square.
 */
export function LossBoard({ squares, title, onPick, picked }: { squares: Record<string, number>; title: string; onPick?: (sq: string) => void; picked?: string | null }) {
  const L = 14;
  const size = (W - L - 2 * 40) / 8;
  const x0 = L + 40;
  const H = size * 8 + 16;
  const max = Math.max(1, ...Object.values(squares));
  const files = 'abcdefgh';
  const step = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((4 * n) / max)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {[...Array(8)].map((_, r) =>
        [...Array(8)].map((__, f) => {
          const sq = `${files[f]}${8 - r}`;
          const n = squares[sq] ?? 0;
          const x = x0 + f * size;
          const y = r * size;
          const light = (f + r) % 2 === 0;
          return (
            <g key={sq}>
              <rect x={x} y={y} width={size} height={size} className={light ? 'lb-light' : 'lb-dark'} />
              {n > 0 && <rect x={x + 2} y={y + 2} width={size - 4} height={size - 4} rx={4} className={`lb-heat lb-${step(n)}`} />}
              {n > 0 && <text x={x + size / 2} y={y + size / 2 + 5} textAnchor="middle" className={`lb-count lb-${step(n)}`}>{n}</text>}
              {picked === sq && <rect x={x + 1} y={y + 1} width={size - 2} height={size - 2} rx={5} className="ch-pick" />}
              {onPick && <Hit x={x} y={y} w={size} h={size} onPick={() => onPick(sq)} label={`${sq}: ${n}`} />}
            </g>
          );
        }),
      )}
      {[...Array(8)].map((_, r) => <text key={r} x={x0 - 6} y={r * size + size / 2 + 4} textAnchor="end" className="ch-axis">{8 - r}</text>)}
      {[...files].map((f, i) => <text key={f} x={x0 + i * size + size / 2} y={H - 3} textAnchor="middle" className="ch-axis">{f}</text>)}
    </svg>
  );
}

/** The five kinds of piece with how many of each were lost. */
export function PieceCounts({ pieces }: { pieces: Record<string, number> }) {
  const order = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
  const max = Math.max(1, ...order.map((k) => pieces[k] ?? 0));
  return (
    <ul className="pieces" aria-label={order.map((k) => `${pieces[k] ?? 0} ${k}${(pieces[k] ?? 0) === 1 ? '' : 's'}`).join(', ')}>
      {order.map((k) => (
        <li key={k} className={(pieces[k] ?? 0) === max && max > 0 ? 'is-top' : ''}>
          <span className="piece-glyph" aria-hidden>{GLYPH[k]}{'︎'}</span>
          <span className="piece-n">{pieces[k] ?? 0}</span>
          <span className="piece-name">{k === 'knight' ? 'Knights' : `${k[0]!.toUpperCase()}${k.slice(1)}s`}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- games as rows

/**
 * Games as rows, newest on top: one cell per move of his, coloured by his expected score
 * before it; a dot on each big mistake; the result at the end.
 */
export function GameRibbons({ rows, maxMove = 50, rowH = 11, title, onPick, picked, compact }: { rows: Ribbon[]; maxMove?: number; rowH?: number; title: string; onPick?: (i: number) => void; picked?: number | null; compact?: boolean }) {
  const R = compact ? 0 : 18;
  const B = compact ? 0 : 14;
  const gap = 2;
  const longest = Math.min(maxMove, Math.max(10, ...rows.map((r) => r.cells[r.cells.length - 1]?.move ?? 0)));
  const cw = (W - R) / longest;
  const H = rows.length * (rowH + gap) + B;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {rows.map((r, i) => {
        const y = i * (rowH + gap);
        const mis = new Set(r.mistakes);
        return (
          <g key={r.game.id}>
            {r.cells.filter((c) => c.move <= longest).map((c) => (
              <rect key={c.ply} x={(c.move - 1) * cw} y={y} width={Math.max(0.5, cw - (cw > 3 ? 1 : 0))} height={rowH} className={`rb ${dvStep(c.wp)}`} />
            ))}
            {!compact && [...mis].filter((m) => m <= longest).map((m) => <circle key={m} cx={(m - 0.5) * cw} cy={y + rowH / 2} r={Math.min(2.4, rowH / 4)} className="rb-mistake" />)}
            {!compact && <text x={W - R + 5} y={y + rowH - 2} className="ch-axis rb-result">{r.game.result === 'win' ? 'W' : r.game.result === 'loss' ? 'L' : r.game.result === 'draw' ? 'D' : '·'}</text>}
            {picked === i && <rect x={-1} y={y - 1} width={W - R + 2} height={rowH + 2} rx={2} className="ch-pick" />}
            {onPick && <Hit x={0} y={y} w={W} h={rowH + gap} onPick={() => onPick(i)} label={`${r.game.endDate}: ${r.game.result ?? 'no result'}`} />}
          </g>
        );
      })}
      {!compact && [1, 10, 20, 30, 40, 50].filter((m) => m <= longest).map((m) => <text key={m} x={(m - 0.5) * cw} y={H - 2} textAnchor="middle" className="ch-axis">{m}</text>)}
    </svg>
  );
}

// ---------------------------------------------------------------- the clock

/** Two lines over move number on one 0–100% axis: his clock (with its middle half as a band) and his opponents'. */
export function ClockLines({ you, them, title, onPick, picked }: { you: ClockPoint[]; them: ClockPoint[]; title: string; onPick?: (move: number) => void; picked?: number | null }) {
  const H = 150;
  const L = 34;
  const R = 52;
  const T = 8;
  const B = 18;
  const last = Math.max(you[you.length - 1]?.move ?? 1, them[them.length - 1]?.move ?? 1);
  const sx = (m: number) => L + ((m - 1) / Math.max(1, last - 1)) * (W - L - R);
  const sy = (v: number) => T + (1 - Math.min(1, v)) * (H - T - B);
  const path = (ps: ClockPoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${sx(p.move).toFixed(1)},${sy(p.median).toFixed(1)}`).join(' ');
  const band = you.length ? `${you.map((p, i) => `${i ? 'L' : 'M'}${sx(p.move).toFixed(1)},${sy(p.q3).toFixed(1)}`).join(' ')} ${you.slice().reverse().map((p) => `L${sx(p.move).toFixed(1)},${sy(p.q1).toFixed(1)}`).join(' ')} Z` : '';
  const ly = you[you.length - 1];
  const lt = them[them.length - 1];
  // End labels that would touch are moved apart, each keeping a short leader to its line.
  let yy = ly ? sy(ly.median) : 0;
  let ty = lt ? sy(lt.median) : 0;
  if (ly && lt && Math.abs(yy - ty) < 13) {
    const m = (yy + ty) / 2;
    if (yy <= ty) { yy = m - 7; ty = m + 7; } else { yy = m + 7; ty = m - 7; }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="ch-grid" />
          <text x={L - 4} y={sy(t) + 4} className="ch-axis" textAnchor="end">{pct(t)}</text>
        </g>
      ))}
      {[1, 10, 20, 30, 40].filter((m) => m <= last).map((m) => <text key={m} x={sx(m)} y={H - 3} className="ch-axis" textAnchor="middle">{m}</text>)}
      {band && <path d={band} className="ch-band" />}
      {them.length > 1 && <path d={path(them)} className="ch-line is-them" />}
      {you.length > 1 && <path d={path(you)} className="ch-line" />}
      {lt && <><circle cx={sx(lt.move)} cy={sy(lt.median)} r={4} className="ch-end is-them" /><text x={sx(lt.move) + 7} y={ty + 4} className="ch-value">Them</text></>}
      {ly && <><circle cx={sx(ly.move)} cy={sy(ly.median)} r={4} className="ch-end" /><text x={sx(ly.move) + 7} y={yy + 4} className="ch-value">You</text></>}
      {picked != null && <line x1={sx(picked)} x2={sx(picked)} y1={T} y2={H - B} className="ch-cross" />}
      {onPick && you.map((p, i) => {
        const x0 = i ? (sx(you[i - 1]!.move) + sx(p.move)) / 2 : L;
        const x1 = you[i + 1] ? (sx(you[i + 1]!.move) + sx(p.move)) / 2 : W - R;
        return <Hit key={p.move} x={x0} y={0} w={x1 - x0} h={H} onPick={() => onPick(p.move)} label={`Move ${p.move}`} />;
      })}
    </svg>
  );
}

export function TwoLineLegend({ a, b }: { a: string; b: string }) {
  return (
    <ul className="ch-legend">
      <li><span className="sw line-sw" aria-hidden />{a}</li>
      <li><span className="sw line-sw is-them" aria-hidden />{b}</li>
    </ul>
  );
}

// ---------------------------------------------------------------- castling

/** One dot per game at the move he castled, stacked; games where he never did in their own pile. */
export function CastleDots({ castles, upTo = 20, title }: { castles: Castle[]; upTo?: number; title: string }) {
  const cols = upTo + 1;
  const L = 0;
  const step = (W - L - 36) / upTo;
  const r = Math.min(4.5, step / 2 - 0.8);
  const col = (c: Castle) => (c.move === null ? cols : Math.min(c.move, upTo));
  const counts = new Map<number, number>();
  const placed = castles.map((c) => {
    const k = col(c);
    const i = counts.get(k) ?? 0;
    counts.set(k, i + 1);
    return { c, k, i };
  });
  // A column taller than CAP dots shows CAP and its count above them.
  const CAP = 10;
  const tall = Math.min(CAP, Math.max(3, ...counts.values()));
  const H = tall * (2 * r + 2) + 34;
  const cx = (k: number) => (k === cols ? W - 16 : L + (k - 0.5) * step);
  const cy = (i: number) => H - 20 - r - i * (2 * r + 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      <line x1={L + 10 * step} x2={L + 10 * step} y1={0} y2={H - 16} className="ch-marker-line" />
      {placed.filter((p) => p.i < CAP).map(({ c, k, i }) => <circle key={c.game.id} cx={cx(k)} cy={cy(i)} r={r} className={c.side === 'queen' ? 'cd is-queen' : c.side === 'king' ? 'cd' : 'cd is-never'} />)}
      {[...counts.entries()].filter(([, v]) => v > CAP).map(([k, v]) => <text key={k} x={cx(k)} y={cy(CAP - 1) - r - 4} textAnchor="middle" className="ch-value">{v}</text>)}
      {[1, 5, 10, 15, 20].map((m) => <text key={m} x={cx(m)} y={H - 4} textAnchor="middle" className="ch-axis">{m === 20 ? '20+' : m}</text>)}
      <text x={W - 16} y={H - 4} textAnchor="middle" className="ch-axis">Never</text>
    </svg>
  );
}

// ---------------------------------------------------------------- rates by band

/** A point with its 95% range per band, on one 0–100% axis, never joined. */
export function RateColumns({ cols, title, onPick, picked }: { cols: { key: string; label: string; rate: Rate }[]; title: string; onPick?: (i: number) => void; picked?: number | null }) {
  const H = 120;
  const L = 34;
  const R = 8;
  const T = 8;
  const B = 18;
  const step = (W - L - R) / Math.max(1, cols.length);
  const cx = (i: number) => L + step * (i + 0.5);
  const sy = (y: number) => T + (1 - y) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="ch-grid" />
          <text x={L - 4} y={sy(t) + 4} className="ch-axis" textAnchor="end">{pct(t)}</text>
        </g>
      ))}
      {cols.map((c, i) => (
        <g key={c.key}>
          {c.rate.n > 1 && <line x1={cx(i)} x2={cx(i)} y1={sy(c.rate.hi)} y2={sy(c.rate.lo)} className="ch-range" />}
          <circle cx={cx(i)} cy={sy(c.rate.rate ?? 0)} r={c.rate.n >= 5 ? 5 : 4} className={c.rate.n >= 5 ? 'ch-end' : 'ch-faint'} />
          {picked === i && <circle cx={cx(i)} cy={sy(c.rate.rate ?? 0)} r={8.5} className="ch-pick" />}
          <text x={cx(i)} y={H - 3} className="ch-axis" textAnchor="middle">{c.label}</text>
          {onPick && <Hit x={cx(i) - step / 2} y={0} w={step} h={H} onPick={() => onPick(i)} label={`${c.label}: ${c.rate.k} of ${c.rate.n}`} />}
        </g>
      ))}
    </svg>
  );
}

export { Readout };
