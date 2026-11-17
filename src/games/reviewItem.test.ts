import { describe, expect, it } from 'vitest';
import { applyUci, fenOf, positionFromFen } from '../chess/rules';
import { moveItemById, moveItems } from './ownmove';
import { ownGameReview } from './reviewItem';
import type { GameRecord } from './types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Knights out and back: every position is legal, and the game is as long as is wanted.
const CYCLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
const moves = (n: number) => Array.from({ length: n }, (_, i) => CYCLE[i % 4]!);
const fenAt = (ply: number) => fenOf(moves(ply).reduce((pos, u) => applyUci(pos, u), positionFromFen(START)));

/** A measured game: one fact per move of the learner's, all undecided. */
function game(id: string, color: 'white' | 'black', over: Partial<GameRecord> = {}): GameRecord {
  const m = moves(60);
  const mine = m.map((_, ply) => ply).filter((ply) => (ply % 2 === 0) === (color === 'white'));
  return {
    id, source: 'chess.com', url: null, date: '2026-11-01', endDate: '2026-11-01', endTime: null, timeControl: '600', timeClass: 'rapid', color, result: 'win',
    termination: null, playerRating: 1, opponentRating: 1, opponent: 'x', moves: m, clocks: null, analysis: null, importedAt: 0, updatedAt: 0, analysisKey: null,
    measure: { decisions: mine.map((ply) => [ply, 0]), events: [], facts: mine.map((ply) => ({ ply, wp: 50, played: 0, best: 0 })) },
    measureKey: 'k',
    ...over,
  } as unknown as GameRecord;
}

describe('a "Your move" position that was asked can be asked again (owner report, 2026-11-17)', () => {
  // The owner: "it keeps saying 'This review position is no longer in the installed content
  // pack...' ... Why does it happen everyday?" On his backup of 17 November, 11 of 50 due items
  // were "Your move" positions missed in the daily session. The session asks from moves 10 to
  // 19; review looked each one up in a list built from move 1, which takes every fourth move
  // of his from the start of the game and so lands on other positions: of 147 positions that
  // can be asked, 23 could be found again. One that cannot be shown is never answered, so it
  // stays due, and the card came back every day.
  const games = [game('w', 'white'), game('b', 'black')];
  const asked = moveItems(games);

  it('the positions the session asks from are not the ones a list from move 1 holds: the cause', () => {
    expect(asked.map((m) => m.id)).toEqual(['move:w:18', 'move:w:26', 'move:w:34', 'move:b:19', 'move:b:27', 'move:b:35']);
    const fromTheStart = new Set(moveItems(games, { fromMove: 1, toMove: 200 }).map((m) => m.id));
    expect(asked.filter((m) => fromTheStart.has(m.id))).toEqual([]);
  });

  it('every position that can be asked is found again by its id, exactly as it was asked', () => {
    expect(asked.length).toBeGreaterThan(0);
    for (const m of asked) expect(moveItemById(games, m.id)).toEqual(m);
  });

  it('is built from the game itself: the position before the move, his colour, the move he played', () => {
    expect(moveItemById(games, 'move:w:26')).toEqual({ id: 'move:w:26', gameId: 'w', ply: 26, fen: fenAt(26), color: 'white', date: '2026-11-01', played: 'f3g1', bestWp: 50 });
    expect(moveItemById(games, 'move:b:19')).toMatchObject({ fen: fenAt(19), color: 'black', played: 'f6g8' });
  });

  it('does not need the game to be measured at that move: a game being analysed again is still his game', () => {
    const bare = [game('w', 'white', { measure: null })];
    expect(moveItemById(bare, 'move:w:26')).toMatchObject({ id: 'move:w:26', fen: fenAt(26), played: 'f3g1', bestWp: null });
  });

  it('finds nothing where there is nothing: no such game, no such move, the opponent’s move, another kind of id', () => {
    expect(moveItemById(games, 'move:gone:26')).toBeNull();
    expect(moveItemById(games, 'move:w:60')).toBeNull();
    expect(moveItemById(games, 'move:w:27')).toBeNull(); // Black's move in a game he played as White
    expect(moveItemById(games, 'move:b:26')).toBeNull();
    expect(moveItemById(games, 'lichess:abcde')).toBeNull();
    expect(moveItemById(games, 'move:w:x')).toBeNull();
  });
});

describe('what a due position from his own games is asked as', () => {
  const games = [game('w', 'white')];

  it('"Your move" as "Your move"', () => {
    expect(ownGameReview(games, 'move:w:26')).toMatchObject({ kind: 'move', item: { id: 'move:w:26' } });
  });

  it('a question the games still supply is asked as it was', () => {
    // Every move of this game is a control for "is this move safe?": nothing lost, undecided.
    expect(ownGameReview(games, 'sense:safe-or-not:w:26')).toMatchObject({ kind: 'sense', item: { id: 'sense:safe-or-not:w:26', truth: false } });
  });

  it('a question the games no longer supply is asked as "Your move" on the same position, not announced as gone', () => {
    // On his backup: "is O-O safe?" at move 21 of a game of 27 July, asked on 12 November
    // before unsafe moves had to cost ten points (ADR-052); the question was withdrawn by that
    // rule, the position is still his.
    const noLongerAQuestion = [game('w', 'white', { measure: { decisions: [], events: [], facts: [] } as never })];
    expect(ownGameReview(noLongerAQuestion, 'sense:safe-or-not:w:26')).toMatchObject({ kind: 'move', item: { id: 'move:w:26', fen: fenAt(26) } });
    expect(ownGameReview(noLongerAQuestion, 'sense:chance-or-not:w:26')).toMatchObject({ kind: 'move', item: { id: 'move:w:26' } });
    // A missed move that is no longer a drill after the game was analysed again.
    expect(ownGameReview(games, 'game:w:26')).toMatchObject({ kind: 'move', item: { id: 'move:w:26' } });
  });

  it('only a game that is not on the device leaves nothing to ask', () => {
    expect(ownGameReview(games, 'move:gone:26')).toBeNull();
    expect(ownGameReview(games, 'sense:safe-or-not:gone:26')).toBeNull();
    expect(ownGameReview(games, 'game:gone:26')).toBeNull();
    expect(ownGameReview(games, 'lichess:abcde')).toBeNull();
  });
});
