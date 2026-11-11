import { describe, expect, it } from 'vitest';
import { fenAfter, positionFromFen, sanOf } from '../chess/rules';
import fixture from './fixtures/my-games.fixture.json';
import { chanceItems, gradeChance, gradeSafety, pickSense, safetyItems, senseStats, type SenseItem, verifyReply } from './sense';
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
    // Another reply shown on the board to win material as well is accepted; one that does not is wrong.
    expect(gradeSafety(nf6, 'unsafe', 'e5f7', 'yes')).toMatchObject({ response: 'hit', correct: true, alternative: true });
    expect(gradeSafety(nf6, 'unsafe', 'e5f7', 'no')).toMatchObject({ response: 'wrong-reply', correct: false });
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
    expect(gradeChance(mate, 'something', 'h5e5', 'no')).toMatchObject({ response: 'wrong-reply', correct: false });
    expect(gradeChance(mate, 'something', 'h5e5', 'yes')).toMatchObject({ response: 'hit', alternative: true });
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
    const g = custom([{ wp: 50, played: 0, best: 0 }, { wp: 55, played: 0, best: 0 }, { wp: 80, played: 0, best: 3 }, { wp: 99, played: 0, best: 0, mating: true }], [0, 0, 0, 0]);
    const quiet = chanceItems([g]).filter((i) => !i.truth).map((i) => i.ply);
    expect(quiet).toEqual([plies[1]]);
  });

  it('games without a measurement record contribute nothing', () => {
    const bare = games.map((g) => ({ ...g, measure: null }));
    expect(safetyItems(bare)).toEqual([]);
    expect(chanceItems(bare)).toEqual([]);
  });
});

describe('cases from an independent review (2026-11-10)', () => {
  const plies = [4, 6, 8, 10, 12, 14];
  const gameWith = (facts: { ply: number; wp: number; played: number; best: number }[]): GameRecord => ({
    ...games[0]!, id: 'rv', color: 'white',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c2c3', 'd7d6', 'b1d2', 'a7a6', 'h2h3', 'h7h6', 'a2a4', 'a6a5'],
    measure: { decisions: facts.map((f) => [f.ply, 0, null]), events: [], facts }, measureKey: 'k',
  });

  // White was a queen and rook up and hung the rook on d1: 1...Rxd1+ wins it. The item exists
  // because a piece hung in a won position counts (ADR-032).
  const hung: SenseItem = {
    id: 'sense:safe-or-not:g:60', kind: 'safe-or-not', gameId: 'g', ply: 60, fen: '3r2k1/5ppp/8/8/8/8/5PPP/R3Q1K1 w - - 0 1', color: 'white', truth: true, date: '2026-11-01',
    proposed: 'a1d1', proposedSan: 'Rd1', afterFen: '3r2k1/5ppp/8/8/8/8/5PPP/3RQ1K1 b - - 0 1', replyUci: 'd8d1', replyLine: '1... Rxd1', playedWp: 96, loss: 3, label: 'loses-material',
  };

  it('another reply is judged by what it does on the board, not by a score that barely moves in a decided game', () => {
    // 1...h6 ignores the rook. White then takes on d8 and stays far ahead: not a punishing reply.
    const quiet = verifyReply(hung, 'h7h6', { wp: 99, pv: ['d1d8', 'g8h7', 'e1e4', 'g7g6', 'h2h3', 'h7g7'] });
    expect(quiet).toBe('no');
    expect(gradeSafety(hung, 'unsafe', 'h7h6', quiet)).toMatchObject({ response: 'wrong-reply', correct: false });
    // The stored reply itself needs no engine.
    expect(gradeSafety(hung, 'unsafe', 'd8d1')).toMatchObject({ response: 'hit', correct: true });
    // A different reply that also wins the rook is accepted.
    const alsoWins: SenseItem = { ...hung, afterFen: '3r2k1/5ppp/8/8/8/5b2/5PPP/3RQ1K1 b - - 0 1', fen: '3r2k1/5ppp/8/8/8/5b2/5PPP/R3Q1K1 w - - 0 1', replyUci: 'd8d1' };
    const bishop = verifyReply(alsoWins, 'f3d1', { wp: 30, pv: ['e1e8', 'd8e8', 'h2h3', 'e8e1', 'g1h2', 'g8f8'] });
    expect(bishop).toBe('yes');
    expect(gradeSafety(alsoWins, 'unsafe', 'f3d1', bishop)).toMatchObject({ response: 'hit', correct: true, alternative: true });
  });

  it('a line that stops in the middle of an exchange, or no engine answer, leaves the reply unscored', () => {
    expect(verifyReply(hung, 'h7h6', { wp: 99, pv: ['d1d8'] })).toBe('unresolved');
    expect(verifyReply(hung, 'h7h6', null)).toBe('unresolved');
    expect(gradeSafety(hung, 'unsafe', 'h7h6', 'unresolved')).toMatchObject({ response: 'unverified-reply', correct: false });
    expect(gradeSafety(hung, 'unsafe', 'h7h6')).toMatchObject({ response: 'unverified-reply', needsEngine: true });
  });

  it('a second mate in one counts without any engine; a quiet move that merely stays winning does not find the mate', () => {
    const twoMates: SenseItem = { id: 'sense:chance-or-not:g:40', kind: 'chance-or-not', gameId: 'g', ply: 40, fen: '6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', color: 'white', truth: true, date: '2026-11-01', best: 'a1a8', bestSan: 'Ra8#', bestLine: '1. Ra8#', bestWp: 100 };
    expect(verifyReply(twoMates, 'e1e8', null)).toBe('yes');
    expect(gradeChance(twoMates, 'something', 'e1e8', 'yes')).toMatchObject({ response: 'hit', alternative: true });
    const quiet = verifyReply(twoMates, 'h2h3', { wp: 1, pv: ['h7h6', 'a1a7', 'g8h7', 'e1e7', 'f7f6', 'a7b7'] });
    expect(quiet).toBe('no');
    expect(gradeChance(twoMates, 'something', 'h2h3', quiet)).toMatchObject({ response: 'wrong-reply' });
  });

  it('a position where a clean pawn can be won, or a move that gives up a pawn, is not offered as "nothing here" / "safe"', () => {
    expect(chanceItems([gameWith([{ ply: 12, wp: 62, played: 0, best: 1 }])]).find((i) => i.ply === 12)).toBeUndefined();
    expect(safetyItems([gameWith([{ ply: 12, wp: 55, played: -1, best: 0 }])]).find((i) => i.ply === 12)).toBeUndefined();
    expect(chanceItems([gameWith([{ ply: 12, wp: 62, played: 0, best: 0 }])]).find((i) => i.ply === 12)).toMatchObject({ truth: false });
  });

  it('when nothing with something in it is left, no question is asked rather than only "safe" ones', () => {
    const items = safetyItems([gameWith(plies.map((ply) => ({ ply, wp: 50, played: 0, best: 0 })))]);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.truth)).toBe(true);
    expect(pickSense(items, 'safe-or-not', new Set(), 2, 's')).toEqual([]);
  });
});

