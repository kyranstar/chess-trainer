import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseInfo, UciEngine, winPercent } from '../engine/uci';
import { analyseGame, lineEnd, material, materialAfter, targetKind } from './analyse';
import { convertChessComGame } from './chesscom';
import archive from './fixtures/chesscom-archive.fixture.json';
import { positionFromFen } from '../chess/rules';

/** The same WebAssembly engine the app ships, loaded in Node. */
function nodeEngine(): UciEngine {
  const require = createRequire(import.meta.url);
  const engine = require('../../public/engine/stockfish-19-lite-single.js')();
  const listeners: ((l: string) => void)[] = [];
  engine.listener = (line: string) => listeners.forEach((l) => l(line));
  return new UciEngine({ send: (c) => engine.processCommand(c), onLine: (cb) => listeners.push(cb), terminate: () => engine.terminate?.() });
}

describe('UCI parsing', () => {
  it('reads multipv, score and line; ignores bounds and lines without a pv', () => {
    expect(parseInfo('info depth 12 seldepth 18 multipv 2 score cp -31 nodes 1000 pv e7e5 g1f3')).toEqual({ multipv: 2, score: { cp: -31 }, pv: ['e7e5', 'g1f3'] });
    expect(parseInfo('info depth 9 score mate 3 pv h5f7')).toEqual({ multipv: 1, score: { mate: 3 }, pv: ['h5f7'] });
    expect(parseInfo('info depth 9 score cp 20 lowerbound pv e2e4')).toBeNull();
    expect(parseInfo('info depth 9 currmove e2e4')).toBeNull();
  });
  it('expected score is 50 at equality, monotone, and 100/0 for mates', () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    expect(winPercent({ cp: 300 })).toBeGreaterThan(winPercent({ cp: 100 }));
    expect(winPercent({ mate: 2 })).toBe(100);
    expect(winPercent({ mate: -2 })).toBe(0);
  });
});

describe('material along a line', () => {
  it('an even exchange nets zero and a cut-off line shows the gain', () => {
    const fen = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
    expect(material(positionFromFen(fen), 'white')).toBe(0);
    expect(materialAfter(fen, ['b5c6', 'd7c6'], 'white')).toBe(0);
    expect(materialAfter(fen, ['b5c6'], 'white')).toBe(3);
    expect(materialAfter(fen, ['b5c6', 'd7c6'], 'black')).toBe(0);
  });
  it('a line that stops right after a capture is not settled: the recapture may be pending', () => {
    const fen = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
    expect(lineEnd(fen, ['b5c6'], 'white')).toEqual({ balance: 3, settled: false });
    expect(lineEnd(fen, ['b5c6', 'd7c6'], 'white')).toEqual({ balance: 0, settled: false }); // ends on a capture too
    // A quiet move after the exchange does not settle it either while the line is shorter than the window.
    expect(lineEnd(fen, ['b5c6', 'd7c6', 'd2d3'], 'white')).toEqual({ balance: 0, settled: false });
    expect(lineEnd(fen, ['b5a4', 'g8f6'], 'white')).toEqual({ balance: 0, settled: false });
  });
});

describe('the target behaviour is defined on the board, not by a score drop', () => {
  it('a piece hung in an already lost or already won position counts although the score hardly moved', () => {
    expect(targetKind({ ply: 30, wp: 4, played: -5, best: 0 }, 2)).toBe('material');
    expect(targetKind({ ply: 30, wp: 99, played: -9, best: 0 }, 2.5)).toBe('material');
  });
  it('a sacrifice the engine accepts in an undecided position does not count', () => {
    expect(targetKind({ ply: 14, wp: 55, played: -3, best: 0 }, 0.4)).toBeNull();
  });
  it('a loss the best move could not avoid either does not count; an avoidable quick mate does', () => {
    expect(targetKind({ ply: 14, wp: 40, played: -3, best: -3 }, 0)).toBeNull();
    expect(targetKind({ ply: 14, wp: 40, played: -1, best: 0 }, 30)).toBeNull(); // a pawn is under the threshold
    expect(targetKind({ ply: 14, wp: 60, played: 0, best: 0, mated: true }, 60)).toBe('mate');
  });
  it('material read off a line cut short in the middle of an exchange proves nothing', () => {
    expect(targetKind({ ply: 14, wp: 50, played: -3, best: 0, unsure: true }, 30)).toBeNull();
  });

});

