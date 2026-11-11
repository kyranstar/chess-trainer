/**
 * Sending a backup to the learner's own private GitHub repository (ADR-048, owner decision).
 *
 * The app is local-only by default and stays so: nothing here runs until a repository and a
 * token for it have been entered on this device. With them, the same file that "Download
 * backup" writes is put into that repository whenever the practice data has changed. It is a
 * copy outside the phone, and it lets the practice be reviewed from another machine without
 * anyone exporting a file by hand.
 *
 * The token is kept in this browser's storage only. It is never part of a backup, never in a
 * URL, and is sent to api.github.com alone, as the authorisation header.
 */
import { exportBackup, serializeBackup } from './backup';
import { getMeta, setMeta, type TrainerDB } from './db';

export const REMOTE_REPO_KEY = 'remote.repo';
export const REMOTE_TOKEN_KEY = 'remote.token';
export const REMOTE_STATE_KEY = 'remote.state';
/** The repository to offer in the settings field; set at build time for the owner's own build. */
export const DEFAULT_REMOTE_REPO: string = (import.meta.env?.VITE_REVIEW_REPO as string | undefined) ?? '';
export const REMOTE_FILE = 'backup.json.gz';
export const REMOTE_MIN_INTERVAL_MS = 120_000;
const API = 'https://api.github.com';

export interface RemoteResponse { ok: boolean; status: number; json(): Promise<unknown> }
export type RemoteFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<RemoteResponse>;
export const browserRemoteFetch: RemoteFetch = (url, init) => fetch(url, { ...init, cache: 'no-store' });

export type RemoteResult =
  | { ok: true; at: number; bytes: number }
  | { ok: false; reason: 'not-set' | 'offline' | 'unauthorized' | 'no-repo' | 'error'; detail?: string };
export interface RemoteState { at: number; signature: string; bytes: number }

export async function remoteConfig(db: TrainerDB): Promise<{ repo: string; token: string } | null> {
  const repo = await getMeta<string>(db, REMOTE_REPO_KEY);
  const token = await getMeta<string>(db, REMOTE_TOKEN_KEY);
  return repo && token ? { repo, token } : null;
}

export async function setRemote(db: TrainerDB, repo: string, token: string): Promise<void> {
  const r = repo.trim();
  const t = token.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) throw new Error('Write the repository as owner/name, for example yourname/chess-trainer-data.');
  if (!t) throw new Error('Paste the token for that repository.');
  await setMeta(db, REMOTE_REPO_KEY, r);
  await setMeta(db, REMOTE_TOKEN_KEY, t);
  await db.meta.delete(REMOTE_STATE_KEY);
}

/** Stops sending and removes the token from this device. What was already sent stays in the repository. */
export async function clearRemote(db: TrainerDB): Promise<void> {
  await db.meta.bulkDelete([REMOTE_TOKEN_KEY, REMOTE_REPO_KEY, REMOTE_STATE_KEY]);
}

/** Cheap fingerprint of what a backup would contain: changes whenever there is something new to send. */
export async function dataSignature(db: TrainerDB): Promise<string> {
  const sessions = await db.sessions.toArray();
  const games = await db.games.toArray();
  return [
    await db.attempts.count(), await db.lessonEvents.count(), await db.repertoire.count(), await db.gameJournal.count(),
    sessions.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0),
    games.length, games.filter((g) => g.measure).length,
  ].join('|');
}

async function gzipBase64(text: string): Promise<{ base64: string; bytes: number }> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), bytes: bytes.length };
}

/** The backup text back out of what was sent (used by tests and by the review tool). */
export async function decodeRemoteFile(base64: string): Promise<string> {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Puts the current backup into the repository, replacing the previous one. */
export async function uploadBackup(db: TrainerDB, fetchFn: RemoteFetch, now: number): Promise<RemoteResult> {
  const cfg = await remoteConfig(db);
  if (!cfg) return { ok: false, reason: 'not-set' };
  const url = `${API}/repos/${cfg.repo}/contents/${REMOTE_FILE}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  try {
    const signature = await dataSignature(db);
    const file = await gzipBase64(serializeBackup(await exportBackup(db, now)));
    // Two tries: if the file changed between reading its version and writing (another device), read again once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await fetchFn(url, { headers });
      if (current.status === 401 || current.status === 403) return { ok: false, reason: 'unauthorized' };
      const sha = current.ok ? ((await current.json()) as { sha?: string }).sha : undefined;
      const put = await fetchFn(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Backup ${new Date(now).toISOString()}`, content: file.base64, ...(sha ? { sha } : {}) }) });
      if (put.ok) {
        await setMeta(db, REMOTE_STATE_KEY, { at: now, signature, bytes: file.bytes } satisfies RemoteState);
        return { ok: true, at: now, bytes: file.bytes };
      }
      if (put.status === 401 || put.status === 403) return { ok: false, reason: 'unauthorized' };
      if (put.status === 404) return { ok: false, reason: 'no-repo' };
      if (put.status !== 409 && put.status !== 422) return { ok: false, reason: 'error', detail: `GitHub answered ${put.status}` };
    }
    return { ok: false, reason: 'error', detail: 'the file kept changing while it was being replaced' };
  } catch (e) {
    // A failed request (no connection, blocked) throws; anything else is reported as it is.
    return e instanceof TypeError ? { ok: false, reason: 'offline' } : { ok: false, reason: 'error', detail: (e as Error).message };
  }
}

/** Sends when sending is set up, something has changed since the last successful send, and that was long enough ago. */
export async function uploadIfChanged(db: TrainerDB, fetchFn: RemoteFetch, now: number, minIntervalMs = REMOTE_MIN_INTERVAL_MS): Promise<RemoteResult | null> {
  if (!(await remoteConfig(db))) return null;
  const last = await getMeta<RemoteState>(db, REMOTE_STATE_KEY);
  if (last) {
    if (now - last.at < minIntervalMs) return null;
    if (last.signature === (await dataSignature(db))) return null;
  }
  return uploadBackup(db, fetchFn, now);
}

export function remoteMessage(r: RemoteResult): string {
  if (r.ok) return `Sent ${new Date(r.at).toLocaleString()} (${(r.bytes / 1024).toFixed(0)} KB).`;
  if (r.reason === 'unauthorized') return 'GitHub refused the token. It may have expired, or it lacks “Contents: read and write” for this repository.';
  if (r.reason === 'no-repo') return 'GitHub found no such repository for this token. Check the name and that the token is for it.';
  if (r.reason === 'offline') return 'No connection. It will be sent when there is one.';
  if (r.reason === 'not-set') return 'Sending is not set up on this device.';
  return `Not sent: ${r.detail ?? 'unknown error'}. It will be tried again.`;
}
