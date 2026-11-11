import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, parseBackup } from './backup';
import { deleteDb, openDb, recordAttempt } from './db';
import { clearRemote, decodeRemoteFile, REMOTE_FILE, remoteConfig, type RemoteFetch, setRemote, uploadBackup, uploadIfChanged } from './remote';

const names: string[] = [];
async function fresh() {
  const name = `remote-test-${Math.random()}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const name of names.splice(0)) await deleteDb(name);
});

const TOKEN = 'test-token-not-a-real-one';
const attempt = (ts: number) => ({ sessionId: null, context: 'practice' as const, exerciseId: `lichess:x${ts}`, exerciseKind: 'puzzle' as const, contentVersion: 'p@1', conceptId: null, themes: [], rating: 1000, ts, elapsedMs: 1, firstMove: 'e2e4', played: ['e2e4'], mistakes: 0, hints: 0, outcome: 'success' as const, acceptedAlternative: false });

/** A stand-in for GitHub's contents API holding one file. */
function github(opts: { exists?: boolean; status?: number; repoMissing?: boolean } = {}) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: { message: string; content: string; sha?: string } | null }[] = [];
  let sha = opts.exists ? 'sha-1' : null;
  let stored: string | null = null;
  const fetchFn: RemoteFetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, headers: init?.headers ?? {}, body });
    const res = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
    if (opts.status) return res(opts.status, { message: 'no' });
    if (opts.repoMissing) return res(404, { message: 'Not Found' });
    if (method === 'GET') return sha ? res(200, { sha }) : res(404, { message: 'Not Found' });
    if ((body.sha ?? null) !== sha) return res(409, { message: 'sha does not match' });
    stored = body.content;
    sha = `sha-${calls.length}`;
    return res(sha === 'sha-1' ? 201 : 200, { content: { sha } });
  };
  return { fetchFn, calls, stored: () => stored };
}

describe('sending a backup to the learner’s own private repository', () => {
  it('does nothing and contacts nobody until a repository and a token have been set on this device', async () => {
    const db = await fresh();
    const g = github();
    expect(await uploadBackup(db, g.fetchFn, 1)).toEqual({ ok: false, reason: 'not-set' });
    expect(await uploadIfChanged(db, g.fetchFn, 1)).toBeNull();
    expect(g.calls).toEqual([]);
  });

  it('creates the file the first time and replaces it afterwards, and what arrives is a complete, valid backup', async () => {
    const db = await fresh();
    await recordAttempt(db, attempt(10));
    await setRemote(db, 'someone/chess-trainer-data', TOKEN);
    const g = github();
    const first = await uploadBackup(db, g.fetchFn, 1000);
    expect(first).toMatchObject({ ok: true, at: 1000 });
    expect(g.calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(g.calls[1]!.url).toBe(`https://api.github.com/repos/someone/chess-trainer-data/contents/${REMOTE_FILE}`);
    expect(g.calls[1]!.body!.sha).toBeUndefined();
    const backup = await parseBackup(await decodeRemoteFile(g.stored()!));
    expect(backup.data.attempts).toHaveLength(1);
    expect(backup.manifest.itemCounts.attempts).toBe(1);

    await recordAttempt(db, attempt(20));
    const second = await uploadBackup(db, g.fetchFn, 2000);
    expect(second.ok).toBe(true);
    expect(g.calls[3]!.body!.sha).toBe('sha-2'); // the file is replaced, not duplicated
    expect((await parseBackup(await decodeRemoteFile(g.stored()!))).data.attempts).toHaveLength(2);
  });

  it('sends the token only as the authorisation of requests to GitHub’s API, never inside the file, a backup, or a URL', async () => {
    const db = await fresh();
    await setRemote(db, 'someone/chess-trainer-data', TOKEN);
    const g = github();
    await uploadBackup(db, g.fetchFn, 1000);
    for (const c of g.calls) {
      expect(c.url.startsWith('https://api.github.com/')).toBe(true);
      expect(c.url).not.toContain(TOKEN);
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(await decodeRemoteFile(g.stored()!)).not.toContain(TOKEN);
    expect(JSON.stringify(await exportBackup(db))).not.toContain(TOKEN);
  });

  it('sends again only when the practice data has changed, and not more often than every two minutes', async () => {
    const db = await fresh();
    await recordAttempt(db, attempt(10));
    await setRemote(db, 'someone/chess-trainer-data', TOKEN);
    const g = github();
    expect((await uploadIfChanged(db, g.fetchFn, 1_000_000))?.ok).toBe(true);
    expect(await uploadIfChanged(db, g.fetchFn, 1_500_000)).toBeNull(); // nothing new
    await recordAttempt(db, attempt(20));
    expect(await uploadIfChanged(db, g.fetchFn, 1_030_000)).toBeNull(); // new data, but only 30 s later
    expect((await uploadIfChanged(db, g.fetchFn, 1_200_000))?.ok).toBe(true);
    expect(g.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });

  it('says plainly what went wrong: token refused, repository not found, no connection; and keeps trying later', async () => {
    const db = await fresh();
    await recordAttempt(db, attempt(10));
    await setRemote(db, 'someone/chess-trainer-data', TOKEN);
    expect(await uploadBackup(db, github({ status: 401 }).fetchFn, 1)).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(await uploadBackup(db, github({ repoMissing: true }).fetchFn, 1)).toMatchObject({ ok: false, reason: 'no-repo' });
    const offline: RemoteFetch = async () => { throw new TypeError('Load failed'); };
    expect(await uploadBackup(db, offline, 1)).toMatchObject({ ok: false, reason: 'offline' });
    // A failure does not count as sent: the next check tries again.
    expect((await uploadIfChanged(db, github().fetchFn, 10_000_000))?.ok).toBe(true);
  });

  it('rejects a repository name that is not owner/name, and forgetting removes the token from the device', async () => {
    const db = await fresh();
    await expect(setRemote(db, 'https://github.com/someone/repo', TOKEN)).rejects.toThrow(/owner\/name/);
    await setRemote(db, ' someone/chess-trainer-data ', ` ${TOKEN} `);
    expect(await remoteConfig(db)).toEqual({ repo: 'someone/chess-trainer-data', token: TOKEN });
    await clearRemote(db);
    expect(await remoteConfig(db)).toBeNull();
    expect((await db.meta.toArray()).some((r) => JSON.stringify(r).includes(TOKEN))).toBe(false);
  });
});
