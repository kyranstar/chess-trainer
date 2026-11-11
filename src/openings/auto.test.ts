import { afterEach, describe, expect, it } from 'vitest';
import { fenAfter, positionKey } from '../chess/rules';
import { deleteDb, getMeta, openDb, recordAttempt } from '../db/db';
import type { GameRecord } from '../games/types';
import { declineEntry, updateRepertoire } from './auto';
import { drillId, makeEntry, type OpeningBook, START_FEN } from './repertoire';

const key = (ucis: string[]) => positionKey(fenAfter(START_FEN, ucis));
const mv = (uci: string, san: string, n: [number, number], wp?: number) => ({ uci, san, n, wp });
const pos = (moves: ReturnType<typeof mv>[], bestWp?: number, bestSan?: string) => ({ n: [moves.reduce((t, m) => t + m.n[0]!, 0), moves.reduce((t, m) => t + m.n[1]!, 0)], moves, bestWp, bestSan });
const book: OpeningBook = {
  manifest: { id: 'openings-lichess', version: 't', bands: [0, 1000], source: { month: 't', license: 'CC0-1.0', url: '' }, games: { used: 1000 }, filters: {} },
  positions: {
    [key([])]: pos([mv('e2e4', 'e4', [80, 60], 52), mv('d2d4', 'd4', [20, 40], 52)], 53),
    [key(['e2e4'])]: pos([mv('e7e5', 'e5', [60, 30], 48), mv('c7c5', 'c5', [40, 30], 47)], 48),
    [key(['e2e4', 'e7e5'])]: pos([mv('g1f3', 'Nf3', [70, 95], 54), mv('f1c4', 'Bc4', [30, 5], 52)], 55, 'Nf3'),
    [key(['e2e4', 'c7c5'])]: pos([mv('b1c3', 'Nc3', [60, 20], 54), mv('d2d4', 'd4', [40, 80], 55)], 55),
    [key(['e2e4', 'c7c5', 'b1c3'])]: pos([mv('d7d5', 'd5', [100, 100])]),
    [key(['e2e4', 'c7c5', 'b1c3', 'd7d5'])]: pos([mv('g1f3', 'Nf3', [100, 100], 54)], 54),
  },
};
let n = 0;
const game = (color: 'white' | 'black', moves: string): GameRecord => ({ id: `g${++n}`, color, moves: moves.split(' '), date: `2026-11-${String(n).padStart(2, '0')}` }) as unknown as GameRecord;
const names: string[] = [];
async function fresh() {
  const name = `auto-test-${Math.random()}`;
  names.push(name);
  return openDb(name);
}
afterEach(async () => {
  for (const name of names.splice(0)) await deleteDb(name);
});
const line = async (db: Awaited<ReturnType<typeof fresh>>, side = 'white') => (await db.repertoire.toArray()).filter((e) => e.side === side).map((e) => `${e.path.join(' ')}→${e.san}:${e.source ?? 'mine'}`).sort();

