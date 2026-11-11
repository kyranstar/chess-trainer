import { afterEach, describe, expect, it } from 'vitest';
import { convertChessComGame } from './chesscom';
import { analyseGame } from './analyse';
import type { PvLine } from '../engine/uci';
import { applyUci, fenOf, positionFromFen } from '../chess/rules';
import { deleteDb, openDb, type TrainerDB } from '../db/db';
import fixture from './fixtures/my-games.fixture.json';
import { importGames, parseGamesFile } from './fixtures/load';
import { withMeasure } from './fixtures/measure';
import { clockPressure, drillPositions, earlyBlunderGames, gameCoverage, majorErrors, missedOpportunities, ratingSeries, timeUse } from './metrics';
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
    expect(r).toMatchObject({ added: 6, updated: 0, unchanged: 0, analysed: 6 });
    const g = (await db.games.toArray())[0]!;
    expect(g.analysisKey).toBe('game-analysis-v2/Stockfish 19/200000');
    expect(g.importedAt).toBe(1000);
  });

  it('importing the same file again changes nothing', async () => {
    const db = fresh();
    await importGames(db, text, 1000);
    const before = await db.games.toArray();
    expect(await importGames(db, text, 2000)).toMatchObject({ added: 0, updated: 0, unchanged: 6 });
    expect(await db.games.toArray()).toEqual(before);
  });

  it('a re-analysis with different engine settings replaces the old analysis and is labelled', async () => {
    const db = fresh();
    await importGames(db, text, 1000);
    const deeper = JSON.stringify({ ...FILE, manifest: { ...FILE.manifest, engine: { ...FILE.manifest.engine!, nodes: 400000 } } });
    expect(await importGames(db, deeper, 2000)).toMatchObject({ added: 0, updated: 6 });
    expect((await db.games.toArray()).every((g) => g.analysisKey === 'game-analysis-v2/Stockfish 19/400000' && g.importedAt === 1000 && g.updatedAt === 2000)).toBe(true);
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
    expect(await db.games.count()).toBe(6);
    expect(() => parseGamesFile(bad)).toThrow();
  });
});

