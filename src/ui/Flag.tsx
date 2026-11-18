import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../app/store';
import { clearFlag, flagKey, setFlag } from '../db/flags';

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
