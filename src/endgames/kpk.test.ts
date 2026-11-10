import { describe, expect, it } from 'vitest';
import { applyUci, fenOf, positionFromFen } from '../chess/rules';
import { distanceKpk, evaluateMove, fastestWin, HOLD_MOVES, keepingMoves, KPK_DRILLS, opponentReply, outcomeAfter, probeKpk, WIN_MOVE_CAP } from './kpk';

const D15 = '8/4k3/8/5K2/4P3/8/8/8 w - - 0 1'; // Lasker, Diagram 15

describe('KPK table probe', () => {
  it('agrees with the theory tested on the Mac side', () => {
    expect(probeKpk(D15)).toBe('win');
    expect(probeKpk('8/4k3/4P3/4K3/8/8/8/8 b - - 0 1')).toBe('draw');
    expect(probeKpk('k7/8/K7/P7/8/8/8/8 w - - 0 1')).toBe('draw'); // rook pawn
    expect(probeKpk('8/8/8/8/P6k/8/8/K7 w - - 0 1')).toBe('win'); // outside the square
    expect(probeKpk('7k/8/7K/7P/8/8/8/8 w - - 0 1')).toBe('draw'); // mirrored file
  });

  it('works when Black has the pawn (colours and ranks flipped)', () => {
    expect(probeKpk('8/8/8/4p3/5k2/8/4K3/8 b - - 0 1')).toBe('win'); // D15 upside down
    expect(probeKpk('8/8/8/8/4k3/4p3/4K3/8 w - - 0 1')).toBe('draw');
  });

  it('returns null for anything that is not king and pawn against king', () => {
    expect(probeKpk('8/8/8/8/8/8/k7/2K1Q3 w - - 0 1')).toBeNull();
    expect(probeKpk('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
  });
});

describe('result-keeping moves', () => {
  it('finds the single winning move in Lasker’s position', () => {
    expect(keepingMoves(D15)).toEqual(['f5e5']);
    expect(evaluateMove(D15, 'f5e5')).toMatchObject({ kept: true });
    expect(evaluateMove(D15, 'e4e5')).toMatchObject({ kept: false, keeping: ['f5e5'] });
  });

  it('finds the single drawing move for the defender', () => {
    expect(keepingMoves('8/4k3/4P3/4K3/8/8/8/8 b - - 0 1')).toEqual(['e7e8']);
  });

  it('counts a safe promotion as keeping the win and an unsafe one as not', () => {
    expect(keepingMoves('8/1P6/1K6/8/8/8/8/k7 w - - 0 1')).toContain('b7b8q');
    // Black king next to the queening square and the pawn unsupported: promoting loses the queen.
    expect(evaluateMove('8/1Pk5/8/8/8/8/8/K7 w - - 0 1', 'b7b8q').kept).toBe(false);
  });

  it('promoting to a bishop or knight throws the win away (insufficient material), a rook keeps it', () => {
    const fen = '7k/P7/2K5/8/8/8/8/8 w - - 0 1';
    expect(evaluateMove(fen, 'a7a8q')).toMatchObject({ kept: true, result: 'win' });
    expect(evaluateMove(fen, 'a7a8r')).toMatchObject({ kept: true, result: 'win' });
    expect(evaluateMove(fen, 'a7a8b')).toMatchObject({ kept: false, result: 'draw' });
    expect(evaluateMove(fen, 'a7a8n')).toMatchObject({ kept: false, result: 'draw' });
    expect(keepingMoves(fen)).toContain('a7a8q');
    expect(keepingMoves(fen).some((u) => u.endsWith('b') || u.endsWith('n'))).toBe(false);
  });

  it('a queen promotion that stalemates is a draw, and the rook promotion is then the keeping move', () => {
    // Black Ka6, White Kb4 and a pawn on b7: b8=Q leaves Black no move and no check.
    const fen = '8/1P6/k7/8/1K6/8/8/8 w - - 0 1';
    expect(evaluateMove(fen, 'b7b8q')).toMatchObject({ kept: false, result: 'draw' });
    expect(evaluateMove(fen, 'b7b8r')).toMatchObject({ kept: true, result: 'win' });
    expect(keepingMoves(fen)).toContain('b7b8r');
    expect(keepingMoves(fen)).not.toContain('b7b8q');
  });

  it('every shipped drill start has exactly one keeping move for the side to move', () => {
    expect(KPK_DRILLS.win.length).toBeGreaterThanOrEqual(100);
    expect(KPK_DRILLS.hold.length).toBeGreaterThanOrEqual(100);
    for (const fen of KPK_DRILLS.win) expect(keepingMoves(fen), fen).toHaveLength(1);
    for (const fen of KPK_DRILLS.hold) expect(keepingMoves(fen), fen).toHaveLength(1);
    for (const fen of KPK_DRILLS.win) expect(probeKpk(fen)).toBe('win');
    for (const fen of KPK_DRILLS.hold) expect(probeKpk(fen)).toBe('draw');
  });
});

describe('play-out against best defence', () => {
  function play(start: string, goal: 'win' | 'hold') {
    let fen = start;
    let learnerMoves = 0;
    for (let i = 0; i < 80; i++) {
      const keep = keepingMoves(fen);
      expect(keep.length, fen).toBeGreaterThan(0);
      // The learner plays the fastest win when winning, otherwise the first move that keeps the draw.
      const pick = goal === 'win' ? fastestWin(fen)! : keep[0]!;
      fen = fenOf(applyUci(positionFromFen(fen), pick));
      learnerMoves++;
      const o = outcomeAfter(fen, goal, learnerMoves);
      if (o) return { outcome: o, learnerMoves };
      fen = fenOf(applyUci(positionFromFen(fen), opponentReply(fen, goal)));
      const o2 = outcomeAfter(fen, goal, learnerMoves);
      if (o2) return { outcome: o2, learnerMoves };
    }
    throw new Error(`no result from ${start}`);
  }

  it('a learner who always keeps the win promotes safely from every sampled start', () => {
    for (const fen of KPK_DRILLS.win.slice(0, 40)) {
      const r = play(fen, 'win');
      expect(r.outcome, fen).toBe('promoted');
      expect(r.learnerMoves).toBeLessThan(WIN_MOVE_CAP);
    }
  });

  it('a learner who always keeps the draw holds from every sampled start', () => {
    for (const fen of KPK_DRILLS.hold.slice(0, 40)) {
      const r = play(fen, 'hold');
      expect(['held', 'pawn-captured', 'stalemate'], fen).toContain(r.outcome);
      expect(r.learnerMoves).toBeLessThanOrEqual(HOLD_MOVES);
    }
  });

  it('best play by both sides takes exactly the tabulated number of half-moves', () => {
    for (const start of [D15, ...KPK_DRILLS.win.slice(0, 15)]) {
      let fen = start;
      const d = distanceKpk(start)!;
      let plies = 0;
      while (distanceKpk(fen)) {
        const win = fastestWin(fen)!;
        fen = fenOf(applyUci(positionFromFen(fen), win));
        plies++;
        if (win.length === 5) break;
        fen = fenOf(applyUci(positionFromFen(fen), opponentReply(fen, 'win')));
        plies++;
      }
      expect(plies, start).toBe(d);
    }
  });

  it('the defender’s reply never lets the attacker off: the position stays won', () => {
    const after = fenOf(applyUci(positionFromFen(D15), 'f5e5'));
    const reply = opponentReply(after, 'win');
    expect(probeKpk(fenOf(applyUci(positionFromFen(after), reply)))).toBe('win');
  });

  it('the attacker’s reply keeps the pawn when it can and keeps testing the defender', () => {
    for (const start of KPK_DRILLS.hold.slice(0, 20)) {
      const after = fenOf(applyUci(positionFromFen(start), keepingMoves(start)[0]!));
      const next = fenOf(applyUci(positionFromFen(after), opponentReply(after, 'hold')));
      expect(probeKpk(next), start).toBe('draw'); // still king and pawn against king, still drawn
    }
  });
});

describe('audit regressions', () => {
  it('holding a draw never dead-ends: the attacker does not promote into a capture, and a non-KPK position is handled', () => {
    for (const start of ['8/8/8/1P2k3/2K5/8/8/8 b - - 0 1', '8/8/8/2P2k2/3K4/8/8/8 b - - 0 1']) {
      // Follow every draw-keeping line for a few moves; the play-out must always end or continue as K+P v K.
      const walk = (fen: string, depth: number): void => {
        if (depth === 0) return;
        for (const keep of keepingMoves(fen)) {
          const after = fenOf(applyUci(positionFromFen(fen), keep));
          if (outcomeAfter(after, 'hold', 1)) continue;
          const reply = opponentReply(after, 'hold');
          const next = fenOf(applyUci(positionFromFen(after), reply));
          if (outcomeAfter(next, 'hold', 1)) continue;
          expect(probeKpk(next), `${start} -> ${next}`).not.toBeNull();
          walk(next, depth - 1);
        }
      };
      walk(start, 6);
    }
    // A position with a queen on the board is not this ending: no crash, nothing "kept".
    expect(evaluateMove('1Q6/2k5/8/8/2K5/8/8/8 b - - 0 1', 'c7b8')).toMatchObject({ kept: false });
  });
});
