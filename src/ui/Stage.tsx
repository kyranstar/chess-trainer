/**
 * The frame every exercise runs in: a bar at the top (the way out, where you are, how much is
 * left), the exercise under it. The exercise itself is always board, then what is asked or the
 * verdict, then the buttons pinned to the bottom (see `.puzzle`, `.say`, `.dock` in styles.css).
 */
import { createContext, type ReactElement, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { noteScreenChange } from '../app/tapGuard';
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

/**
 * Going back to the position just answered (owner, 2026-11-12: "sometimes I go forward and
 * find no way to go back"). The run bar has "Last"; what it shows is the previous exercise
 * exactly as it was left, with its lines still playable. See KeepLast below.
 */
interface LastState { has: boolean; viewing: boolean; setHas: (has: boolean) => void; setViewing: (v: boolean) => void }
const LastContext = createContext<LastState>({ has: false, viewing: false, setHas: () => {}, setViewing: () => {} });

/** What an exercise needs to know about where it stands: on screen or set aside, and whether it is the one gone back to. */
interface ItemState { active: boolean; last: boolean; back: () => void }
const ItemContext = createContext<ItemState>({ active: true, last: false, back: () => {} });
const KeptContext = createContext(false);

/**
 * For an exercise's main button. On the exercise gone back to, "Next" must not move the run
 * on a second time: it returns to where the learner was.
 */
export function useItem(onDone: () => void): { next: () => void; nextLabel: string | null; active: boolean; last: boolean } {
  const item = useContext(ItemContext);
  return { next: item.last ? item.back : onDone, nextLabel: item.last ? 'Back to where you were' : null, active: item.active, last: item.last };
}

/** One exercise, rendered into a box of its own that is on the page only while it is the one being looked at. */
function Kept({ active, state, children }: { active: boolean; state: ItemState; children: ReactNode }) {
  const [box] = useState(() => {
    const el = document.createElement('div');
    el.className = 'keep-item';
    return el;
  });
  const host = useRef<HTMLDivElement | null>(null);
  // Attached as the host appears, which is before anything inside the box runs its own effects
  // (the board measures itself when it is created).
  const attach = useCallback((el: HTMLDivElement | null) => {
    host.current = el;
    if (el && active) el.appendChild(box);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (active) host.current?.appendChild(box);
    else box.remove();
  }, [active, box]);
  useEffect(() => () => box.remove(), [box]);
  return (
    <>
      <div className="keep-host" ref={attach} hidden={!active} />
      {createPortal(<ItemContext.Provider value={state}>{children}</ItemContext.Provider>, box)}
    </>
  );
}

/**
 * Shows one exercise at a time (a child with a `key`) and keeps the one before it alive,
 * off the page, so that "Last" in the run bar can put it back exactly as it was left: its
 * verdict, its lines, where each was stepped to. Off the page means not in the document at
 * all, so nothing can be tapped in it and nothing in it is found twice. A child without a
 * key (a loading line, "nothing left") is not an exercise: it is shown, and the last
 * exercise stays reachable. Inside another KeepLast this does nothing.
 */
export function KeepLast({ children }: { children: ReactElement | null | false }) {
  const nested = useContext(KeptContext);
  const last = useContext(LastContext);
  const kept = useRef<{ cur: ReactElement | null; prev: ReactElement | null }>({ cur: null, prev: null });
  const child = children || null;
  const isItem = !!child && child.key !== null;
  if (!nested) {
    const k = kept.current;
    if (isItem) {
      if (k.cur && k.cur.key !== child.key) k.prev = k.cur;
      // The same exercise back in its place after a notice stood there: it is not its own predecessor.
      else if (!k.cur && k.prev?.key === child.key) k.prev = null;
      k.cur = child;
    } else if (k.cur) {
      k.prev = k.cur;
      k.cur = null;
    }
  }
  const prev = nested ? null : kept.current.prev;
  const { setHas, setViewing } = last;
  const prevKey = prev?.key ?? null;
  useEffect(() => {
    if (nested) return;
    setHas(prevKey !== null);
    // A new exercise came up: whatever was being looked at, the run has moved on.
    setViewing(false);
  }, [nested, prevKey, child?.key, setHas, setViewing]);
  useEffect(() => () => {
    if (nested) return;
    setHas(false);
    setViewing(false);
  }, [nested, setHas, setViewing]);
  const back = useCallback(() => setViewing(false), [setViewing]);
  const viewing = last.viewing && !!prev;
  const onNow = useMemo<ItemState>(() => ({ active: !viewing, last: false, back }), [viewing, back]);
  const onLast = useMemo<ItemState>(() => ({ active: viewing, last: true, back }), [viewing, back]);
  if (nested) return <>{child}</>;
  return (
    <KeptContext.Provider value={true}>
      <div className="keep" data-testid="keep" data-viewing={viewing ? 'last' : 'now'}>
        {prev && <Kept key={`kept:${prev.key}`} active={viewing} state={onLast}>{prev}</Kept>}
        <Kept key={isItem ? `kept:${child.key}` : 'kept-none'} active={!viewing} state={onNow}>{child}</Kept>
      </div>
    </KeptContext.Provider>
  );
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
  const [has, setHas] = useState(false);
  const [viewing, setViewingRaw] = useState(false);
  const setViewing = useCallback((v: boolean) => {
    setViewingRaw((was) => {
      // The buttons change under the finger: a second tap must not act on the other screen.
      if (was !== v) noteScreenChange();
      return v;
    });
  }, []);
  const last = useMemo<LastState>(() => ({ has, viewing, setHas, setViewing }), [has, viewing, setViewing]);
  return (
    <LastContext.Provider value={last}>
    <RunNoteContext.Provider value={setNote}>
      <div className="page run" data-testid={testid} {...attrs}>
        <header className="run-bar">
          <a className="back" href={back.href} data-testid="run-back" onClick={back.onClick ? (e) => { e.preventDefault(); back.onClick!(); } : undefined}>{back.label}</a>
          <p className="run-title">{title}{clock}</p>
          <span className="run-side">
            {has && (
              <button className="last-item" data-testid="last-item" aria-pressed={viewing} aria-label={viewing ? 'Back to where you were' : 'The last position again'} onClick={() => setViewing(!viewing)}>{'\u21A9\uFE0E'}</button>
            )}
            {note && !viewing && <span className="run-note" data-testid="run-note">{note}</span>}
            {side}
            <button className="quiet flip-bar" data-testid="flip-board" aria-label="Flip board" onClick={() => window.dispatchEvent(new Event(FLIP_EVENT))}>⇅</button>
          </span>
        </header>
        {children}
      </div>
    </RunNoteContext.Provider>
    </LastContext.Provider>
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
