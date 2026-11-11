/**
 * The frame every exercise runs in: a bar at the top (the way out, where you are, how much is
 * left), the exercise under it. The exercise itself is always board, then what is asked or the
 * verdict, then the buttons pinned to the bottom (see `.puzzle`, `.say`, `.dock` in styles.css).
 */
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { FLIP_EVENT } from './Board';

const RunNoteContext = createContext<(note: string | null) => void>(() => {});

/** A short count for the run bar ("6 left", "Check 2 of 5"), set by whatever is running inside it. */
export function useRunNote(note: string | null): void {
  const set = useContext(RunNoteContext);
  useEffect(() => {
    set(note);
  }, [note, set]);
  useEffect(() => () => set(null), [set]);
}

export function RunFrame({ back, title, clock, side, testid, attrs, children }: {
  /** The way out; `onClick` for a step back inside the same page instead of a link. */
  back: { href: string; label: string; onClick?: () => void };
  title?: ReactNode;
  clock?: ReactNode;
  /** Controls at the right end of the bar, after the count. */
  side?: ReactNode;
  testid: string;
  attrs?: Record<string, string>;
  children: ReactNode;
}) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <RunNoteContext.Provider value={setNote}>
      <div className="page run" data-testid={testid} {...attrs}>
        <header className="run-bar">
          <a className="back" href={back.href} data-testid="run-back" onClick={back.onClick ? (e) => { e.preventDefault(); back.onClick!(); } : undefined}>{back.label}</a>
          <p className="run-title">{title}{clock}</p>
          <span className="run-side">
            {note && <span className="run-note" data-testid="run-note">{note}</span>}
            {side}
            <button className="quiet flip-bar" data-testid="flip-board" aria-label="Flip board" onClick={() => window.dispatchEvent(new Event(FLIP_EVENT))}>⇅</button>
          </span>
        </header>
        {children}
      </div>
    </RunNoteContext.Provider>
  );
}

/** What is asked, under the board: one line, and at most one small line of context. */
export function Ask({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h2 className="ask">{title}</h2>
      {meta && <p className="ask-meta">{meta}</p>}
      {children}
    </>
  );
}

/** "Nov 6" from "2026-11-06": the year is never needed for a recent game. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Where a position from the learner's own games comes from, in a few words. */
export function gameRef(date: string, ply: number, timeClass?: string): string {
  return `Your ${timeClass ? `${timeClass} ` : ''}game, ${shortDate(date)}, move ${Math.floor(ply / 2) + 1}`;
}