describe('how often a question has something in it', () => {
  it('about half the time for a caller that takes the first pick, however lopsided the pools', () => {
    const yes: SenseItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `sense:chance-or-not:g:${i}`, kind: 'chance-or-not', gameId: 'g', ply: i, fen: '', color: 'white', truth: true, date: '' }));
    const no: SenseItem[] = Array.from({ length: 900 }, (_, i) => ({ id: `sense:chance-or-not:h:${i}`, kind: 'chance-or-not', gameId: 'h', ply: i, fen: '', color: 'white', truth: false, date: '' }));
    let withSomething = 0;
    for (let turn = 0; turn < 200; turn++) if (pickSense([...yes, ...no], 'chance-or-not', new Set(), 2, `session|${turn}`)[0]!.truth) withSomething++;
    expect(withSomething).toBeGreaterThan(70);
    expect(withSomething).toBeLessThan(130);
    const four = pickSense([...yes, ...no], 'chance-or-not', new Set(), 4, 's');
    expect(four.filter((i) => i.truth)).toHaveLength(2);
  });
});

describe('cases from the outside reviewer (third pass)', () => {
  it('the coin toss is not tied to the turn number: both kinds get real questions on their own turns', () => {
    const mk = (kind: 'safe-or-not' | 'chance-or-not', truth: boolean, i: number): SenseItem => ({ id: `sense:${kind}:${truth ? 'g' : 'h'}:${i}`, kind, gameId: 'g', ply: i, fen: '', color: 'white', truth, date: '' });
    const items = [
      ...Array.from({ length: 30 }, (_, i) => mk('safe-or-not', true, i)), ...Array.from({ length: 300 }, (_, i) => mk('safe-or-not', false, i)),
      ...Array.from({ length: 30 }, (_, i) => mk('chance-or-not', true, i)), ...Array.from({ length: 300 }, (_, i) => mk('chance-or-not', false, i)),
    ];
    // The practice screen asks "safe?" on even turns and "something?" on odd turns, seeded by the turn number.
    let safeReal = 0;
    let chanceReal = 0;
    for (let n = 0; n < 200; n++) {
      const kind = n % 2 === 0 ? 'safe-or-not' : 'chance-or-not';
      if (pickSense(items, kind, new Set(), 2, `sense|${n}`)[0]!.truth) kind === 'safe-or-not' ? safeReal++ : chanceReal++;
    }
    expect(safeReal).toBeGreaterThan(30);
    expect(safeReal).toBeLessThan(70);
    expect(chanceReal).toBeGreaterThan(30);
    expect(chanceReal).toBeLessThan(70);
    // And the very first turns are not all of one sort.
    const firstTen = Array.from({ length: 10 }, (_, n) => pickSense(items, n % 2 === 0 ? 'safe-or-not' : 'chance-or-not', new Set(), 2, `sense|${n}`)[0]!);
    expect(new Set(firstTen.filter((i) => i.kind === 'safe-or-not').map((i) => i.truth)).size).toBe(2);
  });

  it('a move that wins material but walks into mate is not a chance taken', () => {
    // White can take a knight with Rxb7, but then ...Rd1 is mate. (Some other move is the stored chance.)
    const item: SenseItem = { id: 'sense:chance-or-not:g:30', kind: 'chance-or-not', gameId: 'g', ply: 30, fen: '3r2k1/1n3ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1', color: 'white', truth: true, date: '', best: 'h2h3', bestSan: 'h3', bestLine: '1. h3', bestWp: 70 };
    expect(verifyReply(item, 'b1b7', { wp: 100, pv: ['d8d1'] })).toBe('no');
    // The mirror case for "is it safe?": a reply after which the owner (to move) has a forced mate does not punish anything.
    const hung: SenseItem = { id: 'sense:safe-or-not:g:60', kind: 'safe-or-not', gameId: 'g', ply: 60, fen: '3r2k1/5ppp/8/8/8/8/5PPP/R3Q1K1 w - - 0 1', color: 'white', truth: true, date: '', proposed: 'a1d1', proposedSan: 'Rd1', afterFen: '3r2k1/5ppp/8/8/8/8/5PPP/3RQ1K1 b - - 0 1', replyUci: 'd8d1' };
    expect(verifyReply(hung, 'g8h8', { wp: 100, pv: ['d1d8'] })).toBe('no');
  });
});


