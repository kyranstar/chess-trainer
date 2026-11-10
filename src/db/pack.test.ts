import { afterEach, describe, expect, it } from 'vitest';
import type { PackManifest, Puzzle } from '../puzzles/types';
import { deleteDb, openDb, recordAttempt, type TrainerDB } from './db';
import { installPack, packStatus } from './pack';

const names: string[] = [];
function fresh(): TrainerDB {
  const name = `pack-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

const puzzle = (id: string): Puzzle => ({
  id, fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', moves: 'f2g3 e6e7 b2b1 b3c1 b1c1 h6c1',
  rating: 1819, rd: 77, pop: 95, plays: 10446, themes: ['hangingPiece'], game: 'game/x',
});

async function served(puzzles: Puzzle[], version: string, tamper?: (body: string) => string) {
  const body = JSON.stringify(puzzles);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hash = `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const manifest = {
    id: 'lichess-core', version, schema: 1, file: 'lichess-core.json', bytes: body.length, contentHash: hash, count: puzzles.length,
    buildDate: '2026-11-10', source: { id: 's', title: 't', url: 'u', license: 'CC0-1.0', rawSha256: 'x', rawRows: 1 },
    verification: { engine: 'Stockfish 19', policy: 'p' }, counts: { byTheme: {}, byOpening: {}, byBand: {} },
  } satisfies PackManifest;
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    return new Response(tamper ? tamper(body) : body);
  };
  return { fetcher, calls, manifest };
}

describe('offline pack install', () => {
  it('installs a verified pack and reports it', async () => {
    const db = fresh();
    expect((await packStatus(db)).state).toBe('missing');
    const { fetcher } = await served([puzzle('a'), puzzle('b')], '1');
    const row = await installPack(db, fetcher);
    expect(row.manifest.count).toBe(2);
    expect(await db.puzzles.count()).toBe(2);
    expect((await db.puzzles.get('a'))!.packId).toBe('lichess-core');
    const st = await packStatus(db);
    expect(st.state).toBe('installed');
    expect(st.manifest?.version).toBe('1');
  });

  it('does not download the body again when the same version is installed', async () => {
    const db = fresh();
    const s = await served([puzzle('a')], '1');
    await installPack(db, s.fetcher);
    await installPack(db, s.fetcher);
    expect(s.calls.filter((u) => u.endsWith('lichess-core.json'))).toHaveLength(1);
  });

  it('rejects a body that does not match the manifest hash and keeps the old pack', async () => {
    const db = fresh();
    await installPack(db, (await served([puzzle('a')], '1')).fetcher);
    const bad = await served([puzzle('a'), puzzle('c')], '2', (b) => b.replace('1819', '1820'));
    await expect(installPack(db, bad.fetcher)).rejects.toThrow(/checksum/i);
    expect((await packStatus(db)).manifest?.version).toBe('1');
    expect(await db.puzzles.count()).toBe(1);
  });

  it('a failed download leaves existing content and history untouched', async () => {
    const db = fresh();
    await installPack(db, (await served([puzzle('a')], '1')).fetcher);
    const a = await recordAttempt(db, {
      sessionId: null, context: 'practice', exerciseId: 'lichess:a', exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
      conceptId: null, themes: [], rating: 1, ts: 1, elapsedMs: 1, firstMove: null, played: [], mistakes: 0, hints: 0,
      outcome: 'fail', acceptedAlternative: false,
    });
    await expect(installPack(db, async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow(/download/i);
    await expect(installPack(db, async () => new Response('nope', { status: 404 }))).rejects.toThrow(/download/i);
    expect(await db.puzzles.count()).toBe(1);
    expect(await db.attempts.get(a.uuid)).toEqual(a);
  });

  it('replacing a pack removes retired puzzles but never the attempts made on them', async () => {
    const db = fresh();
    await installPack(db, (await served([puzzle('a'), puzzle('b')], '1')).fetcher);
    const a = await recordAttempt(db, {
      sessionId: null, context: 'practice', exerciseId: 'lichess:b', exerciseKind: 'puzzle', contentVersion: 'lichess-core@1',
      conceptId: null, themes: [], rating: 1, ts: 1, elapsedMs: 1, firstMove: null, played: [], mistakes: 0, hints: 0,
      outcome: 'fail', acceptedAlternative: false,
    });
    await installPack(db, (await served([puzzle('a'), puzzle('c')], '2')).fetcher);
    expect((await db.puzzles.toArray()).map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(await db.attempts.get(a.uuid)).toEqual(a);
    expect(await db.reviewStates.get('lichess:b')).toBeDefined();
  });
});