describe('the repertoire fills itself from the games on the device', () => {
  it('adds the moves from his games and suggestions for the common gaps, and doing it again changes nothing', async () => {
    const db = await fresh();
    await db.games.bulkPut([game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 c7c5 d2d4')]);
    const first = await updateRepertoire(db, book, 0, 5);
    // Two as White behind the Sicilian. As Black there are no games yet, so nothing is chosen for him.
    expect(first).toMatchObject({ fromGames: 2, suggested: 2 });
    expect(await line(db, 'black')).toEqual([]);
    expect(await line(db)).toEqual(['e4 c5 Nc3 d5→Nf3:suggested', 'e4 c5→Nc3:suggested', 'e4 e5→Nf3:own-games', '→e4:own-games']);
    const again = await updateRepertoire(db, book, 0, 99);
    expect(again).toMatchObject({ fromGames: 0, suggested: 0, replaced: 0, removed: 0 });
    expect((await db.repertoire.toArray()).every((e) => e.addedAt === 5)).toBe(true);
  });

  it('a habit that shows up later replaces the suggestion, and suggestions that hung on the old move go', async () => {
    const db = await fresh();
    await db.games.bulkPut([game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 c7c5 d2d4')]);
    await updateRepertoire(db, book, 0, 5);
    await db.games.bulkPut([game('white', 'e2e4 c7c5 d2d4 d7d5')]);
    const r = await updateRepertoire(db, book, 0, 6);
    expect(r).toMatchObject({ replaced: 1, removed: 1 });
    expect(await line(db)).toEqual(['e4 c5→d4:own-games', 'e4 e5→Nf3:own-games', '→e4:own-games']);
  });

  it('a suggestion that has been practised is kept even when it is no longer on the path', async () => {
    const db = await fresh();
    await db.games.bulkPut([game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 c7c5 d2d4')]);
    await updateRepertoire(db, book, 0, 5);
    const deep = (await db.repertoire.toArray()).find((e) => e.path.join(' ') === 'e4 c5 Nc3 d5')!;
    await recordAttempt(db, { sessionId: null, context: 'review', exerciseId: drillId(deep), exerciseKind: 'opening', contentVersion: 'x', conceptId: null, themes: [], rating: null, ts: 10, elapsedMs: 1, firstMove: deep.uci, played: [deep.uci], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false });
    await db.games.bulkPut([game('white', 'e2e4 c7c5 d2d4 d7d5')]);
    const r = await updateRepertoire(db, book, 0, 6);
    expect(r.removed).toBe(0);
    expect(await line(db)).toContain('e4 c5 Nc3 d5→Nf3:suggested');
  });

  it('a move he recorded himself is never touched, and a move he removed does not come back', async () => {
    const db = await fresh();
    await db.games.bulkPut([game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 e7e5 g1f3')]);
    await db.repertoire.put(makeEntry('white', fenAfter(START_FEN, ['e2e4', 'e7e5']), ['e4', 'e5'], 'f1c4', 1));
    await updateRepertoire(db, book, 0, 5);
    expect(await line(db)).toContain('e4 e5→Bc4:mine');
    const suggestion = (await db.repertoire.toArray()).find((e) => e.path.join(' ') === 'e4 c5')!;
    await declineEntry(db, suggestion);
    expect(await line(db)).not.toContain('e4 c5→Nc3:suggested');
    await updateRepertoire(db, book, 0, 6);
    expect(await line(db)).not.toContain('e4 c5→Nc3:suggested');
  });

  it('inside an opening one of his courses covers it suggests nothing, and takes out a suggestion it had made there', async () => {
    const db = await fresh();
    const caro: OpeningBook = { ...book, positions: { ...book.positions,
      [key(['e2e4'])]: pos([mv('e7e5', 'e5', [50, 30], 48), mv('c7c6', 'c6', [50, 30], 47)], 48),
      [key(['e2e4', 'c7c6'])]: pos([mv('d2d4', 'd4', [100, 100], 55)], 55),
    } };
    await db.games.bulkPut([game('white', 'e2e4 e7e5 g1f3'), game('white', 'e2e4 e7e5 g1f3')]);
    await db.repertoire.put({ ...makeEntry('white', fenAfter(START_FEN, ['e2e4', 'c7c6']), ['e4', 'c6'], 'd2d4', 1), source: 'suggested' });
    const r = await updateRepertoire(db, caro, 0, 5);
    expect(r).toMatchObject({ suggested: 0, removed: 1 });
    expect(await line(db)).toEqual(['e4 e5→Nf3:own-games', '→e4:own-games']);
  });

  it('keeps the list of habits it did not take over, for the screen', async () => {
    const db = await fresh();
    const weak: OpeningBook = { ...book, positions: { ...book.positions, [key(['e2e4', 'e7e5'])]: pos([mv('g1f3', 'Nf3', [70, 95], 54), mv('d1h5', 'Qh5', [30, 5], 41)], 55, 'Nf3') } };
    await db.games.bulkPut([game('white', 'e2e4 e7e5 d1h5'), game('white', 'e2e4 e7e5 d1h5')]);
    await updateRepertoire(db, weak, 0, 5);
    expect(await getMeta(db, 'openings.doubtful')).toEqual([{ side: 'white', positionKey: key(['e2e4', 'e7e5']), path: ['e4', 'e5'], san: 'Qh5', played: 2, reached: 2, bestSan: 'Nf3' }]);
    // Where his habit was not taken over, the position is left for him: no suggestion is put in its place.
    expect(await line(db)).toEqual(['e4 c5→Nc3:suggested', 'e4 c5 Nc3 d5→Nf3:suggested', '→e4:own-games'].sort());
  });
});
