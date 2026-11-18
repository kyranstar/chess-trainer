import { describe, expect, it } from 'vitest';
import type { Attempt } from '../db/types';
import type { GameEvent, GameRecord } from '../games/types';
import { activityDays, byClock, byColour, byPhase, byType, chanceList, earlyRate, errorRatio, markBlocks, momentsOf, nextAction, ownMoveMarks, puzzleMarks, rapidRows, rollingErrors, senseMarks, timelineOf, trainingIndex, trainingStartOf } from './series';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function ev(ply: number, over: Partial<GameEvent> = {}): GameEvent {
  return {
    ply, fen: FEN, played: 'e2e4', playedSan: 'e4', best: 'd2d4', bestSan: 'd4', bestLine: 'd4', bestWp: 50, secondWp: null, playedWp: 50, loss: 0, clock: null,
    opportunity: null, missed: false, majorError: false, errorLabel: null, refutation: null, drill: false, target: null, ...over,
  };
}
/** A rated rapid game: `errs` are the plies of major errors, `plies` the learner's decisions. */
function game(i: number, over: Partial<GameRecord> & { errs?: [number, number?, GameEvent['errorLabel']?][]; plies?: number[]; target?: number; extra?: GameEvent[] } = {}): GameRecord {
  const plies = over.plies ?? Array.from({ length: 20 }, (_, k) => 2 * k);
  const errs = (over.errs ?? []).map(([ply, loss, label]) => ev(ply, { majorError: true, loss: loss ?? 25, errorLabel: label ?? 'loses-material' }));
  const target = over.target !== undefined ? [ev(over.target, { target: 'material', loss: 30, majorError: true, errorLabel: 'loses-material' })] : [];
  const events = [...errs, ...target, ...(over.extra ?? [])];
  const analysis = { decisions: plies.map((p) => [p, errs.some((e) => e.ply === p) ? 25 : 0, null] as [number, number, number | null]), events, facts: plies.map((p) => ({ ply: p, wp: 50, played: 0, best: 0 })) };
  return {
    id: `g${i}`, source: 'chess.com', url: null, date: `2026-03-${String(i).padStart(2, '0')}`, endDate: over.endDate ?? `2026-03-${String(i).padStart(2, '0')}`, endTime: null, timeControl: '600', timeClass: 'rapid',
    color: i % 2 ? 'white' : 'black', result: 'win', termination: null, playerRating: 400 + i, opponentRating: 400, opponent: 'x', moves: ['e2e4'], clocks: null, rated: true,
    analysis, importedAt: 0, updatedAt: 0, analysisKey: 'a', measure: analysis, measureKey: 'm', ...over,
  } as GameRecord;
}
let k = 0;
function att(over: Partial<Attempt>): Attempt {
  k++;
  return {
    uuid: `u${k}`, deviceId: 'd', sessionId: null, context: 'practice', exerciseId: `lichess:${k}`, exerciseKind: 'puzzle', contentVersion: 'p@1', conceptId: null, themes: ['fork'], rating: 1000,
    ts: Date.UTC(2026, 10, 10, 12) + k * 1000, tzOffsetMin: 0, elapsedMs: 1000, firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false,
    fresh: true, scheduledReview: false, daysSinceLast: null, schedulerVersion: 's', ...over,
  };
}

describe('rated rapid rows', () => {
  it('keeps rated rapid games with moves, oldest first, numbered, with the rating change', () => {
    const games = [game(3), game(1), game(2, { rated: false }), game(4, { timeClass: 'blitz' }), game(5, { moves: [] })];
    const rows = rapidRows(games);
    expect(rows.map((r) => r.game.id)).toEqual(['g1', 'g3']);
    expect(rows.map((r) => r.index)).toEqual([1, 2]);
    expect(rows[0]!.ratingChange).toBeNull();
    expect(rows[1]!.ratingChange).toBe(2);
  });
  it('counts major errors and decisions from the analysis and the early blunder from the measurement', () => {
    const [r] = rapidRows([game(1, { errs: [[4], [30]], target: 10 })]);
    expect(r!.errors).toBe(3);
    expect(r!.decisions).toBe(20);
    expect(r!.early).toMatchObject({ measured: true, event: { ply: 10 } });
  });
  it('a target past the 20th move is not an early blunder', () => {
    const [r] = rapidRows([game(1, { target: 40 })]);
    expect(r!.early.event).toBeNull();
    expect(earlyRate([r!])).toMatchObject({ k: 0, n: 1 });
  });
});

