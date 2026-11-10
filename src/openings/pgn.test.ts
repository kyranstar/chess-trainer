import { describe, expect, it } from 'vitest';
import { fenAfter, positionKey } from '../chess/rules';
import { entriesFromPgn, repertoireToPgn } from './pgn';
import { START_FEN } from './repertoire';

const PGN = `[Event "My Italian"]

1. e4 e5 (1... c6 2. d4 d5 3. e5) 2. Nf3 Nc6 3. Bc4 Bc5 (3... Nf6 4. d3) 4. c3 *

[Event "Transposition"]

1. e4 e5 2. Bc4 Nc6 3. Nf3 *
`;
const key = (ucis: string[]) => positionKey(fenAfter(START_FEN, ucis));

describe('repertoire PGN import', () => {
  it('takes the learner’s moves from main lines and variations, one per position', () => {
    const r = entriesFromPgn(PGN, 'white', 100);
    const byKey = new Map(r.entries.map((e) => [e.positionKey, e]));
    expect(byKey.get(key([]))!.san).toBe('e4');
    expect(byKey.get(key(['e2e4', 'e7e5']))!.san).toBe('Nf3');
    expect(byKey.get(key(['e2e4', 'c7c6']))!.san).toBe('d4');
    expect(byKey.get(key(['e2e4', 'c7c6', 'd2d4', 'd7d5']))!.san).toBe('e5');
    expect(byKey.get(key(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']))!.san).toBe('d3');
    expect(byKey.get(key(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']))!.path).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    expect(r.games).toBe(2);
  });

  it('reports a conflict when the file gives two different moves for one position and keeps the first', () => {
    const r = entriesFromPgn(PGN, 'white', 100);
    // Game 2 plays 2.Bc4 where game 1 chose 2.Nf3.
    expect(r.conflicts).toEqual([{ path: ['e4', 'e5'], kept: 'Nf3', ignored: 'Bc4' }]);
    expect(r.entries.filter((e) => e.positionKey === key(['e2e4', 'e7e5']))).toHaveLength(1);
  });

  it('for Black takes the replies', () => {
    const r = entriesFromPgn(PGN, 'black', 100);
    expect(r.entries.find((e) => e.positionKey === key(['e2e4']))!.san).toBe('e5');
    expect(r.conflicts.some((c) => c.kept === 'e5' && c.ignored === 'c6')).toBe(true);
  });

  it('rejects illegal moves with the line that failed, importing nothing', () => {
    expect(() => entriesFromPgn('1. e4 e5 2. Ke3 *', 'white', 1)).toThrow(/Ke3/);
    expect(entriesFromPgn('', 'white', 1).entries).toEqual([]);
  });

  it('round-trips: export then import gives the same repertoire', () => {
    // The first game alone is self-consistent (no position with two different moves).
    const first = entriesFromPgn(PGN.split('[Event "Transposition"]')[0]!, 'white', 100).entries;
    expect(first.length).toBeGreaterThanOrEqual(6);
    const again = entriesFromPgn(repertoireToPgn(first, 'white'), 'white', 100);
    const strip = (es: typeof first) => es.map((e) => [e.positionKey, e.uci]).sort();
    expect(strip(again.entries)).toEqual(strip(first));
    expect(again.conflicts).toEqual([]);
  });
});
