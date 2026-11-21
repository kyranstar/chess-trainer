import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDb } from '../app/store';
import { clearFlag, flagKey, screenFlag, setFlag } from '../db/flags';

/** An answered position that can be flagged: its exercise id and which exercise showed it. */
export interface Flaggable { id: string; kind: string }

/**
 * "Flag this one" in the run bar (owner request, 2026-11-17; ADR-059). It appears once a
 * position is answered and marks it for a later look by whoever works on the app next. What
 * the result said is kept with it, read off the page as it stands: that is what was puzzling.
 * A second tap takes the flag off. See src/db/flags.ts for where it goes.
 */
export function FlagButton({ item }: { item: Flaggable }) {
  const db = useDb();
  const flagged = useLiveQuery(async () => (await db.meta.get(flagKey(item.id))) !== undefined, [db, item.id]) ?? false;
  const toggle = () => {
    if (flagged) return void clearFlag(db, item.id);
    const shown = document.querySelector<HTMLElement>('.page.run .puzzle');
    const state: Record<string, string> = {};
    for (const [k, v] of Object.entries(shown?.dataset ?? {})) if (k !== 'testid' && v) state[k] = v.slice(0, 200);
    void setFlag(db, {
      id: item.id, kind: item.kind, ts: Date.now(),
      fen: shown?.querySelector('.board')?.getAttribute('data-fen') ?? null,
      said: (shown?.querySelector<HTMLElement>('.say')?.innerText ?? '').replace(/\s*\n\s*/g, ' | ').slice(0, 800),
      state, app: __APP_VERSION__,
    });
  };
  return (
    <button className="flag-item" data-testid="flag-item" aria-pressed={flagged} aria-label={flagged ? 'Flagged for a later look: tap to take the flag off' : 'Flag this position for a later look'} title={flagged ? 'Flagged' : 'Flag this one'} onClick={toggle}>
      {/* The glyph alone: in a session the bar also holds the block's clock and "Skip", and a word here pushed the clock out. */}
      <span aria-hidden>{'\u2691\uFE0E'}</span>
    </button>
  );
}

/**
 * A flag on any screen, for the admin (owner request, 2026-11-20; ADR-063): in the corner of
 * every page, and in the run bar of an exercise until there is an answered position to flag.
 * A tap opens a one-line note; "Flag" keeps the route, the heading, the board if any, what the
 * screen said and the note. It reaches `scripts/flags.mjs` the same way as a position's flag.
 */
export function ScreenFlag({ floating = false }: { floating?: boolean }) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  async function save() {
    const root = document.querySelector('main') ?? document.body;
    await setFlag(db, screenFlag(root, window.location.hash || '#/', note, Date.now()));
    setOpen(false);
    setNote('');
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }
  return (
    <>
      <button className={floating ? 'screen-flag screen-flag-float' : 'screen-flag flag-item-like'} data-testid="screen-flag" aria-pressed={done}
        aria-label={done ? 'Flagged' : 'Flag this screen for a later look'} title={done ? 'Flagged' : 'Flag this screen'} onClick={() => setOpen(true)}>
        <span aria-hidden>{'\u2691\uFE0E'}</span>
      </button>
      {open && createPortal(
        <form className="flag-sheet" role="dialog" aria-label="Flag this screen" data-testid="flag-sheet" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="flag-sheet-title">Flag this screen</p>
          <input data-testid="flag-note" placeholder="What’s wrong? (optional)" value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} />
          <div className="actions">
            <button className="primary" type="submit" data-testid="flag-save">Flag</button>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>,
        document.body,
      )}
    </>
  );
}
