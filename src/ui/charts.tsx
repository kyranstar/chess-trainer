/**
 * The Progress charts (ADR-061), drawn as plain SVG: no chart library, so the bundle stays
 * whole offline. Five patterns, one per kind of data: game squares, a trajectory over game
 * number, dot-and-range rows on one 0–100% axis, blocks of first looks, and status/activity.
 * Every chart says what it shows in its accessible name. Interactive charts show the values
 * of the mark tapped in a readout line under them (detail screens); on the overview the whole
 * card is a link and the charts are pictures.
 */
import { type ReactNode, useState } from 'react';
import type { CellState, ConceptCell, Day, Mark, Rate, RollingPoint } from '../progress/series';

const W = 330;
const pct = (x: number) => `${Math.round(100 * x)}%`;

function Readout({ text }: { text: ReactNode }) {
  return <p className="ch-readout" aria-live="polite">{text}</p>;
}

/** A transparent hit area bigger than the mark, so a tap lands. */
function Hit({ x, y, w, h, onPick, label }: { x: number; y: number; w: number; h: number; onPick: () => void; label: string }) {
  return <rect x={x} y={y} width={w} height={h} fill="transparent" className="ch-hit" onClick={onPick} onPointerEnter={(e) => e.pointerType === 'mouse' && onPick()} aria-label={label} />;
}

export interface Square {
  /** Filled: the event the chart counts happened (an early blunder in that game). */
  filled: boolean;
  /** Not measured yet: drawn faint, counted nowhere. */
  pending?: boolean;
  label: string;
}

/**
 * Games as squares in rows of up to 20, oldest row first. `rows` gives each row a name and its
 * games; a tick marks where training began.
 */