describe('game analysis with the shipped engine', () => {
  let engine: UciEngine;
  const games = new Map<string, Awaited<ReturnType<typeof analyseGame>>>();
  beforeAll(async () => {
    engine = nodeEngine();
    for (const raw of archive.games) {
      const { game } = await convertChessComGame(raw, 'fixture_learner');
      if (game) games.set(game.url!.split('/').pop()!, await analyseGame(game, engine, { nodes: 40_000 }));
    }
  }, 180_000);
  afterAll(() => engine?.terminate());

  it('the same game analysed twice from a cleared engine gives the same record', async () => {
    const raw = archive.games[1]!;
    const { game } = await convertChessComGame(raw, 'fixture_learner');
    await engine.newGame();
    const first = await analyseGame(game!, engine, { nodes: 20_000 });
    // Something else in between, as on a real device ...
    await analyseGame((await convertChessComGame(archive.games[0]!, 'fixture_learner')).game!, engine, { nodes: 20_000 });
    await engine.newGame();
    const second = await analyseGame(game!, engine, { nodes: 20_000 });
    expect(second).toEqual(first);
  }, 120_000);

  it('only the learner’s moves are decisions', () => {
    expect(games.get('900000001')!.decisions.map((d) => d[0])).toEqual([0, 2, 4, 6]);
    expect(games.get('900000002')!.decisions.map((d) => d[0])).toEqual([1, 3, 5, 7, 9]);
  });

  it('a mate that was played is a chance taken, not an error', () => {
    const e = games.get('900000001')!.events.find((x) => x.ply === 6)!;
    expect(e).toMatchObject({ opportunity: 'mate', missed: false, majorError: false, playedWp: 100 });
  });

  it('losing the queen is a major error that loses material, with the clock recorded', () => {
    const e = games.get('900000002')!.events.find((x) => x.ply === 7)!;
    expect(e).toMatchObject({ playedSan: 'Nf6', majorError: true, errorLabel: 'loses-material', clock: 20 });
    expect(e.loss).toBeGreaterThanOrEqual(20);
    expect(e.refutation).toContain('Nc6+');
  });

  it('every decision carries its facts, and the queen loss is a target event with the reply on record', () => {
    const g = games.get('900000002')!;
    expect(g.facts!.map((f) => f.ply)).toEqual(g.decisions.map((d) => d[0]));
    const fact = g.facts!.find((f) => f.ply === 7)!;
    expect(fact.played).toBeLessThanOrEqual(-2);
    expect(fact.best - fact.played).toBeGreaterThanOrEqual(2);
    expect(g.events.find((x) => x.ply === 7)).toMatchObject({ target: 'material' });
    // The mate that was played: nothing lost, and the best line is marked as a mate.
    const mate = games.get('900000001')!;
    expect(mate.facts!.find((f) => f.ply === 6)).toMatchObject({ mating: true });
    expect(mate.events.every((e) => !e.target)).toBe(true);
  });

  it('a missed mate with one clear answer becomes a drill; a missed win with several does not', () => {
    const mate = games.get('900000005')!.events.find((x) => x.ply === 6)!;
    expect(mate).toMatchObject({ bestSan: 'Qxf7#', opportunity: 'mate', missed: true, drill: true, errorLabel: 'loses-material' });
    const queen = games.get('900000003')!.events.find((x) => x.ply === 8)!;
    expect(queen).toMatchObject({ opportunity: 'material', missed: true, majorError: true, errorLabel: 'misses-material' });
  });

  it('taking a free piece is a chance; starting an even trade is not; no errors in a clean game', () => {
    const a = games.get('900000007')!;
    const byPly = new Map(a.events.map((e) => [e.ply, e]));
    expect(byPly.get(4)).toMatchObject({ opportunity: 'material', missed: false });
    expect(byPly.get(12)).toMatchObject({ opportunity: 'material', missed: false });
    expect(byPly.get(8)?.opportunity ?? null).toBeNull();
    expect(a.events.some((e) => e.majorError)).toBe(false);
  });

  it('can be stopped between moves without producing a partial analysis', async () => {
    const { game } = await convertChessComGame(archive.games[1], 'fixture_learner');
    let n = 0;
    expect(await analyseGame(game!, engine, { nodes: 5_000, keepGoing: () => ++n < 3 })).toBeNull();
  });
});

describe('cases from the outside reviewer: one engine line is not proof', () => {
  it('a promotion that can be taken at once, and a line with no moves at all, are not settled', () => {
    const fen = '1r5k/P7/2K5/8/8/8/8/8 w - - 0 1';
    expect(lineEnd(fen, ['a7a8q'], 'white').settled).toBe(false); // ...Rxa8 follows
    expect(lineEnd(fen, [], 'white').settled).toBe(false); // nothing was shown: missing evidence, not a quiet position
    expect(lineEnd(fen, ['a7a8q', 'b8a8', 'c6d6'], 'white').settled).toBe(false); // still shorter than the window
  });
  it('a line is settled only when it runs the full window and then goes quiet, or the game is over', () => {
    const fen = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
    expect(lineEnd(fen, ['b5c6', 'd7c6', 'd2d3', 'f8d6', 'e1h1', 'g8e7'], 'white')).toEqual({ balance: 0, settled: true });
    expect(lineEnd(fen, ['b5c6', 'd7c6', 'd2d3'], 'white').settled).toBe(false);
    expect(lineEnd('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['e1e8'], 'white').settled).toBe(true); // mate ends it
  });
  it('material given up at no cost to the score is not called an error, in a decided position either', () => {
    expect(targetKind({ ply: 40, wp: 99, played: -9, best: 0 }, 0)).toBeNull(); // a queen sacrifice that keeps a forced win
    expect(targetKind({ ply: 40, wp: 99, played: -9, best: 0 }, 6)).toBe('material'); // a piece hung in a won game still costs something
  });
  it('an engine that returns no line does not produce a clean-looking analysis', async () => {
    const { game } = await convertChessComGame(archive.games[1]!, 'fixture_learner');
    await expect(analyseGame(game!, { analyse: async () => [] })).rejects.toThrow(/no line/);
  });
});