describe('training start', () => {
  it('is the local day of the first attempt and marks the first game on or after it', () => {
    const start = trainingStartOf([att({ ts: new Date(2026, 2, 3, 9).getTime() }), att({ ts: new Date(2026, 2, 5, 9).getTime() })]);
    expect(start).toBe('2026-03-03');
    const rows = rapidRows([game(1), game(2), game(3), game(4)]);
    expect(trainingIndex(rows, start)).toBe(3);
    expect(trainingIndex(rows, null)).toBeNull();
    expect(trainingIndex(rows, '2027-01-01')).toBeNull();
  });
});

describe('big mistakes over time', () => {
  it('pools the window and gives one point per game from the 20th on', () => {
    const games = Array.from({ length: 25 }, (_, i) => game(i + 1, { errs: i % 5 === 0 ? [[2]] : [] }));
    const rows = rapidRows(games);
    const pts = rollingErrors(rows, 20);
    expect(pts).toHaveLength(6);
    expect(pts[0]!.index).toBe(20);
    expect(pts[0]!.rate).toBeCloseTo(4 / 400, 9);
    expect(pts.at(-1)!.rate).toBeCloseTo(4 / 400, 9);
    expect(errorRatio(rows)!.decisions).toBe(500);
  });
  it('skips games not yet analysed', () => {
    const rows = rapidRows([game(1, { analysis: null }), game(2, { errs: [[0]] })]);
    expect(errorRatio(rows)).toMatchObject({ games: 1, events: 1, decisions: 20 });
  });
});

describe('how you play', () => {
  it('splits decisions and errors by move number', () => {
    const rows = rapidRows([game(1, { errs: [[2], [20], [22]], plies: [0, 2, 20, 22, 40, 60] })]);
    const p = byPhase(rows);
    expect(p.map((x) => x.ratio?.decisions ?? 0)).toEqual([2, 2, 1, 1]);
    expect(p.map((x) => x.ratio?.events ?? 0)).toEqual([1, 2, 0, 0]);
    expect(p[1]!.events.map((e) => e.event.ply)).toEqual([20, 22]);
  });
  it('counts labels and the games they came in, most frequent first', () => {
    const rows = rapidRows([game(1, { errs: [[2, 25, 'allows-mate'], [4, 25, 'loses-material']] }), game(2, { errs: [[6, 25, 'loses-material']] })]);
    const t = byType(rows);
    expect(t[0]).toMatchObject({ label: 'loses-material', count: 2, games: 2 });
    expect(t[1]).toMatchObject({ label: 'allows-mate', count: 1, games: 1 });
    expect(t.reduce((s, x) => s + x.count, 0)).toBe(3);
  });
  it('splits by colour', () => {
    const c = byColour(rapidRows([game(1, { errs: [[2]] }), game(2), game(3, { target: 4 })]));
    expect(c.white.games).toBe(2);
    expect(c.black.games).toBe(1);
    expect(c.white.early).toMatchObject({ k: 1, n: 2 });
    expect(c.black.ratio!.events).toBe(0);
  });
  it('uses the clock rule of the older card', () => {
    const g = game(1, { clocks: [590, 580], plies: [0, 2] });
    expect(byClock(rapidRows([g])).normal.decisions + byClock(rapidRows([g])).low.decisions).toBeLessThanOrEqual(2);
  });
});

