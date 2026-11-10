/**
 * Explicit, versioned backup of everything the learner cannot re-create.
 *
 * File: one JSON document. `manifest` describes it (schema version, counts, a SHA-256 per
 * table); `data` holds the rows. Restore is validate-everything-first, then one atomic
 * merge: rows are matched by id, existing rows are never deleted or overwritten by older
 * ones, and derived review state is rebuilt from the merged attempt log.
 */
import { getDeviceId, rebuildReviews, SCHEMA_VERSION, type TrainerDB } from './db';
import type { Attempt, LessonEvent, SessionRecord } from './types';

export const BACKUP_FORMAT = 'chess-trainer-backup';

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exporterVersion: string;
  exportTime: string; // ISO UTC
  deviceId: string;
  itemCounts: { attempts: number; lessonEvents: number; sessions: number };
  contentHashes: { attempts: string; lessonEvents: string; sessions: string };
}

export interface BackupFile {
  manifest: BackupManifest;
  data: { attempts: Attempt[]; lessonEvents: LessonEvent[]; sessions: SessionRecord[] };
}

export interface ImportReport {
  manifest: BackupManifest;
  added: { attempts: number; lessonEvents: number; sessions: number };
  reviewItems: number;
}

const TABLES = ['attempts', 'lessonEvents', 'sessions'] as const;

/** JSON with object keys sorted, so the hash does not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const byKey = <T,>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

async function hashTables(data: BackupFile['data']): Promise<BackupManifest['contentHashes']> {
  return {
    attempts: await sha256(canonicalJson(byKey(data.attempts, (r) => r.uuid))),
    lessonEvents: await sha256(canonicalJson(byKey(data.lessonEvents, (r) => r.uuid))),
    sessions: await sha256(canonicalJson(byKey(data.sessions, (r) => r.id))),
  };
}

export async function exportBackup(db: TrainerDB, now: number = Date.now()): Promise<BackupFile> {
  const data = {
    attempts: byKey(await db.attempts.toArray(), (r) => r.uuid),
    lessonEvents: byKey(await db.lessonEvents.toArray(), (r) => r.uuid),
    sessions: byKey(await db.sessions.toArray(), (r) => r.id),
  };
  return {
    manifest: {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exporterVersion: __APP_VERSION__,
      exportTime: new Date(now).toISOString(),
      deviceId: await getDeviceId(db),
      itemCounts: { attempts: data.attempts.length, lessonEvents: data.lessonEvents.length, sessions: data.sessions.length },
      contentHashes: await hashTables(data),
    },
    data,
  };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b);
}

export function backupFileName(b: BackupFile): string {
  return `chess-trainer-backup-${b.manifest.exportTime.slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

/** Parses and fully validates a backup. Throws a readable Error; never touches the database. */
export async function parseBackup(text: string): Promise<BackupFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it cannot be a Chess Trainer backup (it may be truncated).');
  }
  const b = raw as Partial<BackupFile>;
  const m = b?.manifest;
  if (!m || m.format !== BACKUP_FORMAT || !b.data) throw new Error('This file is not a Chess Trainer backup.');
  if (typeof m.schemaVersion !== 'number' || m.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`This backup was made by a newer version of the app (schema ${m.schemaVersion}); update the app, then restore.`);
  }
  for (const t of TABLES) {
    if (!Array.isArray(b.data[t])) throw new Error(`Backup is missing the "${t}" table.`);
    if (b.data[t].length !== m.itemCounts?.[t]) throw new Error(`Backup is damaged: "${t}" should have ${m.itemCounts?.[t]} rows but has ${b.data[t].length}.`);
  }
  const hashes = await hashTables(b.data);
  for (const t of TABLES) {
    if (hashes[t] !== m.contentHashes?.[t]) throw new Error(`Backup is damaged: the "${t}" table does not match its checksum.`);
  }
  for (const a of b.data.attempts) if (typeof a.uuid !== 'string' || typeof a.exerciseId !== 'string' || typeof a.ts !== 'number') throw new Error('Backup contains a malformed attempt.');
  return b as BackupFile;
}

export async function importBackup(db: TrainerDB, text: string): Promise<ImportReport> {
  const backup = await parseBackup(text); // all validation happens before any write
  const added = { attempts: 0, lessonEvents: 0, sessions: 0 };
  await db.transaction('rw', db.attempts, db.lessonEvents, db.sessions, db.reviewStates, async () => {
    const haveA = new Set(await db.attempts.toCollection().primaryKeys());
    const newA = backup.data.attempts.filter((a) => !haveA.has(a.uuid));
    await db.attempts.bulkAdd(newA);
    added.attempts = newA.length;

    const haveE = new Set(await db.lessonEvents.toCollection().primaryKeys());
    const newE = backup.data.lessonEvents.filter((e) => !haveE.has(e.uuid));
    await db.lessonEvents.bulkAdd(newE);
    added.lessonEvents = newE.length;

    for (const s of backup.data.sessions) {
      const mine = await db.sessions.get(s.id);
      if (!mine) added.sessions++;
      if (!mine || s.updatedAt > mine.updatedAt) await db.sessions.put(s);
    }
    await rebuildReviews(db);
  });
  return { manifest: backup.manifest, added, reviewItems: await db.reviewStates.count() };
}
