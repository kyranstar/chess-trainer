/**
 * Settings that travel between devices carry the time they last changed (ADR-063).
 *
 * The account copy merges a device's data with the copy in the account every time the app
 * opens. Rows of practice are append-only and merge by id, but a setting can be changed or
 * taken off: a flag removed, Chess.com unlinked, a repertoire move declined. Without a time
 * a merge cannot tell an old value from a removal, and the removed setting would come back
 * from the other device. So every write or delete of a portable setting also writes
 * `stamp:<key>` with the time and whether it was a removal, in the same transaction, from a
 * database middleware: no writer anywhere in the app has to remember it.
 */
import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from 'dexie';

/** Preferences that are the learner's own choices and worth carrying to another device. */
const SETTING_KEYS = ['openings.band', 'openings.side', 'chesscom.username', 'openings.declined'];
const SETTING_PREFIXES = ['lessonProgress:', 'flag:'];
export function isPortableSetting(key: string): boolean {
  return SETTING_KEYS.includes(key) || SETTING_PREFIXES.some((p) => key.startsWith(p));
}

export const STAMP_PREFIX = 'stamp:';
export const stampKey = (key: string): string => `${STAMP_PREFIX}${key}`;

export interface SettingStamp { key: string; ts: number; deleted: boolean }

function stampRows(keys: unknown[], deleted: boolean): { key: string; value: SettingStamp }[] {
  const ts = Date.now();
  return keys.filter((k): k is string => typeof k === 'string' && isPortableSetting(k)).map((key) => ({ key: stampKey(key), value: { key, ts, deleted } }));
}

function stampingTable(table: DBCoreTable): DBCoreTable {
  return {
    ...table,
    async mutate(req: DBCoreMutateRequest) {
      const res = await table.mutate(req);
      let stamps: { key: string; value: SettingStamp }[] = [];
      if (req.type === 'put' || req.type === 'add') stamps = stampRows(req.values.map((v) => (v as { key?: unknown })?.key), false);
      else if (req.type === 'delete') stamps = stampRows(req.keys, true);
      // `deleteRange` (a cleared table) is not used on settings; it is left unstamped.
      if (stamps.length) await table.mutate({ type: 'put', trans: req.trans, values: stamps });
      return res;
    },
  };
}

export const stampMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'settingStamps',
  create: (down) => ({ ...down, table: (name) => (name === 'meta' ? stampingTable(down.table(name)) : down.table(name)) }),
};
