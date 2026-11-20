/**
 * The account copy (ADR-063, owner choice "B"): the phone stays the working copy, so the app
 * works offline; a copy of the same backup file "Download backup" writes is kept in the
 * account and merged in whenever the app opens online, so another device picks up where the
 * last one left off.
 *
 * Stored as a manifest and numbered chunks of the gzipped, base64 file (a Firestore document
 * holds at most 1 MiB). Every write names the revision it was built on; if the account's copy
 * moved on meanwhile (another device), this device first merges that copy and then writes
 * the union. Merging is the backup restore (src/db/backup.ts): append-only rows by id, editable
 * rows and settings by their change times, so nothing is lost or doubled.
 *
 * Meta keys `copy.*` are this device's bookkeeping and never travel.
 */
import { exportBackup, importBackup, serializeBackup } from '../db/backup';
import { getDeviceId, getMeta, SCHEMA_VERSION, setMeta, type TrainerDB } from '../db/db';
import { dataSignature, decodeRemoteFile, gzipBase64 } from '../db/remote';

export interface CopyManifest {
  rev: number;
  chunks: number;
  bytes: number;
  sha256: string;
  exportTime: string;
  deviceId: string;
  appVersion: string;
  schemaVersion: number;
}

export interface CopyStore {
  readManifest(): Promise<CopyManifest | null>;
  readChunks(m: CopyManifest): Promise<string[]>;
  /** One transaction: writes only if the stored revision is still `expectedRev` (0 = none). */
  write(expectedRev: number, m: CopyManifest, chunks: string[]): Promise<'ok' | 'conflict'>;
}

export type PushResult = { ok: true; at: number } | { ok: false; reason: 'offline' | 'error' | 'newer-app'; detail?: string };
export type PullResult = { merged: boolean; heldBack?: 'newer-app' };

export const COPY_REV = 'copy.rev';
export const COPY_SIGNATURE = 'copy.signature';
export const COPY_AT = 'copy.at';
export const COPY_ERROR = 'copy.error';

let chunkChars = 900_000;
/** Tests only: smaller chunks, so a small copy spans several. */
export function __setChunkChars(n: number): void {
  chunkChars = n;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A device that has recorded nothing yet (a new phone) has nothing of its own to send. */
export async function hasNoPractice(db: TrainerDB): Promise<boolean> {
  return (await db.attempts.count()) === 0 && (await db.lessonEvents.count()) === 0 && (await db.sessions.count()) === 0;
}

/** Merges the account's copy if it is newer than the last one merged here. */
export async function pullCopy(db: TrainerDB, store: CopyStore): Promise<PullResult> {
  const m = await store.readManifest();
  if (!m || m.rev <= ((await getMeta<number>(db, COPY_REV)) ?? 0)) return { merged: false };
  if (m.schemaVersion > SCHEMA_VERSION) return { merged: false, heldBack: 'newer-app' };
  const base64 = (await store.readChunks(m)).join('');
  if ((await sha256(base64)) !== m.sha256) throw new Error('The copy in your account is damaged; it was not merged.');
  // Nothing of this device's waiting to be sent: what the merge brings is the copy itself, and
  // sending it straight back would only cost a write.
  const clean = (await dataSignature(db)) === (await getMeta<string>(db, COPY_SIGNATURE)) || (await hasNoPractice(db));
  await importBackup(db, await decodeRemoteFile(base64));
  await setMeta(db, COPY_REV, m.rev);
  if (clean) await setMeta(db, COPY_SIGNATURE, await dataSignature(db));
  return { merged: true };
}

/** Writes this device's data to the account if it changed since the last write. */
export async function pushCopy(db: TrainerDB, store: CopyStore, now: number): Promise<PushResult> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const signature = await dataSignature(db);
      if (signature === (await getMeta<string>(db, COPY_SIGNATURE))) return { ok: true, at: (await getMeta<number>(db, COPY_AT)) ?? now };
      const rev = (await getMeta<number>(db, COPY_REV)) ?? 0;
      const file = await gzipBase64(serializeBackup(await exportBackup(db, now)));
      const chunks: string[] = [];
      for (let i = 0; i < file.base64.length; i += chunkChars) chunks.push(file.base64.slice(i, i + chunkChars));
      const manifest: CopyManifest = {
        rev: rev + 1, chunks: chunks.length, bytes: file.bytes, sha256: await sha256(file.base64),
        exportTime: new Date(now).toISOString(), deviceId: await getDeviceId(db), appVersion: __APP_VERSION__, schemaVersion: SCHEMA_VERSION,
      };
      if ((await store.write(rev, manifest, chunks)) === 'ok') {
        await setMeta(db, COPY_REV, manifest.rev);
        await setMeta(db, COPY_SIGNATURE, signature);
        await setMeta(db, COPY_AT, now);
        await db.meta.delete(COPY_ERROR);
        return { ok: true, at: now };
      }
      // The account moved on: bring its copy in, then write the union.
      const pulled = await pullCopy(db, store);
      if (pulled.heldBack) return { ok: false, reason: 'newer-app' };
    }
    return { ok: false, reason: 'error', detail: 'the copy kept changing while it was being written' };
  } catch (e) {
    return e instanceof TypeError ? { ok: false, reason: 'offline' } : { ok: false, reason: 'error', detail: (e as Error).message };
  }
}

/** A copy store in memory, for tests and the stand-in account service. */
export function memoryCopyStore(): CopyStore & { manifest: CopyManifest | null; chunks: string[] } {
  const store = {
    manifest: null as CopyManifest | null,
    chunks: [] as string[],
    async readManifest() {
      return store.manifest;
    },
    async readChunks() {
      return [...store.chunks];
    },
    async write(expectedRev: number, m: CopyManifest, chunks: string[]) {
      if ((store.manifest?.rev ?? 0) !== expectedRev) return 'conflict' as const;
      store.manifest = m;
      store.chunks = [...chunks];
      return 'ok' as const;
    },
  };
  return store;
}