describe('a game\'s moments', () => {
  it('orders early blunder, biggest mistake, missed chance, and never repeats a position', () => {
    const missed = ev(16, { opportunity: 'material', bestWp: 80, secondWp: 40, played: 'a2a3', best: 'b2b4', missed: true });
    const g = game(1, { target: 6, errs: [[6, 30], [12, 60]], extra: [missed] });
    const m = momentsOf(rapidRows([g])[0]!);
    expect(m.map((x) => [x.kind, x.ply, x.move])).toEqual([['early', 6, 4], ['biggest', 12, 7], ['chance', 16, 9]]);
  });
  it('names a major error made with under a tenth of the base time left', () => {
    const g = game(1, { errs: [[4]], plies: [0, 2, 4], clocks: [500, null, 50, null, 40], timeControl: '600' });
    g.analysis!.decisions = [[0, 0, 500], [2, 0, 50], [4, 25, 40]];
    const m = momentsOf(rapidRows([g])[0]!);
    expect(m.find((x) => x.kind === 'biggest')!.ply).toBe(4);
    expect(m.find((x) => x.kind === 'clock')).toBeUndefined();
    const g2 = game(2, { errs: [[4], [2]], plies: [0, 2, 4], clocks: [500], timeControl: '600' });
    g2.analysis!.decisions = [[0, 0, 500], [2, 25, 50], [4, 25, 40]];
    g2.analysis!.events = [ev(2, { majorError: true, loss: 40 }), ev(4, { majorError: true, loss: 25 })];
    expect(momentsOf(rapidRows([g2])[0]!).map((x) => x.kind)).toEqual(['biggest', 'clock']);
  });
  it('a game with nothing has no moments, and the next action falls back', () => {
    const rows = rapidRows([game(1)]);
    expect(momentsOf(rows[0]!)).toEqual([]);
    expect(nextAction(rows, 3)).toEqual({ kind: 'due', count: 3 });
    expect(nextAction(rows, 0)).toEqual({ kind: 'none' });
  });
  it('the next action is the latest analysed game\'s first moment', () => {
    const rows = rapidRows([game(1, { target: 4 }), game(2, { errs: [[8]] }), game(3, { analysis: null, measure: null })]);
    const a = nextAction(rows, 5);
    expect(a.kind).toBe('review');
    if (a.kind === 'review') expect([a.row.game.id, a.moment.kind, a.moment.ply]).toEqual(['g2', 'biggest', 8]);
  });
  it('the timeline is the expected score before each of your moves', () => {
    expect(timelineOf(game(1, { plies: [0, 2] }))).toEqual([{ ply: 0, move: 1, wp: 50 }, { ply: 2, move: 2, wp: 50 }]);
  });
  it('lists clear chances in game order', () => {
    const c = ev(10, { opportunity: 'mate', bestWp: 99, secondWp: 50, played: 'd2d4', best: 'd2d4' });
    const rows = rapidRows([game(1, { extra: [c] }), game(2)]);
    expect(chanceList(rows).map((x) => [x.row.game.id, x.chance.taken])).toEqual([['g1', true]]);
  });
});

describe('first-look marks', () => {
  it('puzzles: first-ever showings only, in order', () => {
    const xs = [att({ outcome: 'fail' }), att({ fresh: false }), att({ outcome: 'skipped' }), att({ exerciseKind: 'lesson-try' }), att({})];
    expect(puzzleMarks(xs).map((m) => m.ok)).toEqual([false, true]);
  });
  it('"Your move": sound is best, good or an inaccuracy; unrated answers are counted apart', () => {
    const om = (g: string, over: Partial<Attempt> = {}) => att({ exerciseKind: 'own-move', themes: ['own-move', g], ...over });
    const r = ownMoveMarks([om('best'), om('inaccuracy'), om('mistake'), om('unresolved'), om('clean'), om('blunder', { context: 'review' }), om('good', { themes: ['own-move', 'good', 'left'] })]);
    expect(r.marks.map((m) => m.ok)).toEqual([true, true, false, true]);
    expect(r.unrated).toBe(1);
  });
  it('questions from games: spotted among positions with something there, false alarms among those without', () => {
    const s = (truth: string, res: string, kind = 'safe-or-not') => att({ exerciseKind: 'sense', themes: [kind, truth, res] });
    const r = senseMarks([s('unsafe', 'hit'), s('unsafe', 'miss'), s('unsafe', 'noticed'), s('safe', 'correct-rejection'), s('safe', 'false-alarm'), s('chance', 'hit', 'chance-or-not')], 'safe-or-not');
    expect(r.spotted.map((m) => m.ok)).toEqual([true, false, true]);
    expect(r.alarms.map((m) => m.ok)).toEqual([false, true]);
  });
  it('blocks of 20 with their ranges and the rest pending', () => {
    const marks = Array.from({ length: 45 }, (_, i) => ({ ok: i % 2 === 0, ts: i, uuid: `m${i}` }));
    const b = markBlocks(marks, 20);
    expect(b.blocks.map((x) => [x.k, x.n])).toEqual([[10, 20], [10, 20]]);
    expect(b.blocks[0]!.lo).toBeGreaterThan(0.25);
    expect(b.pending).toHaveLength(5);
  });
});

describe('activity by day', () => {
  it('counts first looks and the rest per local day; days before the first attempt are not tracked', () => {
    const day = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();
    const xs = [att({ ts: day(10) }), att({ ts: day(10), fresh: false }), att({ ts: day(12) }), att({ ts: day(12), outcome: 'skipped' })];
    const days = activityDays(xs, day(13, 20), 5);
    expect(days.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(days.map((d) => d.tracked)).toEqual([false, true, true, true, true]);
    expect(days[1]).toMatchObject({ firstLooks: 1, other: 1 });
    expect(days[3]).toMatchObject({ firstLooks: 1, other: 0 });
    expect(days[2]).toMatchObject({ firstLooks: 0, other: 0, tracked: true });
  });
});
