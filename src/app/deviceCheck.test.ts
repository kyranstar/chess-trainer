import { describe, expect, it } from 'vitest';
import { checkEndgameTable, checkRules, checkStorageRoundTrip, perft } from './deviceCheck';

describe('device self-checks that do not need a browser', () => {
  it('counts legal move sequences from the start position correctly', () => {
    expect(perft('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1)).toBe(20);
    expect(perft('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3)).toBe(8902);
    // "Kiwipete": castling, en passant, promotions and pins all matter here.
    expect(perft('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2)).toBe(2039);
  });

  it('reports pass for rules and the endgame table', async () => {
    expect((await checkRules()).status).toBe('pass');
    expect((await checkEndgameTable()).status).toBe('pass');
  });

  it('writes, reopens, backs up and restores in throwaway databases and cleans up', async () => {
    const before = (await indexedDB.databases()).map((d) => d.name);
    const r = await checkStorageRoundTrip();
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/restored/);
    const after = (await indexedDB.databases()).map((d) => d.name);
    expect(after.filter((n) => n?.startsWith('device-check'))).toEqual([]);
    expect(after.length).toBe(before.length);
  });
});