export function GameSquares({ rows, interactive, marker, title }: { rows: { name: string; squares: Square[]; markerAt?: number | null }[]; interactive?: boolean; marker?: string; title: string }) {
  const [pick, setPick] = useState<{ r: number; i: number } | null>(null);
  const per = 20;
  const gap = 3;
  const size = (W - 70 - gap * (per - 1)) / per;
  const rowH = size + 16;
  const H = rows.length * rowH;
  const picked = pick ? rows[pick.r]?.squares[pick.i] : null;
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        {rows.map((row, r) => {
          const y = r * rowH + 12;
          return (
            <g key={row.name}>
              <text x={0} y={y + size - 2} className="ch-label">{row.name}</text>
              {row.squares.map((s, i) => {
                const x = 70 + i * (size + gap);
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={size} height={size} rx={2.5} className={s.pending ? 'sq is-pending' : s.filled ? 'sq is-on' : 'sq'} />
                    {pick?.r === r && pick.i === i && <rect x={x - 1.5} y={y - 1.5} width={size + 3} height={size + 3} rx={3.5} className="sq-pick" />}
                    {interactive && <Hit x={x - 1.5} y={y - 6} w={size + 3} h={size + 12} onPick={() => setPick({ r, i })} label={s.label} />}
                  </g>
                );
              })}
              {row.markerAt != null && (
                <g className="ch-marker">
                  <line x1={70 + row.markerAt * (size + gap) - gap / 2} x2={70 + row.markerAt * (size + gap) - gap / 2} y1={y - 8} y2={y + size + 3} />
                  {marker && r === rows.findIndex((x) => x.markerAt != null) && <text x={Math.min(W - 2, 70 + row.markerAt * (size + gap))} y={y - 3} className="ch-tick" textAnchor="end">{marker}</text>}
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {interactive && <Readout text={picked ? picked.label : 'Tap a square for that game.'} />}
    </div>
  );
}

export interface LinePoint {
  x: number;
  y: number;
  label?: string;
}

/**
 * A trajectory over an index (game number, move number): the line, an optional band (lo–hi)
 * and optional faint dots (single observations behind a pooled line). The latest value is
 * labelled at the end; a tick marks where training began.
 */
export function LineChart(props: {
  points: LinePoint[];
  band?: { x: number; lo: number; hi: number }[];
  dots?: LinePoint[];
  markers?: { x: number; y: number; bad?: boolean; label: string }[];
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  height?: number;
  vline?: { x: number; label: string } | null;
  format: (y: number) => string;
  xLabel: string;
  title: string;
  interactive?: boolean;
  empty?: string;
}) {
  const { points, band = [], dots = [], markers = [], xMin, xMax, vline, format, interactive } = props;
  const [pick, setPick] = useState<number | null>(null);
  const H = props.height ?? 120;
  const L = 34;
  const R = 44;
  const T = 10;
  const B = 18;
  const ys = [...points.map((p) => p.y), ...band.flatMap((b) => [b.lo, b.hi]), ...dots.map((d) => d.y)];
  let yMin = props.yMin ?? Math.min(...ys);
  let yMax = props.yMax ?? Math.max(...ys);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMax - yMin < 1e-9) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = props.yMin === undefined ? (yMax - yMin) * 0.08 : 0;
  yMin -= pad;
  yMax += props.yMax === undefined ? pad : 0;
  const sx = (x: number) => L + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const area = band.length ? `${path(band.map((b) => ({ x: b.x, y: b.hi })))} ${band.slice().reverse().map((b) => `L${sx(b.x).toFixed(1)},${sy(b.lo).toFixed(1)}`).join(' ')} Z` : '';
  const last = points[points.length - 1];
  const picked = pick === null ? null : points.find((p) => p.x === pick) ?? dots.find((d) => d.x === pick) ?? null;
  const ticks = [yMin + pad, yMax - (props.yMax === undefined ? pad : 0)];
  const pickables = points.length ? points : dots;
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.title} className="ch-svg">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="ch-grid" />
            <text x={L - 4} y={sy(t) + 4} className="ch-axis" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        <text x={W - R} y={H - 3} className="ch-axis" textAnchor="end">{props.xLabel}</text>
        {vline && vline.x >= xMin && vline.x <= xMax && (
          <g className="ch-marker">
            <line x1={sx(vline.x) - 0.5} x2={sx(vline.x) - 0.5} y1={T - 4} y2={H - B} />
            <text x={sx(vline.x) - 3} y={T + 4} className="ch-tick" textAnchor="end">{vline.label}</text>
          </g>
        )}
        {area && <path d={area} className="ch-band" />}
        {dots.map((d, i) => <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={2.6} className="ch-dot" />)}
        {points.length > 1 && <path d={path(points)} className="ch-line" />}
        {points.length === 1 && <circle cx={sx(points[0]!.x)} cy={sy(points[0]!.y)} r={4} className="ch-end" />}
        {markers.map((m, i) => <circle key={i} cx={sx(m.x)} cy={sy(m.y)} r={4.5} className={m.bad ? 'ch-mark is-bad' : 'ch-mark'} />)}
        {last && (
          <>
            <circle cx={sx(last.x)} cy={sy(last.y)} r={4} className="ch-end" />
            <text x={sx(last.x) + 7} y={sy(last.y) + 4} className="ch-value">{format(last.y)}</text>
          </>
        )}
        {picked && <line x1={sx(picked.x)} x2={sx(picked.x)} y1={T} y2={H - B} className="ch-cross" />}
        {interactive &&
          pickables.map((p, i) => {
            const prev = pickables[i - 1];
            const next = pickables[i + 1];
            const x0 = prev ? (sx(prev.x) + sx(p.x)) / 2 : L;
            const x1 = next ? (sx(next.x) + sx(p.x)) / 2 : W - R + 8;
            return <Hit key={i} x={x0} y={0} w={Math.max(1, x1 - x0)} h={H} onPick={() => setPick(p.x)} label={p.label ?? format(p.y)} />;
          })}
      </svg>
      {interactive && <Readout text={picked ? picked.label ?? format(picked.y) : 'Tap the chart for a value.'} />}
    </div>
  );
}

/** Rows on one 0–100% axis, each a dot (the observed rate) and its 95% range. */
export function RangeRows({ rows, title }: { rows: { label: string; rate: Rate; bad?: boolean }[]; title: string }) {
  const L = 92;
  const R = 40;
  const rowH = 26;
  const H = rows.length * rowH + 16;
  const sx = (x: number) => L + x * (W - L - R);
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={4} y2={H - 14} className="ch-grid" />
            <text x={sx(t)} y={H - 2} className="ch-axis" textAnchor="middle">{pct(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 4 + i * rowH + rowH / 2;
          return (
            <g key={r.label}>
              <text x={0} y={y + 4} className="ch-label">{r.label}</text>
              {r.rate.n > 0 ? (
                <>
                  <line x1={sx(r.rate.lo)} x2={sx(r.rate.hi)} y1={y} y2={y} className={r.bad ? 'ch-range is-bad' : 'ch-range'} />
                  <circle cx={sx(r.rate.rate!)} cy={y} r={5} className={r.bad ? 'ch-end is-bad' : 'ch-end'} />
                  <text x={W - R + 6} y={y + 4} className="ch-value">{pct(r.rate.rate!)}</text>
                </>
              ) : (
                <text x={sx(0.5)} y={y + 4} className="ch-axis" textAnchor="middle">none yet</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Blocks of first looks, oldest first: a point per complete block with its 95% range, never
 * joined (each block is its own sample). The incomplete block is a faint hollow point.
 */
export function BlockChart({ blocks, pending, size, title, interactive, noun }: { blocks: Rate[]; pending: Mark[]; size: number; title: string; interactive?: boolean; noun: string }) {
  const [pick, setPick] = useState<number | null>(null);
  const H = 110;
  const L = 34;
  const R = 12;
  const T = 8;
  const B = 18;
  const slots = blocks.length + (pending.length ? 1 : 0);
  const step = (W - L - R) / Math.max(1, slots);
  const cx = (i: number) => L + step * (i + 0.5);
  const sy = (y: number) => T + (1 - y) * (H - T - B);
  const pend = pending.length ? { k: pending.filter((m) => m.ok).length, n: pending.length } : null;
  const label = (i: number) => {
    if (i < blocks.length) {
      const b = blocks[i]!;
      return `${noun} ${i * size + 1}–${(i + 1) * size}: ${b.k} of ${b.n}, ${pct(b.rate!)} (95% range ${pct(b.lo)}–${pct(b.hi)})`;
    }
    return `${noun} ${blocks.length * size + 1}–${blocks.length * size + pend!.n} so far: ${pend!.k} of ${pend!.n}`;
  };
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="ch-grid" />
            <text x={L - 4} y={sy(t) + 4} className="ch-axis" textAnchor="end">{pct(t)}</text>
          </g>
        ))}
        {blocks.map((b, i) => (
          <g key={i}>
            <line x1={cx(i)} x2={cx(i)} y1={sy(b.hi)} y2={sy(b.lo)} className="ch-range" />
            <line x1={cx(i) - 5} x2={cx(i) + 5} y1={sy(b.hi)} y2={sy(b.hi)} className="ch-range" />
            <line x1={cx(i) - 5} x2={cx(i) + 5} y1={sy(b.lo)} y2={sy(b.lo)} className="ch-range" />
            <circle cx={cx(i)} cy={sy(b.rate!)} r={5} className="ch-end" />
            {pick === i && <circle cx={cx(i)} cy={sy(b.rate!)} r={8.5} className="ch-pick" />}
            <text x={cx(i)} y={H - 3} className="ch-axis" textAnchor="middle">{i * size + 1}–{(i + 1) * size}</text>
          </g>
        ))}
        {pend && (
          <g>
            <circle cx={cx(blocks.length)} cy={sy(pend.k / pend.n)} r={4.5} className="ch-faint" />
            {pick === blocks.length && <circle cx={cx(blocks.length)} cy={sy(pend.k / pend.n)} r={8.5} className="ch-pick" />}
            <text x={cx(blocks.length)} y={H - 3} className="ch-axis" textAnchor="middle">+{pend.n}</text>
          </g>
        )}
        {interactive && Array.from({ length: slots }, (_, i) => <Hit key={i} x={cx(i) - step / 2} y={0} w={step} h={H} onPick={() => setPick(i)} label={label(i)} />)}
      </svg>
      {interactive && <Readout text={pick === null ? `Each point is ${size} ${noun.toLowerCase()} in a row. Tap one.` : label(pick)} />}
    </div>
  );
}

/** One mark per observation in order: filled when it happened, hollow when not. Wraps into rows. */
export function MarkStrip({ marks, title, labels }: { marks: { ok: boolean; label: string }[]; title: string; labels?: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const per = 25;
  const d = (W - 4) / per;
  const rows = Math.max(1, Math.ceil(marks.length / per));
  const H = rows * d + 4;
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        {marks.map((m, i) => {
          const x = 2 + (i % per) * d + d / 2;
          const y = 2 + Math.floor(i / per) * d + d / 2;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={d * 0.32} className={m.ok ? 'ch-pt is-on' : 'ch-pt'} />
              {pick === i && <circle cx={x} cy={y} r={d * 0.46} className="ch-pick" />}
              {labels && <Hit x={x - d / 2} y={y - d / 2} w={d} h={d} onPick={() => setPick(i)} label={m.label} />}
            </g>
          );
        })}
      </svg>
      {labels && <Readout text={pick === null ? 'Tap a mark for that one.' : marks[pick]!.label} />}
    </div>
  );
}

/** Daily bars, today on the right: first looks at the base, everything else above; untracked days faint. */
export function DayBars({ days, title, interactive }: { days: Day[]; title: string; interactive?: boolean }) {
  const [pick, setPick] = useState<number | null>(null);
  const H = 92;
  const B = 16;
  const T = 6;
  const max = Math.max(4, ...days.map((d) => d.firstLooks + d.other));
  const step = W / days.length;
  const bw = Math.min(18, step - 2);
  const sy = (v: number) => ((H - T - B) * v) / max;
  const label = (d: Day) => (d.tracked ? `${d.date}: ${d.firstLooks + d.other} positions, ${d.firstLooks} first looks` : `${d.date}: before training was recorded`);
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        <line x1={0} x2={W} y1={H - B} y2={H - B} className="ch-grid" />
        {days.map((d, i) => {
          const x = i * step + (step - bw) / 2;
          const base = H - B;
          const h1 = sy(d.firstLooks);
          const h2 = sy(d.other);
          return (
            <g key={d.date}>
              {!d.tracked ? (
                <rect x={x} y={base - 2} width={bw} height={2} className="bar-untracked" />
              ) : (
                <>
                  {h1 > 0 && <rect x={x} y={base - h1} width={bw} height={h1} rx={Math.min(3, h1 / 2)} className="bar-a" />}
                  {h2 > 0 && <rect x={x} y={base - h1 - h2 - (h1 > 0 ? 2 : 0)} width={bw} height={h2} rx={Math.min(3, h2 / 2)} className="bar-b" />}
                </>
              )}
              {pick === i && <rect x={x - 2} y={T} width={bw + 4} height={H - B - T} className="ch-pickbar" />}
              {interactive && <Hit x={i * step} y={0} w={step} h={H} onPick={() => setPick(i)} label={label(d)} />}
            </g>
          );
        })}
        <text x={0} y={H - 2} className="ch-axis">{shortDate(days[0]!.date)}</text>
        <text x={W} y={H - 2} className="ch-axis" textAnchor="end">Today</text>
      </svg>
      {interactive && <Readout text={pick === null ? 'Tap a day.' : label(days[pick]!)} />}
    </div>
  );
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const CELL_TEXT: Record<CellState, string> = {
  passed: 'Passed',
  recheck: 'Recheck due',
  failed: 'Not passed yet',
  studied: 'Studied',
  started: 'Started',
  new: 'Not started',
};

/** One cell per concept in curriculum order; a concept with no check of its own is struck through. */
export function ConceptGrid({ cells, title }: { cells: ConceptCell[]; title: string }) {
  const per = 15;
  const gap = 4;
  const size = (W - gap * (per - 1)) / per;
  const rows = Math.ceil(cells.length / per);
  const H = rows * (size + gap);
  return (
    <div className="ch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="ch-svg">
        {cells.map((c, i) => {
          const x = (i % per) * (size + gap);
          const y = Math.floor(i / per) * (size + gap);
          return (
            <g key={c.id}>
              <title>{`${c.title}: ${CELL_TEXT[c.state]}${c.checkable ? '' : ' (no check yet)'}`}</title>
              <rect x={x + 1} y={y + 1} width={size - 2} height={size - 2} rx={4} className={`cell is-${c.state}`} />
              {!c.checkable && <line x1={x + 5} y1={y + size - 5} x2={x + size - 5} y2={y + 5} className="cell-slash" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Rows that are both the chart and the list: a name, a value, and a bar under them with its
 * range when there is one. Each row can open the positions behind it.
 */
export function BarList({ rows, max, format, testid }: { rows: { key: string; label: string; meta?: string; value: number | null; lo?: number; hi?: number; href?: string; bad?: boolean }[]; max: number; format: (v: number) => string; testid?: string }) {
  const w = (v: number) => `${Math.max(0, Math.min(100, (100 * v) / Math.max(1e-9, max)))}%`;
  return (
    <ul className="barlist" data-testid={testid}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="barlist-top"><span className="barlist-label">{r.label}{r.meta && <span className="muted small">{r.meta}</span>}</span><span className="barlist-value">{r.value === null ? '–' : format(r.value)}</span></span>
            <span className="barlist-track" aria-hidden>
              {r.value !== null && <span className={r.bad ? 'barlist-bar is-bad' : 'barlist-bar'} style={{ width: w(r.value) }} />}
              {r.lo !== undefined && r.hi !== undefined && <span className="barlist-range" style={{ left: w(r.lo), width: `calc(${w(r.hi)} - ${w(r.lo)})` }} />}
            </span>
          </>
        );
        return <li key={r.key}>{r.href ? <a href={r.href}>{inner}<span className="chev" aria-hidden>›</span></a> : <span className="barlist-row">{inner}</span>}</li>;
      })}
    </ul>
  );
}

/** A legend: a swatch per entry, the text in ink, never in the series colour. */
export function Legend({ items }: { items: { swatch: string; text: string }[] }) {
  return (
    <ul className="ch-legend">
      {items.map((it) => (
        <li key={it.text}><span className={`sw ${it.swatch}`} aria-hidden />{it.text}</li>
      ))}
    </ul>
  );
}

export type { RollingPoint };
