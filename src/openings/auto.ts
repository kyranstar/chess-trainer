/**
 * Keeps the repertoire filled from what is on the device: the learner's own games and the
 * open move statistics (see fromGames.ts for the two sources and why no course is read).
 *
 * Order of authority, highest first: a move he recorded himself; a move read from his games;
 * a suggestion. A lower one never replaces a higher one. A suggestion gives way as soon as
 * his games show a habit in that position, and suggestions that hung on a replaced move are
 * removed unless he has already practised them. A move he removed does not come back.
 */
import { getMeta, setMeta, type TrainerDB } from '../db/db';
import { DEFAULT_BAND, loadOpeningBook } from './book';
import { type Doubtful, repertoireFromGames, suggestForGaps } from './fromGames';
import { drillId, type OpeningBook, type RepertoireEntry, type Side, walkRepertoire } from './repertoire';

export const DECLINED_KEY = 'openings.declined';
export const DOUBTFUL_KEY = 'openings.doubtful';

export interface RepertoireUpdate {
  /** Moves newly read from his games. */
  fromGames: number;
  /** New suggestions. */
  suggested: number;
  /** Suggestions or earlier habits replaced by what his games now show. */
  replaced: number;
  /** Suggestions and old habits removed because nothing leads to them any more. */
  removed: number;
  doubtful: Doubtful[];
}

/** Removes an entry at the learner's request; if the app had put it there, it will not put it back. */
export async function declineEntry(db: TrainerDB, entry: RepertoireEntry): Promise<void> {
  await db.repertoire.delete(entry.id);
  if (!entry.source) return;
  const declined = new Set((await getMeta<string[]>(db, DECLINED_KEY)) ?? []);
  declined.add(entry.id);
  await setMeta(db, DECLINED_KEY, [...declined]);
}

export async function updateRepertoire(db: TrainerDB, book: OpeningBook, band: number, now: number): Promise<RepertoireUpdate> {
  const games = (await db.games.toArray()).filter((g) => (g.color === 'white' || g.color === 'black') && Array.isArray(g.moves) && g.moves.length > 0);
  const stored = await db.repertoire.toArray();
  const declined = new Set((await getMeta<string[]>(db, DECLINED_KEY)) ?? []);
  const byId = new Map(stored.map((e) => [e.id, e]));
  const hand = stored.filter((e) => !e.source);
  const out: RepertoireUpdate = { fromGames: 0, suggested: 0, replaced: 0, removed: 0, doubtful: [] };
  const puts: RepertoireEntry[] = [];

  // 1. His games, read afresh against the moves he recorded himself.
  const read = repertoireFromGames(games.map((g) => ({ color: g.color as Side, moves: g.moves, date: g.date })), book, hand, now, undefined, declined);
  out.doubtful = read.doubtful;
  const habits: RepertoireEntry[] = [];
  for (const e of read.entries) {
    const was = byId.get(e.id);
    if (!was) {
      out.fromGames++;
      puts.push(e);
      habits.push(e);
    } else if (was.uci !== e.uci) {
      out.replaced++;
      puts.push(e);
      habits.push(e);
    } else {
      // Same move as before: keep the stored row (its date), with the source and counts brought up to date.
      const kept = { ...was, source: 'own-games' as const, games: e.games };
      if (was.source !== 'own-games' || was.games?.played !== e.games?.played || was.games?.reached !== e.games?.reached) puts.push(kept);
      habits.push(kept);
    }
  }
  const habitIds = new Set(habits.map((e) => e.id));

  // 2. Suggestions for the common gaps, on top of his moves and the suggestions already there.
  const keptSuggestions = stored.filter((e) => e.source === 'suggested' && !habitIds.has(e.id));
  const fresh: RepertoireEntry[] = [];
  const final: RepertoireEntry[] = [...hand, ...habits, ...keptSuggestions];
  for (const side of ['white', 'black'] as Side[]) {
    // Left to him: positions where his habit was not taken over, and moves he removed.
    const skip = new Set<string>(read.doubtful.filter((d) => d.side === side).map((d) => d.positionKey));
    for (const id of declined) if (id.startsWith(`${side}|`)) skip.add(id.slice(side.length + 1));
    // Suggestions extend what his games show; they do not pick an opening for a side he has no games with.
    if (!habits.some((e) => e.side === side)) continue;
    const add = suggestForGaps(book, final, side, [band], now, undefined, skip);
    fresh.push(...add);
    final.push(...add);
  }
  out.suggested = fresh.length;
  puts.push(...fresh);

  // 3. Entries the app put there that nothing leads to any more: removed, unless already practised.
  const reachable = new Set<string>();
  for (const side of ['white', 'black'] as Side[]) {
    for (const d of walkRepertoire(book, final, side, [band]).decisions) if (d.entry) reachable.add(d.entry.id);
  }
  const practised = new Set((await db.reviewStates.toArray()).map((r) => r.itemId));
  const gone: string[] = [];
  for (const e of stored) {
    if (!e.source || habitIds.has(e.id) || reachable.has(e.id)) continue;
    // A habit his games no longer show, or a suggestion behind a move that changed.
    if (practised.has(drillId(e))) continue;
    gone.push(e.id);
  }
  out.removed = gone.length;

  await db.transaction('rw', db.repertoire, db.meta, async () => {
    if (gone.length) await db.repertoire.bulkDelete(gone);
    if (puts.length) await db.repertoire.bulkPut(puts);
    await db.meta.put({ key: DOUBTFUL_KEY, value: out.doubtful });
  });
  return out;
}

export const AUTO_VERSION = 'repertoire-auto-v1';
const AUTO_KEY = 'openings.auto';
let refreshing: Promise<RepertoireUpdate | null> | null = null;

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** What the last update was computed from: if none of it has changed there is nothing to do. */
async function signature(db: TrainerDB, book: OpeningBook, band: number): Promise<string> {
  const games = await db.games.count();
  const hand = (await db.repertoire.toArray()).filter((e) => !e.source).map((e) => `${e.id}:${e.uci}`).sort().join(',');
  const declined = ((await getMeta<string[]>(db, DECLINED_KEY)) ?? []).length;
  return [AUTO_VERSION, book.manifest.version, band, games, hash(hand), declined].join('|');
}

/**
 * Brings the repertoire up to date when something it depends on has changed (new games, a
 * move recorded or removed by hand, another rating band). Safe to call often; one run at a time.
 */
export function refreshRepertoire(db: TrainerDB): Promise<RepertoireUpdate | null> {
  refreshing ??= (async () => {
    try {
      const book = await loadOpeningBook();
      if (!book) return null;
      const band = (await getMeta<number>(db, 'openings.band')) ?? DEFAULT_BAND;
      if ((await getMeta<string>(db, AUTO_KEY)) === (await signature(db, book, band))) return null;
      const result = await updateRepertoire(db, book, band, Date.now());
      await setMeta(db, AUTO_KEY, await signature(db, book, band));
      return result;
    } catch {
      return null; // the repertoire is a convenience: a failure here must not disturb anything else
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
