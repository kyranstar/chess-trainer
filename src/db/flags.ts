/**
 * "Flag this one" (owner request, 2026-11-17; ADR-059): a position marked on its result
 * screen as one to be looked at later, by whoever works on the app next. A flag says what was
 * on the screen when it was set, because that is what was puzzling: the verdict, the moves
 * compared and their numbers, as they stood.
 *
 * Flags are rows of the `meta` table under `flag:<exercise id>`, so they need no schema
 * change, travel in the backup with the other preferences, and reach the private copy
 * (src/db/remote.ts) from which `scripts/flags.mjs` lists them. One flag per position;
 * setting it again replaces it, and it can be taken off.
 */
import { type TrainerDB } from './db';

export const FLAG_PREFIX = 'flag:';
export const flagKey = (exerciseId: string): string => `${FLAG_PREFIX}${exerciseId}`;

export interface Flag {
  /** The exercise id, as attempts carry it (`lichess:…`, `move:<game>:<ply>`, …). */
  id: string;
  /** Which exercise showed it. */
  kind: string;
  ts: number;
  /** The position on the board when the flag was set. */
  fen: string | null;
  /** What the result said, as text: the verdict, the chips with their numbers, the line. */
  said: string;
  /** The exercise's own state as the page carried it (phase, verdict, …). */
  state: Record<string, string>;
  /** The version of the app that showed it. */
  app: string;
}

export async function setFlag(db: TrainerDB, flag: Flag): Promise<void> {
  await db.meta.put({ key: flagKey(flag.id), value: flag });
}

export async function clearFlag(db: TrainerDB, exerciseId: string): Promise<void> {
  await db.meta.delete(flagKey(exerciseId));
}

export async function isFlagged(db: TrainerDB, exerciseId: string): Promise<boolean> {
  return (await db.meta.get(flagKey(exerciseId))) !== undefined;
}

/** Every flag on this device, newest first. */
export async function listFlags(db: TrainerDB): Promise<Flag[]> {
  const rows = await db.meta.where('key').startsWith(FLAG_PREFIX).toArray();
  return rows.map((r) => r.value as Flag).sort((a, b) => b.ts - a.ts);
}