describe('cases from the outside reviewer: grading and item supply', () => {
  it('taking a rook while allowing mate in one is not a chance taken (reproduced by the reviewer with the real engine)', () => {
    const item: SenseItem = { id: 'sense:chance-or-not:g:50', kind: 'chance-or-not', gameId: 'g', ply: 50, fen: 'r3r3/1Q3ppk/7p/8/8/8/5PPP/6K1 w - - 0 1', color: 'white', truth: true, date: '', best: 'b7f7', bestSan: 'Qxf7', bestLine: '1. Qxf7', bestWp: 60 };
    expect(verifyReply(item, 'b7a8', { wp: 100, mate: 1, pv: ['e8e1'] })).toBe('no');
    // The typed mate score decides, not a rounded percentage.
    expect(verifyReply(item, 'b7a8', { wp: 99.6, mate: 3, pv: ['e8e1'] })).toBe('no');
  });
  it('a material chance whose supporting line is unsettled, or with no second move to compare, is not asked', () => {
    const base = games.find((g) => g.measure && g.measure.events.some((e) => e.opportunity === 'material'))!;
    const ev = base.measure!.events.find((e) => e.opportunity === 'material')!;
    const withFact = (over: object, evOver: object = {}): GameRecord => ({ ...base, id: 'x', measure: { ...base.measure!, events: base.measure!.events.map((e) => (e === ev ? { ...e, secondWp: e.bestWp - 30, ...evOver } : e)), facts: base.measure!.facts!.map((f) => (f.ply === ev.ply ? { ...f, ...over } : f)) } });
    expect(chanceItems([withFact({})]).some((i) => i.ply === ev.ply && i.truth)).toBe(true);
    expect(chanceItems([withFact({ unsure: true })]).some((i) => i.ply === ev.ply)).toBe(false);
    expect(chanceItems([withFact({}, { secondWp: null })]).some((i) => i.ply === ev.ply)).toBe(false);
  });
  it('a learner who says "something" on a control and proves it with a winning move is not given a false alarm', () => {
    const control: SenseItem = { id: 'sense:chance-or-not:g:20', kind: 'chance-or-not', gameId: 'g', ply: 20, fen: '6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', color: 'white', truth: false, date: '' };
    expect(gradeChance(control, 'nothing', null)).toMatchObject({ response: 'correct-rejection', correct: true });
    expect(gradeChance(control, 'something', 'a1a8', 'yes')).toMatchObject({ response: 'label-disputed', correct: false });
    expect(gradeChance(control, 'something', 'h2h3', 'no')).toMatchObject({ response: 'false-alarm', correct: false });
    expect(gradeChance(control, 'something', 'h2h3', 'unresolved')).toMatchObject({ response: 'unverified-reply', correct: false });
    expect(gradeChance(control, 'something', 'h2h3')).toMatchObject({ needsEngine: true });
  });
  it('with no controls left, positives are not served on their own either', () => {
    const yes: SenseItem[] = Array.from({ length: 5 }, (_, i) => ({ id: `sense:safe-or-not:g:${i}`, kind: 'safe-or-not', gameId: 'g', ply: i, fen: '', color: 'white', truth: true, date: '' }));
    expect(pickSense(yes, 'safe-or-not', new Set(), 2, 's')).toEqual([]);
  });
});