describe('game metrics', () => {
  it('rating series are separate per time control and ordered by date', async () => {
    const games = await loaded();
    const rapid = ratingSeries(games, 'rapid');
    expect(rapid.points.map((p) => p.rating)).toEqual([465, 457, 449, 455]);
    expect(rapid.current).toMatchObject({ rating: 455, date: '2026-11-06' });
    expect(rapid.n).toBe(4);
    expect(ratingSeries(games, 'blitz').points.map((p) => p.rating)).toEqual([431]);
    expect(ratingSeries(games, 'daily').current?.rating).toBe(772);
    expect(ratingSeries(games, 'bullet')).toMatchObject({ n: 0, current: null });
  });

  it('coverage reports analysed games and decisions out of eligible ones', async () => {
    const games = await loaded();
    const withBare = [...games, { ...games[0]!, id: 'x', analysis: null, analysisKey: null }];
    const c = gameCoverage(withBare);
    expect(c).toMatchObject({ games: 7, analysedGames: 6 });
    expect(c.decisions).toBe(games.reduce((t, g) => t + g.analysis!.decisions.length, 0));
    expect(c.analysisKeys).toEqual(['game-analysis-v2/Stockfish 19/200000']);
  });

  it('major-error rate is errors per analysed decision, with the positions behind it', async () => {
    const games = await loaded();
    const m = majorErrors(games);
    expect(m.errors).toBe(3); // 4...Nf6 (queen), 5.d4 (missed win), 4.Qxe5+ (queen)
    expect(m.decisions).toBe(gameCoverage(games).decisions);
    expect(m.per100).toBeCloseTo((100 * 3) / m.decisions);
    expect(m.interval!.lo).toBeLessThan(m.rate!);
    expect(m.byLabel).toEqual({ 'loses-material': 2, 'allows-mate': 0, 'misses-material': 1, unclassified: 0 });
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
    expect(m.available).toBe(5); // Qxf7# taken; Nc6+ missed; Qxf7# missed; a free queen and a free bishop taken
    expect(m.missed).toBe(2);
    expect(m.events).toHaveLength(2);
  });

  it('clock pressure compares low-time and normal decisions and refuses to conclude from few', async () => {
    const games = (await loaded()).map((g) => withMeasure(g));
    const c = clockPressure(games);
    // Only one move was BEGUN with under a minute left (the one after the clock read 0:20). The
    // queen blunder before it was played with over nine minutes available: a long think, not time
    // trouble. (That decided positions are left out is tested with exact data further down.)
    expect(c.low).toEqual({ decisions: 1, errors: 0 });
    expect(c.normal.decisions).toBeGreaterThan(5);
    expect(c.normal.errors).toBeGreaterThanOrEqual(1);
    expect(c.enough).toBe(false);
    expect(c.noClock).toBe(1); // the daily game has no clock data
    expect(c.unmeasured).toBe(0);
  });

  it('drill positions are missed moves with one clearly best answer', async () => {
    const games = await loaded();
    const drills = drillPositions(games);
    expect(drills.map((d) => d.event.bestSan)).toEqual(['Qxf7#']);
    expect(drills[0]!.id).toMatch(/^game:[0-9a-f]{16}:6$/);
  });

  it('headline transfer measure: games with an early concrete blunder, counted per game', async () => {
    const stored = await loaded();
    // Without a measurement record nothing is counted, however good the imported analysis is.
    expect(earlyBlunderGames(stored, { timeClass: 'rapid' })).toMatchObject({ games: 0, pending: 4, protocol: null });
    const games = stored.map((g) => withMeasure(g));
    const m = earlyBlunderGames(games, { timeClass: 'rapid' });
    // Rapid fixture games: clean mate; 4...Nf6 loses the queen (move 4); 4.Qxe5+ loses the queen; clean game.
    expect(m).toMatchObject({ games: 4, withBlunder: 2 });
    expect(m.rate).toBe(0.5);
    expect(m.interval!.lo).toBeLessThan(0.5);
    expect(m.events.map((e) => e.event.playedSan).sort()).toEqual(['Nf6', 'Qxe5+']);
    // A missed win that lost nothing is not a blunder of this kind.
    expect(earlyBlunderGames(games, { timeClass: 'blitz' })).toMatchObject({ games: 1, withBlunder: 0 });
    // Only the first 20 moves count, and unrated or unanalysed games are left out.
    expect(earlyBlunderGames(games, { timeClass: 'rapid', maxMove: 3 }).withBlunder).toBe(0);
    const unrated = games.map((g) => ({ ...g, rated: false }));
    expect(earlyBlunderGames(unrated, { timeClass: 'rapid' }).games).toBe(0);
    // Secondary count: every such move per decision in the same move range.
    expect(m.moves.events).toBe(2);
    expect(m.moves.decisions).toBeGreaterThan(10);
    // One engine setting only: a game measured with another setting waits and is reported as pending.
    const rapid = games.filter((g) => g.timeClass === 'rapid');
    const mixed = games.map((g) => (g.id === rapid[0]!.id ? { ...g, measureKey: 'game-analysis-v3/Other engine/9' } : g));
    expect(earlyBlunderGames(mixed, { timeClass: 'rapid' })).toMatchObject({ games: 3, pending: 1, protocol: 'game-analysis-v3/Test engine/1' });
    // A deeper imported analysis does not change the number: only the measurement record is read.
    const reimported = games.map((g) => ({ ...g, analysis: { decisions: [], events: [] }, analysisKey: 'game-analysis-v2/Stockfish 19/900000' }));
    expect(earlyBlunderGames(reimported, { timeClass: 'rapid' })).toMatchObject({ games: m.games, withBlunder: m.withBlunder });
  });

  it('compares the most recent games with the ones before them, and says when there are too few', async () => {
    const games = (await loaded()).map((g) => withMeasure(g));
    const m = earlyBlunderGames(games, { timeClass: 'rapid', window: 2 });
    expect(m.recent).toMatchObject({ games: 2, withBlunder: 1 });
    expect(m.previous).toMatchObject({ games: 2, withBlunder: 1 });
    expect(earlyBlunderGames(games, { timeClass: 'rapid', window: 20 }).previous).toBeNull();
  });

  it('missed chances are also reported for positions that were not already won', async () => {
    const games = await loaded();
    const m = missedOpportunities(games);
    expect(m.undecided.available).toBeLessThanOrEqual(m.available);
    expect(m.undecided.missed).toBeLessThanOrEqual(m.missed);
    for (const e of m.undecided.events) expect(e.event.bestWp).toBeLessThan(100);
  });
});

