/**
 * Explicit, versioned backup of everything the learner cannot re-create.
 *
 * File: one JSON document. `manifest` describes it (schema version, counts, a SHA-256 per
 * table); `data` holds the rows. Restore is validate-everything-first, then one atomic
 * merge: rows are matched by id, existing rows are never deleted or overwritten by older
 * ones, and derived review state is rebuilt from the merged attempt log.
 *
 * A table introduced in schema N is required in files of schema >= N and simply absent in
 * older files, so every earlier backup stays restorable.
 */
import { getDeviceId, rebuildReviews, SCHEMA_VERSION, type TrainerDB } from './db';
import type { Attempt, GameJournalEntry, LessonEvent, SessionRecord } from './types';
import type { GameRecord } from '../games/types';
import type { RepertoireEntry } from '../openings/repertoire';

export const BACKUP_FORMAT = 'chess-trainer-backup';

/** `append`: immutable rows, add if the id is new. `newer`: editable rows, the later `updatedAt` wins. */
const TABLES = [
  { name: 'attempts', key: 'uuid', since: 1, mode: 'append' },
  { name: 'lessonEvents', key: 'uuid', since: 1, mode: 'append' },
  { name: 'sessions', key: 'id', since: 1, mode: 'newer' },
  { name: 'gameJournal', key: 'id', since: 2, mode: 'newer' },
  { name: 'repertoire', key: 'id', since: 3, mode: 'newer' },
  { name: 'games', key: 'id', since: 4, mode: 'newer' },
] as const;
export type BackupTable = (typeof TABLES)[number]['name'];
type Row = Record<string, unknown>;

/**
 * Preferences that are the learner's own choices and worth carrying to another device.
 * Device bookkeeping (device id, download caches, last-sync and last-backup times) is not.
 */
const SETTING_KEYS = ['openings.band', 'openings.side', 'chesscom.username'];
const SETTING_PREFIXES = ['lessonProgress:'];
export function isPortableSetting(key: string): boolean {
  return SETTING_KEYS.includes(key) || SETTING_PREFIXES.some((p) => key.startsWith(p));
}
export interface SettingRow { key: string; value: unknown }

export interface BackupData {
  attempts: Attempt[];
  lessonEvents: LessonEvent[];
  sessions: SessionRecord[];
  gameJournal?: GameJournalEntry[];
  repertoire?: RepertoireEntry[];
  games?: GameRecord[];
  /** Optional in every schema version: files written before preferences were included have none. */
  settings?: SettingRow[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exporterVersion: string;
  exportTime: string; // ISO UTC
  deviceId: string;
  itemCounts: Partial<Record<BackupTable | 'settings', number>>;
  contentHashes: Partial<Record<BackupTable | 'settings', string>>;
}

export interface BackupFile {
  manifest: BackupManifest;
  data: BackupData;
}

export interface ImportReport {
  manifest: BackupManifest;
  added: Record<BackupTable, number>;
  reviewItems: number;
}

/** JSON with object keys sorted, so the hash does not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Row;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sorted(rows: Row[], key: string): Row[] {
  return [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0));
}

const hashOf = (rows: Row[], key: string) => sha256(canonicalJson(sorted(rows, key)));

export async function exportBackup(db: TrainerDB, now: number = Date.now()): Promise<BackupFile> {
  const data: Record<string, Row[]> = {};
  const itemCounts: BackupManifest['itemCounts'] = {};
  const contentHashes: BackupManifest['contentHashes'] = {};
  for (const t of TABLES) {
    const rows = sorted((await db.table(t.name).toArray()) as Row[], t.key);
    data[t.name] = rows;
    itemCounts[t.name] = rows.length;
    contentHashes[t.name] = await hashOf(rows, t.key);
  }
  const settings = sorted(((await db.meta.toArray()) as unknown as Row[]).filter((r) => isPortableSetting(String(r.key))), 'key');
  data.settings = settings;
  itemCounts.settings = settings.length;
  contentHashes.settings = await hashOf(settings, 'key');
  return {
    manifest: {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exporterVersion: __APP_VERSION__,
      exportTime: new Date(now).toISOString(),
      deviceId: await getDeviceId(db),
      itemCounts,
      contentHashes,
    },
    data: data as unknown as BackupData,
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
  const data = b.data as unknown as Record<string, Row[] | undefined>;
  for (const t of TABLES) {
    const rows = data[t.name];
    if (rows === undefined && m.schemaVersion < t.since) continue; // table did not exist yet
    if (!Array.isArray(rows)) throw new Error(`Backup is missing the "${t.name}" table.`);
    if (rows.length !== m.itemCounts?.[t.name]) throw new Error(`Backup is damaged: "${t.name}" should have ${m.itemCounts?.[t.name]} rows but has ${rows.length}.`);
    if ((await hashOf(rows, t.key)) !== m.contentHashes?.[t.name]) throw new Error(`Backup is damaged: the "${t.name}" table does not match its checksum.`);
    for (const r of rows) if (typeof r?.[t.key] !== 'string') throw new Error(`Backup contains a malformed row in "${t.name}".`);
  }
  const settings = data.settings;
  if (settings !== undefined) {
    if (!Array.isArray(settings) || settings.some((r) => typeof r?.key !== 'string')) throw new Error('Backup contains a malformed preferences section.');
    if ((await hashOf(settings, 'key')) !== m.contentHashes?.settings) throw new Error('Backup is damaged: the preferences do not match their checksum.');
  }
  for (const a of b.data.attempts) if (typeof a.exerciseId !== 'string' || typeof a.ts !== 'number') throw new Error('Backup contains a malformed attempt.');
  return b as BackupFile;
}

export async function importBackup(db: TrainerDB, text: string): Promise<ImportReport> {
  const backup = await parseBackup(text); // all validation happens before any write
  const data = backup.data as unknown as Record<string, Row[] | undefined>;
  const added = Object.fromEntries(TABLES.map((t) => [t.name, 0])) as Record<BackupTable, number>;
  await db.transaction('rw', [...TABLES.map((t) => db.table(t.name)), db.reviewStates, db.meta], async () => {
    // A preference already chosen on this device is kept; only missing ones are filled in.
    for (const r of backup.data.settings ?? []) {
      if (isPortableSetting(r.key) && (await db.meta.get(r.key)) === undefined) await db.meta.put({ key: r.key, value: r.value });
    }
    for (const t of TABLES) {
      const rows = data[t.name] ?? [];
      const table = db.table(t.name);
      if (t.mode === 'append') {
        const have = new Set((await table.toCollection().primaryKeys()) as string[]);
        const fresh = rows.filter((r) => !have.has(r[t.key] as string));
        await table.bulkAdd(fresh);
        added[t.name] = fresh.length;
      } else {
        for (const r of rows) {
          const mine = (await table.get(r[t.key] as string)) as Row | undefined;
          if (!mine) added[t.name]++;
          if (!mine || Number(r.updatedAt) > Number(mine.updatedAt)) await table.put(r);
        }
      }
    }
    await rebuildReviews(db);
  });
  return { manifest: backup.manifest, added, reviewItems: await db.reviewStates.count() };
}
