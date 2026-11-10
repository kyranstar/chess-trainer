import { afterEach, describe, expect, it } from 'vitest';
import { deleteDb, openDb, type TrainerDB } from '../db/db';
import fixture from './fixtures/my-games.fixture.json';
import { importGames, parseGamesFile } from './import';
import { clockPressure, drillPositions, gameCoverage, majorErrors, missedOpportunities, ratingSeries } from './metrics';
import type { GameRecord, GamesFile } from './types';

const FILE = fixture as unknown as GamesFile;
const text = JSON.stringify(FILE);
const names: string[] = [];
function fresh(): TrainerDB {
  const n = `games-${names.length}-${Math.random().toString(36).slice(2)}`;
  names.push(n);
  return openDb(n);
}
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});
async function loaded(): Promise<GameRecord[]> {
  const db = fresh();
  await importGames(db, text, 1000);
  return db.games.orderBy('endDate').toArray();
}

describe('game import', () => {
  it('stores every game with its analysis provenance', async () => {
    const db = fresh();
    const r = await importGames(db, text, 1000);
    expect(r).toMatchObject({ added: 5, updated: 0, unchanged: 0, analysed: 5 });
    const g = (await db.games.toArray())[0]!;
    expect(g.analysisKey).toBe('game-analysis-v1/Stockfish 19/200000');
    expect(g.importedAt).toBe(1000);
  });

  it('importing the same file again changes nothing', async () => {
    const db = fresh();
    await importGames(db, text, 1000);
    const before = await db.games.toArray();
    expect(await importGames(db, text, 2000)).toMatchObject({ added: 0, updated: 0, unchanged: 5 });
    expect(await db.games.toArray()).toEqual(before);
  });

  it('a re-analysis with different engine settings replaces the old analysis and is labelled', async () => {
    const db = fresh();
    await importGames(db, text, 1000);
    const deeper = JSON.stringify({ ...FILE, manifest: { ...FILE.manifest, engine: { ...FILE.manifest.engine!, nodes: 400000 } } });
    expect(await importGames(db, deeper, 2000)).toMatchObject({ added: 0, updated: 5 });
    expect((await db.games.toArray()).every((g) => g.analysisKey === 'game-analysis-v1/Stockfish 19/400000' && g.importedAt === 1000 && g.updatedAt === 2000)).toBe(true);
  });

  it('an import-only file (no engine) never erases an existing analysis', async () => {
    const db = fresh();
    await importGames(db, text, 1000);
    const bare = JSON.stringify({ manifest: { ...FILE.manifest, engine: null }, games: FILE.games.map((g) => ({ ...g, analysis: null })) });
    await importGames(db, bare, 2000);
    expect((await db.games.toArray()).every((g) => g.analysis !== null)).toBe(true);
  });

  it.each([
    ['not JSON', 'nope'],
    ['another format', JSON.stringify({ manifest: { format: 'chess-trainer-backup' }, games: [] })],
    ['a newer schema', JSON.stringify({ ...FILE, manifest: { ...FILE.manifest, schema: 9 } })],
    ['a malformed game', JSON.stringify({ ...FILE, games: [{ id: 5 }] })],
  ])('rejects %s without touching stored games', async (_l, bad) => {
    const db = fresh();
    await importGames(db, text, 1000);
    await expect(importGames(db, bad, 2000)).rejects.toThrow();
    expect(await db.games.count()).toBe(5);
    expect(() => parseGamesFile(bad)).toThrow();
  });
});

describe('game metrics', () => {
  it('rating series are separate per time control and ordered by date', async () => {
    const games = await loaded();
    const rapid = ratingSeries(games, 'rapid');
    expect(rapid.points.map((p) => p.rating)).toEqual([465, 457, 449]);
    expect(rapid.current).toMatchObject({ rating: 449, date: '2026-11-04' });
    expect(rapid.n).toBe(3);
    expect(ratingSeries(games, 'blitz').points.map((p) => p.rating)).toEqual([431]);
    expect(ratingSeries(games, 'daily').current?.rating).toBe(772);
    expect(ratingSeries(games, 'bullet')).toMatchObject({ n: 0, current: null });
  });

  it('coverage reports analysed games and decisions out of eligible ones', async () => {
    const games = await loaded();
    const withBare = [...games, { ...games[0]!, id: 'x', analysis: null, analysisKey: null }];
    const c = gameCoverage(withBare);
    expect(c).toMatchObject({ games: 6, analysedGames: 5 });
    expect(c.decisions).toBe(games.reduce((t, g) => t + g.analysis!.decisions.length, 0));
    expect(c.analysisKeys).toEqual(['game-analysis-v1/Stockfish 19/200000']);
  });

  it('major-error rate is errors per analysed decision, with the positions behind it', async () => {
    const games = await loaded();
    const m = majorErrors(games);
    expect(m.errors).toBe(3); // 4...Nf6 (queen), 5.d4 (missed win), 4.Qxe5+ (queen)
    expect(m.decisions).toBe(gameCoverage(games).decisions);
    expect(m.per100).toBeCloseTo((100 * 3) / m.decisions);
    expect(m.interval!.lo).toBeLessThan(m.rate!);
    expect(m.byLabel).toEqual({ 'loses-material': 2, 'allows-mate': 0, unclassified: 1 });
    expect(m.events.map((e) => e.event.playedSan).sort()).toEqual(['Nf6', 'Qxe5+', 'd4']);
    expect(m.confidence).toBe('provisional');
  });

  it('filters by time control and never divides by unanalysed games', async () => {
    const games = await loaded();
    const blitz = majorErrors(games, { timeClass: 'blitz' });
    expect(blitz.errors).toBe(1);
    expect(blitz.games).toBe(1);
    const none = majorErrors(games.map((g) => ({ ...g, analysis: null })));
    expect(none).toMatchObject({ decisions: 0, rate: null, confidence: 'none' });
  });

  it('missed opportunities are counted out of opportunities that existed', async () => {
    const games = await loaded();
    const m = missedOpportunities(games);
    expect(m.available).toBe(3); // Qxf7# taken; Nc6+ missed; Qxf7# missed
    expect(m.missed).toBe(2);
    expect(m.events).toHaveLength(2);
  });

  it('clock pressure compares low-time and normal decisions and refuses to conclude from few', async () => {
    const games = await loaded();
    const c = clockPressure(games);
    expect(c.low.decisions).toBe(2); // the two moves made with 20 s and 18 s left of 10 minutes
    expect(c.low.errors).toBe(1);
    expect(c.normal.decisions).toBeGreaterThan(5);
    expect(c.enough).toBe(false);
    expect(c.noClock).toBe(1); // the daily game has no clock data
  });

  it('drill positions are missed moves with one clearly best answer', async () => {
    const games = await loaded();
    const drills = drillPositions(games);
    expect(drills.map((d) => d.event.bestSan)).toEqual(['Qxf7#']);
    expect(drills[0]!.id).toMatch(/^game:[0-9a-f]{16}:6$/);
  });
});
