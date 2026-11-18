import { describe, expect, it } from 'vitest';
import { movesToAsk, owedMoves } from './position';

const item = (gameId: string, ply: number) => ({ id: `move:${gameId}:${ply}`, gameId, ply });
const left = (id: string) => ({ exerciseId: id, exerciseKind: 'own-move' as const, themes: ['own-move', 'left'] });
const answered = (id: string, grade = 'good') => ({ exerciseId: id, exerciseKind: 'own-move' as const, themes: ['own-move', grade, 'none', 'no-reply-named', 'pace:0'] });
const other = (id: string, exerciseKind: 'sense' | 'own-game' | 'puzzle') => ({ exerciseId: id, exerciseKind, themes: [] as string[] });

describe('a "Your move" position that was shown and left is owed, not used up', () => {
  it('is owed while nothing but that showing stands against it, however often it was left', () => {
    expect([...owedMoves([left('move:g1:19'), left('move:g1:19'), left('move:g2:21')])].sort()).toEqual(['move:g1:19', 'move:g2:21']);
  });

  it('is not owed once it has been answered, before or after, or asked in another exercise', () => {
    expect([...owedMoves([left('move:g1:19'), answered('move:g1:19')])]).toEqual([]);
    expect([...owedMoves([answered('move:g1:19', 'blunder'), left('move:g1:19')])]).toEqual([]);
    expect([...owedMoves([left('move:g1:19'), other('sense:safe-or-not:g1:19', 'sense')])]).toEqual([]);
    expect([...owedMoves([left('move:g1:19'), other('game:g1:19', 'own-game')])]).toEqual([]);
    // Something else entirely does not touch it.
    expect([...owedMoves([left('move:g1:19'), other('lichess:abc', 'puzzle')])]).toEqual(['move:g1:19']);
  });

  it('is asked before anything new; what was answered or met in another exercise is not asked at all', () => {
    const items = [item('g1', 19), item('g1', 21), item('g2', 19), item('g3', 19), item('g4', 19)];
    const attempts = [left('move:g1:19'), answered('move:g1:21'), other('sense:chance-or-not:g2:19', 'sense'), left('move:g4:19'), answered('move:g4:19')];
    const { owed, fresh } = movesToAsk(items, attempts);
    expect(owed.map((m) => m.id)).toEqual(['move:g1:19']);
    expect(fresh.map((m) => m.id)).toEqual(['move:g3:19']);
  });

  it('nothing put on screen in this sitting is asked again in it, owed or new, in whatever form it was shown', () => {
    const items = [item('g1', 19), item('g2', 19), item('g3', 19)];
    const { owed, fresh } = movesToAsk(items, [left('move:g1:19')], ['move:g1:19', 'sense:safe-or-not:g2:19']);
    expect(owed).toEqual([]);
    expect(fresh.map((m) => m.id)).toEqual(['move:g3:19']);
  });
});