describe('after the validity audit', () => {
  it('an unrated game is left out of the rating series (its rating is often that of another time control)', async () => {
    const db = fresh();
    await importGames(db, text, 1);
    const games = await db.games.toArray();
    const before = ratingSeries(games, 'rapid');
    const one = games.find((g) => g.timeClass === 'rapid' && g.playerRating !== null)!;
    const after = ratingSeries(games.map((g) => (g.id === one.id ? { ...g, rated: false } : g)), 'rapid');
    expect(after.n).toBe(before.n - 1);
    expect(after.points.some((p) => p.gameId === one.id)).toBe(false);
  });

  it('a chance counts when one move is clearly best, and once however long it stayed on the board', async () => {
    const db = fresh();
    await importGames(db, text, 1);
    const games = await db.games.toArray();
    const m = missedOpportunities(games);
    const clearEvents = games.flatMap((g) => g.analysis!.events.filter((e) => e.opportunity && e.secondWp !== null && e.bestWp - e.secondWp >= 20));
    expect(m.clear.available).toBeGreaterThan(0);
    expect(m.clear.available).toBeLessThanOrEqual(clearEvents.length);
    expect(m.clear.available).toBeLessThan(m.available); // positions where several moves win are not chances to find
    // The same chance left on the board for three moves in a row and never taken is one miss, not three.
    const e = clearEvents[0]!;
    const g0 = games.find((g) => g.analysis!.events.includes(e))!;
    const run = [0, 2, 4].map((d) => ({ ...e, ply: 100 + d, played: 'a2a3', best: 'h5f7', missed: true }));
    const one = missedOpportunities([{ ...g0, analysis: { decisions: [], events: run } }]);
    expect(one.clear).toMatchObject({ available: 1, missed: 1 });
    const taken = missedOpportunities([{ ...g0, analysis: { decisions: [], events: [run[0]!, { ...run[1]!, played: 'h5f7', missed: false }] } }]);
    expect(taken.clear).toMatchObject({ available: 1, missed: 0 });
  });

  it('time trouble is compared only on positions that were still undecided, from the measurement record', async () => {
    const db = fresh();
    await importGames(db, text, 1);
    const games = await db.games.toArray();
    expect(clockPressure(games).unmeasured).toBeGreaterThan(0); // nothing measured yet: nothing compared
    expect(clockPressure(games).low.decisions + clockPressure(games).normal.decisions).toBe(0);
    const g = games.find((x) => x.clocks && x.timeClass === 'rapid' && x.analysis && x.analysis.decisions.length >= 3)!;
    const base = Number(g.timeControl.split('+')[0]);
    const plies = g.analysis!.decisions.map((d) => d[0]).slice(0, 3);
    const measured = { ...g, measure: {
      decisions: [[plies[0]!, 0, base * 0.05], [plies[1]!, 30, base * 0.04], [plies[2]!, 30, 1]] as [number, number, number | null][],
      events: [],
      facts: [{ ply: plies[0]!, wp: 50, played: 0, best: 0 }, { ply: plies[1]!, wp: 50, played: 0, best: 0 }, { ply: plies[2]!, wp: 97, played: 0, best: 0 }],
    }, measureKey: 'k' };
    const c = clockPressure([measured]);
    expect(c.normal).toEqual({ decisions: 1, errors: 0 }); // first move: full clock
    expect(c.low).toEqual({ decisions: 1, errors: 1 }); // second: begun with 5% left, undecided, a major error
    // third: begun with 4% left but the game was already won (97): not compared
  });
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('castling is spelled two ways', () => {
  it('a chance that was taken by castling is not counted as missed', async () => {
    // The game as Chess.com gives it; White castles on move 5 with mate to follow (scripted engine below).
    const pgn = '[Event "Live Chess"]\n[White "fixture_learner"]\n[Black "someone"]\n[Result "1-0"]\n[TimeControl "600"]\n[EndDate "2026.11.01"]\n[Link "https://www.chess.com/game/live/900000098"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. O-O Nf6 1-0';
    const { game } = await convertChessComGame({ url: 'https://www.chess.com/game/live/900000098', pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', white: { username: 'fixture_learner', rating: 500 }, black: { username: 'someone', rating: 500 } }, 'fixture_learner');
    expect(game!.moves[8]).toBe('e1h1'); // the rules library spells castling as king-takes-rook
    let pos = positionFromFen(START);
    const fens: string[] = [];
    for (const u of game!.moves) { fens.push(fenOf(pos)); pos = applyUci(pos, u); }
    // A scripted engine: at move 5 castling is clearly best (as the engine spells it, e1g1); elsewhere the game move is best.
    const engine = {
      analyse: async (fen: string): Promise<PvLine[]> => {
        const ply = fens.indexOf(fen);
        if (ply === 8) return [{ move: 'e1g1', score: { mate: 4 }, pv: ['e1g1'] }, { move: 'b1c3', score: { cp: 0 }, pv: ['b1c3'] }];
        const move = ply >= 0 ? game!.moves[ply]! : 'a7a6';
        return [{ move, score: { cp: 20 }, pv: [move] }, { move, score: { cp: 10 }, pv: [move] }];
      },
    };
    const analysis = (await analyseGame(game!, engine))!;
    const e = analysis.events.find((x) => x.ply === 8)!;
    expect(e.opportunity).toBe('mate');
    expect(e.missed).toBe(false); // the analysis itself knows the move was found (it compares positions)
    const record: GameRecord = { ...game!, importedAt: 0, updatedAt: 0, analysis, analysisKey: 'k', measure: analysis, measureKey: 'k' };
    const m = missedOpportunities([record]);
    expect(m.clear.available).toBe(1);
    expect(m.clear.missed).toBe(0);
  });
});

describe('the headline compares fixed groups of games (outside reviewer, third pass)', () => {
  it('"the latest two" means the latest two: while the newest game is not measured there is no comparison, not one with an older game slipped in', async () => {
    const db = fresh();
    await importGames(db, text, 1);
    const rapid = (await db.games.toArray()).filter((g) => g.timeClass === 'rapid').map((g) => withMeasure({ ...g, rated: true }));
    expect(rapid.length).toBeGreaterThanOrEqual(4);
    // Five games in date order; the newest has not been measured yet.
    const five = [0, 1, 2, 3, 0].map((k, i) => ({ ...rapid[k]!, id: `g${i}`, endDate: `2026-11-0${i + 1}` }));
    const newestPending = five.map((g, i) => (i === 4 ? { ...g, measure: null, measureKey: null } : g));
    const m = earlyBlunderGames(newestPending, { timeClass: 'rapid', window: 2 });
    expect(m.recent).toBeNull();
    expect(m.previous).toBeNull();
    expect(m.windowPending).toBe(1);
    expect(m.games).toBe(4); // the overall share still covers the four measured games
    // Once it is measured the two groups are exactly games 4-5 and games 2-3.
    const all = earlyBlunderGames(five, { timeClass: 'rapid', window: 2 });
    const has = (g: (typeof five)[number]) => g.measure!.events.some((e) => !!e.target && e.ply < 40);
    expect(all.recent).toEqual({ games: 2, withBlunder: five.slice(3, 5).filter(has).length });
    expect(all.previous).toEqual({ games: 2, withBlunder: five.slice(1, 3).filter(has).length });
    expect(all.windowPending).toBe(0);
  });
});


describe('how the clock is used in real games', () => {
  it('reports clock left at the end of losses and how many major errors came with over half the clock left, with their denominators', () => {
    const g = (id: string, result: 'win' | 'loss', decisions: [number, number, number | null][]) => ({
      id, source: 'chess.com', url: null, date: '2026-11-01', endDate: '2026-11-01', endTime: null, timeControl: '600', timeClass: 'rapid', color: 'white', result,
      termination: null, playerRating: 1, opponentRating: 1, opponent: 'x', moves: [], clocks: [1], analysis: null, importedAt: 0, updatedAt: 0, analysisKey: null, rated: true,
      measure: { decisions, events: [], facts: [] }, measureKey: 'k',
    }) as unknown as GameRecord;
    const t = timeUse([
      g('a', 'loss', [[0, 0, 590], [2, 30, 560], [4, 25, 300], [6, 0, 290]]), // ends with 290 of 600 left; errors begun at 590 and 560 seconds
      g('b', 'loss', [[0, 0, 500], [2, 40, 100], [4, 22, 20]]), // ends with 20 left; errors begun at 500 and 100
      g('c', 'win', [[0, 0, 550]]),
    ], 'rapid');
    expect(t.games).toBe(3);
    expect(t.losses).toBe(2);
    expect(t.lossesOverHalfUnused).toBe(0);
    expect(t.medianEndShareLosses).toBeCloseTo((290 / 600 + 20 / 600) / 2, 5);
    expect(t.errors).toEqual({ n: 4, overHalfClock: 3 });
    expect(timeUse([], 'rapid')).toMatchObject({ games: 0, medianEndShareLosses: null });
  });
});
