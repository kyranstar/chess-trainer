import { describe, expect, it } from 'vitest';
import { applyUci, fenOf, positionFromFen } from '../../src/chess/rules';
import type { BackupFile } from '../../src/db/backup';
import type { Attempt } from '../../src/db/types';
import type { PvLine } from '../../src/engine/uci';
import type { Puzzle } from '../../src/puzzles/types';
import { type AuditEngine, auditBackup, renderReport } from './audit';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const fenAfter = (ucis: string[]) => ucis.reduce((pos, u) => applyUci(pos, u), positionFromFen(START));
const fen = (ucis: string[]) => fenOf(fenAfter(ucis));

/** An engine that says what the test tells it for the positions it names, and "level, some legal move" elsewhere. */
function scripted(table: Record<string, { cp: number; pv: string[] }>): AuditEngine {
  return {
    name: 'scripted',
    analyse: async (f: string): Promise<PvLine[]> => {
      const hit = table[f];
      if (hit) return [{ move: hit.pv[0]!, score: { cp: hit.cp }, pv: hit.pv }];
      const pos = positionFromFen(f);
      for (const [from, tos] of pos.allDests()) {
        const to = [...tos][0];
        if (to !== undefined) {
          const sq = (n: number) => 'abcdefgh'[n % 8]! + (Math.floor(n / 8) + 1);
          return [{ move: sq(from) + sq(to), score: { cp: 0 }, pv: [sq(from) + sq(to)] }];
        }
      }
      return [];
    },
  };
}

const GAME = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3', 'd7d6'];
const at = (over: Partial<Attempt>): Attempt => ({
  uuid: Math.random().toString(36), deviceId: 'd', sessionId: null, context: 'practice', exerciseId: 'x', exerciseKind: 'own-move', contentVersion: 'own-move-v3', conceptId: null, themes: [], rating: null,
  ts: Date.UTC(2026, 10, 11, 12), tzOffsetMin: 0, elapsedMs: 9000, firstMove: null, played: [], mistakes: 0, hints: 0, outcome: 'success', acceptedAlternative: false, fresh: true, scheduledReview: false, daysSinceLast: null, schedulerVersion: 's', ...over,
});
const backup = (attempts: Attempt[]): BackupFile => ({
  manifest: { exportTime: '2026-11-11T12:00:00.000Z' } as BackupFile['manifest'],
  data: { attempts, games: [{ id: 'g1', color: 'white', date: '2026-11-01', endDate: '2026-11-01', moves: GAME }] } as unknown as BackupFile['data'],
});

describe('practice audit', () => {
  it('flags a move the phone passed that a deep search fails, and a move it failed that a deep search passes', async () => {
    const before = fen(GAME.slice(0, 4)); // White to play his third move
    const afterBc4 = fen([...GAME.slice(0, 4), 'f1c4']);
    const afterBb5 = fen([...GAME.slice(0, 4), 'f1b5']);
    const engine = scripted({
      [before]: { cp: 30, pv: ['d2d4', 'e5d4'] },
      [afterBc4]: { cp: 400, pv: ['g8f6', 'd2d3'] }, // Black is winning after Bc4, says the script
      [afterBb5]: { cp: -25, pv: ['a7a6', 'b5a4'] }, // Bb5 is as good as anything
    });
    const r = await auditBackup(backup([
      at({ exerciseId: 'move:g1:4', firstMove: 'f1c4', played: ['f1c4'], themes: ['own-move', 'good', 'none', 'no-reply-named', 'pace:0'], outcome: 'success' }),
      at({ exerciseId: 'move:g1:4', firstMove: 'f1b5', played: ['f1b5', 'g8f6'], themes: ['own-move', 'blunder', 'none', 'named-another', 'pace:30', 'late'], outcome: 'fail', ts: Date.UTC(2026, 10, 11, 12, 5) }),
      at({ exerciseId: 'move:g1:4', themes: ['own-move', 'left'], outcome: 'skipped' }), // shown and left: not an answer
    ]), new Map(), engine, { days: 3, nodes: 1 });
    expect(r.ownMoves.map((x) => [x.my, x.app.grade, x.deep.grade, x.agreement])).toEqual([
      ['Bc4', 'good', 'blunder', 'app-too-lenient'],
      ['Bb5', 'blunder', 'good', 'app-too-harsh'],
    ]);
    expect(r.ownMoves[0]!.deep).toMatchObject({ best: 'd4', reply: 'Nf6' });
    expect(r.ownMoves[1]!.app).toMatchObject({ late: true, pace: 30, named: 'Nf6' });
    expect(r.ownMoves[1]!.notes.join(' ')).toContain('He named Nf6 as the reply; the deep search plays a6.');
    const text = renderReport(r);
    expect(text).toContain('The app passed 1 of 2; on the deep search 1 of 2 pass.');
    expect(text).toContain('[app-too-lenient]');
  });

  it('flags a puzzle move recorded as a miss that is as good as the stored solution, and looks only at the most recent days', async () => {
    const puzzle: Puzzle = { id: 'p1', fen: fen(GAME.slice(0, 3)), moves: 'b8c6 f1c4 f8c5', rating: 1000, rd: 80, pop: 90, plays: 100, themes: [], game: '' } as unknown as Puzzle;
    const solving = fen(GAME.slice(0, 4));
    const engine = scripted({
      [solving]: { cp: 30, pv: ['f1c4'] },
      [fen([...GAME.slice(0, 4), 'f1b5'])]: { cp: -28, pv: ['a7a6'] },
    });
    const r = await auditBackup(backup([
      at({ exerciseKind: 'puzzle', exerciseId: 'lichess:p1', firstMove: 'f1b5', outcome: 'fail', ts: Date.UTC(2026, 10, 11, 12) }),
      at({ exerciseKind: 'puzzle', exerciseId: 'lichess:p1', firstMove: 'f1b5', outcome: 'fail', ts: Date.UTC(2026, 9, 1, 12) }), // weeks ago: outside the window
      at({ exerciseKind: 'opening', exerciseId: 'opening:x', outcome: 'success', ts: Date.UTC(2026, 10, 10, 12) }),
    ]), new Map([['p1', puzzle]]), engine, { days: 2, nodes: 1 });
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11']);
    expect(r.puzzles).toHaveLength(1);
    expect(r.puzzles[0]).toMatchObject({ my: 'Bb5', solution: 'Bc4', agreement: 'sound-move-marked-wrong' });
    expect(r.other).toEqual({ opening: 1 });
  });
});
