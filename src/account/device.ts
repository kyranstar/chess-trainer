/**
 * Which database an account uses on this device (ADR-063). Each account has its own, so
 * nothing of one account is seen by another on a shared device: `chess-trainer:<uid>`.
 *
 * The database from before accounts (`chess-trainer`) holds the owner's practice on his phone,
 * and on every other device that ever opened the published app it holds the owner's games,
 * because that build fetched them by default. So only the admin adopts it, the first time he
 * signs in on a device where it holds practice, without a question (owner, 2026-11-20). It
 * keeps its name; the adoption is remembered in the device's storage.
 */
import Dexie from 'dexie';
import { getMeta, openDb, setMeta, type TrainerDB } from '../db/db';

export const LEGACY_DB = 'chess-trainer';
export const LEGACY_OWNER_KEY = 'ct.legacyOwner';
export const accountDbName = (uid: string): string => `${LEGACY_DB}:${uid}`;

type Storage2 = Pick<Storage, 'getItem' | 'setItem'>;

async function legacyHasPractice(): Promise<boolean> {
  if (!(await Dexie.exists(LEGACY_DB))) return false;
  const db = openDb(LEGACY_DB);
  try {
    return (await db.attempts.count()) > 0 || (await db.lessonEvents.count()) > 0;
  } finally {
    db.close();
  }
}

export async function dbNameFor(uid: string, admin: boolean, storage: Storage2 = localStorage): Promise<string> {
  const owner = storage.getItem(LEGACY_OWNER_KEY);
  if (owner === uid) return LEGACY_DB;
  if (!owner && admin && (await legacyHasPractice())) {
    storage.setItem(LEGACY_OWNER_KEY, uid);
    return LEGACY_DB;
  }
  return accountDbName(uid);
}

/**
 * The published build used to carry the owner's Chess.com name as a default, so his phone has
 * none stored. The games on the device say whose they are (`chesscom.gamesOf`): that name is
 * stored, so his games keep arriving with the default gone. A name already stored, an empty
 * one (unlinked) included, is kept.
 */
export async function inferUsername(db: TrainerDB): Promise<string | null> {
  const stored = await getMeta<string>(db, 'chesscom.username');
  if (stored !== undefined) return stored;
  const owner = await getMeta<string>(db, 'chesscom.gamesOf');
  if (!owner) return null;
  await setMeta(db, 'chesscom.username', owner);
  return owner;
}
