/**
 * Offline practice packs: rights-cleared static content built on the Mac
 * (pipeline/trainer_pipeline/build_puzzle_pack.py) and copied into IndexedDB so sessions
 * need no network. Packs are replaceable; the attempts made on them are not.
 */
import type { PackManifest, Puzzle } from '../puzzles/types';
import type { TrainerDB } from './db';
import type { PackRow } from './types';

export const CORE_PACK = 'lichess-core';
export const PACK_SCHEMA = 1;
type Fetcher = (url: string) => Promise<Response>;

export interface PackStatus {
  state: 'missing' | 'installed';
  manifest: PackManifest | null;
  installedAt: number | null;
  puzzleCount: number;
}

export async function packStatus(db: TrainerDB, id: string = CORE_PACK): Promise<PackStatus> {
  const row = await db.packs.get(id);
  const puzzleCount = row ? await db.puzzles.where('packId').equals(id).count() : 0;
  return { state: row && puzzleCount > 0 ? 'installed' : 'missing', manifest: row?.manifest ?? null, installedAt: row?.installedAt ?? null, puzzleCount };
}

async function get(fetcher: Fetcher, url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url);
  } catch {
    throw new Error('The practice pack could not be downloaded (no connection). Anything already installed still works.');
  }
  if (!res.ok) throw new Error(`The practice pack could not be downloaded (server answered ${res.status}).`);
  return res;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downloads, verifies and installs the pack. A no-op when that exact version is installed. */
export async function installPack(db: TrainerDB, fetcher: Fetcher = (u) => fetch(u), base = './packs/', id: string = CORE_PACK): Promise<PackRow> {
  const manifest = (await (await get(fetcher, `${base}${id}.manifest.json`)).json()) as PackManifest;
  if (manifest.schema !== PACK_SCHEMA) throw new Error(`This app cannot read practice pack format ${manifest.schema}; update the app.`);
  const current = await db.packs.get(id);
  if (current && current.manifest.version === manifest.version && current.manifest.contentHash === manifest.contentHash) {
    if ((await db.puzzles.where('packId').equals(id).count()) === manifest.count) return current;
  }
  const body = await (await get(fetcher, `${base}${manifest.file}`)).text();
  if (`sha256:${await sha256Hex(body)}` !== manifest.contentHash) {
    throw new Error('The downloaded practice pack does not match its checksum, so it was not installed.');
  }
  const puzzles = JSON.parse(body) as Puzzle[];
  if (puzzles.length !== manifest.count) throw new Error('The downloaded practice pack is incomplete, so it was not installed.');
  const row: PackRow = { id, manifest, installedAt: Date.now() };
  await db.transaction('rw', db.puzzles, db.packs, async () => {
    await db.puzzles.where('packId').equals(id).delete();
    await db.puzzles.bulkPut(puzzles.map((p) => ({ ...p, packId: id })));
    await db.packs.put(row);
  });
  return row;
}
