import { describe, expect, it } from 'vitest';
import { fenAfter, positionFromFen, sanOf } from '../chess/rules';
import fixture from './fixtures/my-games.fixture.json';
import { chanceItems, gradeChance, gradeSafety, pickSense, safetyItems, senseStats, type SenseItem } from './sense';
import { withMeasure } from './fixtures/measure';
import type { GameRecord } from './types';
import type { Attempt } from '../db/types';

const games = (fixture.games.map((g) => ({ ...g, importedAt: 1, updatedAt: 1, analysisKey: 'k', majorLoss: 20 })) as unknown as GameRecord[]).map((g) => withMeasure(g));
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('"is this move safe?" items from own games', () => {
  const items = safetyItems(games);
  const unsafe = items.filter((i) => i.truth);
  const safe = items.filter((i) => !i.truth);

  it('an own move that lost material in a short line is an unsafe item carrying the engine reply', () => {
    const nf6 = unsafe.find((i) => i.proposedSan === 'Nf6')!;
    expect(nf6).toBeDefined();
    expect(nf6.color).toBe('black');
    expect(nf6.replyUci).toBe('e5c6'); // 5.Nc6+ wins the queen
    expect(nf6.fen).toBe(fenAfter(START, ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3e5', 'f6e4', 'd1e2']));
    expect(nf6.afterFen).toBe(fenAfter(nf6.fen, [nf6.proposed!]));
    expect(sanOf(positionFromFen(nf6.afterFen!), nf6.replyUci!)).toBe('Nc6+');
    expect(unsafe.map((i) => i.proposedSan).sort()).toEqual(['Nf6', 'Qxe5+']);
  });

  it('own moves the engine had no complaint about are the safe items, and errors of other kinds are left out', () => {
    expect(safe.length).toBeGreaterThanOrEqual(8);
    expect(safe.every((i) => i.loss !== undefined && i.loss <= 3)).toBe(true);
    expect(items.some((i) => i.proposedSan === 'd4' && i.truth)).toBe(false); // 5.d4 missed a win but lost nothing
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('grades the four outcomes, and a different punishing reply needs engine confirmation', () => {
    const nf6 = unsafe.find((i) => i.proposedSan === 'Nf6')!;
    expect(gradeSafety(nf6, 'safe', null)).toMatchObject({ response: 'miss', correct: false });
    expect(gradeSafety(nf6, 'unsafe', 'e5c6')).toMatchObject({ response: 'hit', correct: true });
    expect(gradeSafety(nf6, 'unsafe', 'e5f7')).toMatchObject({ response: 'unverified-reply', correct: false, needsEngine: true });
    // The engine says the other reply is worth as much to the opponent: accepted.
    expect(gradeSafety(nf6, 'unsafe', 'e5f7', 100 - nf6.playedWp! - 4)).toMatchObject({ response: 'hit', correct: true, alternative: true });
    expect(gradeSafety(nf6, 'unsafe', 'e5f7', 100 - nf6.playedWp! - 30)).toMatchObject({ response: 'wrong-reply', correct: false });
    expect(gradeSafety(safe[0]!, 'safe', null)).toMatchObject({ response: 'correct-rejection', correct: true });
    expect(gradeSafety(safe[0]!, 'unsafe', null)).toMatchObject({ response: 'false-alarm', correct: false });
  });
});

describe('"is there something to win?" items from own games', () => {
  const items = chanceItems(games);
  it('positions where the best line clearly wins are chances; everything else is "nothing special"', () => {
    const chances = items.filter((i) => i.truth);
    expect(chances.map((i) => i.bestSan).sort()).toEqual(['Nxh4', 'Qxf7#', 'Qxf7#']);
    // Two more positions had a win available, but several moves won about as much: they are
    // not asked as chances and, just as importantly, not passed off as "nothing special".
    const unclear = games.flatMap((g) => g.measure!.events.filter((e) => e.opportunity && !chances.some((c) => c.gameId === g.id && c.ply === e.ply)).map((e) => `${g.id}:${e.ply}`));
    expect(unclear).toHaveLength(2);
    for (const key of unclear) expect(items.some((i) => `${i.gameId}:${i.ply}` === key)).toBe(false);
    expect(items.filter((i) => !i.truth).length).toBeGreaterThanOrEqual(10);
    expect(items.filter((i) => !i.truth).every((i) => i.ply >= 2)).toBe(true); // the very first moves are not asked
  });

  it('grades hits, misses, false alarms and verified alternatives', () => {
    const mate = items.find((i) => i.bestSan === 'Qxf7#')!;
    const quiet = items.find((i) => !i.truth)!;
    expect(gradeChance(mate, 'nothing', null)).toMatchObject({ response: 'miss', correct: false });
    expect(gradeChance(mate, 'something', mate.best!)).toMatchObject({ response: 'hit', correct: true });
    expect(gradeChance(mate, 'something', 'h5e5')).toMatchObject({ response: 'unverified-reply', needsEngine: true });
    expect(gradeChance(mate, 'something', 'h5e5', 30)).toMatchObject({ response: 'wrong-reply', correct: false });
    expect(gradeChance(mate, 'something', 'h5e5', mate.bestWp! - 5)).toMatchObject({ response: 'hit', alternative: true });
    expect(gradeChance(quiet, 'nothing', null)).toMatchObject({ response: 'correct-rejection', correct: true });
    expect(gradeChance(quiet, 'something', null)).toMatchObject({ response: 'false-alarm', correct: false });
  });
});

describe('choosing and scoring', () => {
  const all: SenseItem[] = [...safetyItems(games), ...chanceItems(games)];
  it('picks unseen items, half with something to find and half without, deterministically', () => {
    const a = pickSense(all, 'safe-or-not', new Set(), 4, 's1');
    expect(a).toHaveLength(4);
    expect(a.filter((i) => i.truth)).toHaveLength(2);
    expect(pickSense(all, 'safe-or-not', new Set(), 4, 's1').map((i) => i.id)).toEqual(a.map((i) => i.id));
    const seen = new Set(a.map((i) => i.id));
    expect(pickSense(all, 'safe-or-not', seen, 4, 's1').some((i) => seen.has(i.id))).toBe(false);
    expect(pickSense(all, 'chance-or-not', new Set(), 2, 's1').every((i) => i.kind === 'chance-or-not')).toBe(true);
  });

  it('reports detection and false-alarm rates separately, first time seen only', () => {
    const att = (themes: string[], outcome: Attempt['outcome'], fresh = true) => ({ exerciseKind: 'sense', themes, outcome, fresh, ts: 1 }) as unknown as Attempt;
    const s = senseStats([
      att(['safe-or-not', 'unsafe', 'hit'], 'success'),
      att(['safe-or-not', 'unsafe', 'miss'], 'fail'),
      att(['safe-or-not', 'unsafe', 'wrong-reply'], 'fail'),
      att(['safe-or-not', 'safe', 'correct-rejection'], 'success'),
      att(['safe-or-not', 'safe', 'false-alarm'], 'fail'),
      att(['safe-or-not', 'unsafe', 'hit'], 'success', false), // a repeat: not counted
      att(['chance-or-not', 'chance', 'hit'], 'success'),
    ]);
    expect(s['safe-or-not'].detected).toMatchObject({ n: 3, successes: 1 });
    expect(s['safe-or-not'].noticed).toMatchObject({ n: 3, successes: 2 }); // said "unsafe" in 2 of 3, found the reply in 1
    expect(s['safe-or-not'].quiet).toMatchObject({ n: 2, successes: 1 });
    expect(s['chance-or-not'].detected).toMatchObject({ n: 1, successes: 1 });
    expect(s['chance-or-not'].quiet.n).toBe(0);
  });
});

describe('positives and controls are defined by the same test', () => {
  const base = games.find((g) => g.measure && g.measure.decisions.length >= 4)!;
  const plies = base.measure!.decisions.map((d) => d[0]);
  const custom = (facts: { wp: number; played: number; best: number; mated?: true; mating?: true }[], losses: number[]): GameRecord => ({
    ...base,
    id: 'custom',
    measure: {
      decisions: plies.slice(0, facts.length).map((ply, i) => [ply, losses[i]!, null]),
      events: [],
      facts: facts.map((f, i) => ({ ply: plies[i]!, ...f })),
    },
  });

  it('a piece hung in a position that was already lost is never offered as a "safe" move, although it barely moved the score', () => {
    const g = custom([{ wp: 50, played: 0, best: 0 }, { wp: 50, played: 0, best: 0 }, { wp: 4, played: -5, best: 0 }, { wp: 96, played: 0, best: 0 }], [0, 1, 2, 0]);
    const safe = safetyItems([g]).filter((i) => !i.truth).map((i) => i.ply);
    expect(safe).toContain(plies[1]);
    expect(safe).not.toContain(plies[2]); // loses a piece: fails the "safe" test whatever the score says
    expect(safe).not.toContain(plies[3]); // already won: "safe" would mean nothing here
  });

  it('a forced loss, a quick mate allowed, or a costly move that loses no material is not asked at all', () => {
    const g = custom([{ wp: 50, played: 0, best: 0 }, { wp: 40, played: -3, best: -3 }, { wp: 50, played: 0, best: 0, mated: true }, { wp: 60, played: 0, best: 0 }], [0, 1, 1, 25]);
    expect(safetyItems([g]).map((i) => i.ply)).toEqual([]); // the first move is skipped as an opening move
  });

  it('two different captures that both win a piece are a chance to the learner, so the position is never a "nothing special" control', () => {
    const g = custom([{ wp: 50, played: 0, best: 0 }, { wp: 55, played: 0, best: 1 }, { wp: 80, played: 0, best: 3 }, { wp: 99, played: 0, best: 0, mating: true }], [0, 0, 0, 0]);
    const quiet = chanceItems([g]).filter((i) => !i.truth).map((i) => i.ply);
    expect(quiet).toEqual([plies[1]]);
  });

  it('games without a measurement record contribute nothing', () => {
    const bare = games.map((g) => ({ ...g, measure: null }));
    expect(safetyItems(bare)).toEqual([]);
    expect(chanceItems(bare)).toEqual([]);
  });
});

