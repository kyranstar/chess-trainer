import { describe, expect, it } from 'vitest';
import { gradeMove, looseAfter, type MoveGrade, moveItems, outcomeOfGrade } from './ownmove';
import type { GameRecord } from './types';

describe('exact facts about a move the learner chose', () => {
  it('a knight put where a pawn takes it and nothing takes back is reported, with what takes it', () => {
    const f = looseAfter('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', 'f3e5');
    expect(f.mateInOne).toBeNull();
    expect(f.loose).toEqual([{ square: 'e5', piece: 'knight', by: { from: 'd6', piece: 'pawn' }, reason: 'undefended' }]);
  });

  it('a defended pawn that can be exchanged is not "loose"', () => {
    const f = looseAfter('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', 'd2d4');
    expect(f.loose).toEqual([]);
  });

  it('a defended piece that a cheaper piece can take is reported as such', () => {
    // The knight on g5 is defended by the bishop on c1, but ...h6 attacks it with a pawn only after a move; here the pawn on h6 already attacks it.
    const f = looseAfter('rnbqkbnr/ppppppp1/7p/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2', 'f3g5');
    expect(f.loose).toEqual([{ square: 'g5', piece: 'knight', by: { from: 'h6', piece: 'pawn' }, reason: 'undefended' }]);
    const defended = looseAfter('rnbqkbnr/ppppppp1/7p/8/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 2', 'f3g5');
    expect(defended.loose).toEqual([{ square: 'g5', piece: 'knight', by: { from: 'h6', piece: 'pawn' }, reason: 'cheaper-attacker' }]);
  });

  it('a piece that was already attacked and is left where it stands counts too', () => {
    // Black's bishop on b4 is attacked by the pawn on a3 and not defended; Black plays ...Nf6 and leaves it.
    const f = looseAfter('rnbqk1nr/pppp1ppp/8/4p3/1b2P3/P4N2/1PPP1PPP/RNBQKB1R b KQkq - 0 3', 'g8f6');
    expect(f.loose.map((l) => `${l.piece}@${l.square} by ${l.by.piece}@${l.by.from}`)).toContain('bishop@b4 by pawn@a3');
  });

  it('a move that allows mate in one says which', () => {
    const f = looseAfter('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4');
    expect(f.mateInOne).toEqual({ uci: 'd8h4', san: 'Qh4#' });
  });

  it('an attacker that is pinned to its king cannot take, so the piece is not loose', () => {
    // White knight goes to d5; Black's pawn on e6 would take it, but it is pinned by the rook on e1 against the king on e8.
    const f = looseAfter('4k3/8/4p3/8/8/2N5/8/4R1K1 w - - 0 1', 'c3d5');
    expect(f.loose).toEqual([]);
  });
});

describe('rating a move against the engine\'s best move (owner decision: judge harder, say it plainly)', () => {
  const nothing = { loose: [], mateInOne: null, afterFen: '', captures: [], mates: [], threatsBefore: [], freeBefore: [], mateBefore: null, tookFree: false, dealtWith: [], mateUnavoidable: false };
  it('bands by how far below the engine\'s first choice the move is rated', () => {
    expect(gradeMove(nothing, { loss: 0, isBest: true }, 'e2e4')).toBe('best');
    expect(gradeMove(nothing, { loss: 3, isBest: false }, 'e2e4')).toBe('good');
    expect(gradeMove(nothing, { loss: 7, isBest: false }, 'e2e4')).toBe('inaccuracy');
    expect(gradeMove(nothing, { loss: 14, isBest: false }, 'e2e4')).toBe('mistake');
    expect(gradeMove(nothing, { loss: 31, isBest: false }, 'e2e4')).toBe('blunder');
  });
  it('a move with nothing loose is no longer a pass when the engine rates it far below its best', () => {
    expect(gradeMove(nothing, { loss: 22, isBest: false }, 'a2a3')).toBe('blunder');
  });
  it('exact facts decide where they apply: allowing mate in one is a blunder, missing one is at least a mistake', () => {
    expect(gradeMove({ ...nothing, mateInOne: { uci: 'd8h4', san: 'Qh4#' } }, { loss: 2, isBest: false }, 'g2g4')).toBe('blunder');
    expect(gradeMove({ ...nothing, mateBefore: { uci: 'e1e8', san: 'Re8#' } }, { loss: 0, isBest: false }, 'h2h3')).toBe('mistake');
    expect(gradeMove({ ...nothing, mateBefore: { uci: 'e1e8', san: 'Re8#' } }, { loss: 0, isBest: true }, 'e1e8')).toBe('best');
    expect(gradeMove({ ...nothing, mateBefore: { uci: 'e1e8', san: 'Re8#' } }, { loss: 40, isBest: false }, 'h2h3')).toBe('blunder');
  });
  it('a piece left to be taken is rated by the engine like anything else: accepted if the engine accepts it', () => {
    const hung = { ...nothing, loose: [{ square: 'e5', piece: 'knight' as const, by: { from: 'd6', piece: 'pawn' as const }, reason: 'undefended' as const }] };
    expect(gradeMove(hung, { loss: 1, isBest: false }, 'f3e5')).toBe('good');
    expect(gradeMove(hung, { loss: 35, isBest: false }, 'f3e5')).toBe('blunder');
  });
  it('with no engine answer the move is not rated, except for the exact facts', () => {
    expect(gradeMove(nothing, null, 'a2a3')).toBe('unrated');
    expect(gradeMove({ ...nothing, mateInOne: { uci: 'd8h4', san: 'Qh4#' } }, null, 'g2g4')).toBe('blunder');
  });
  it('what is recorded: mistakes and blunders are misses, the rest pass, unrated counts for nothing', () => {
    expect(['best', 'good', 'inaccuracy', 'mistake', 'blunder', 'unrated'].map((g) => outcomeOfGrade(g as MoveGrade))).toEqual(['success', 'success', 'success', 'fail', 'fail', 'skipped']);
  });
});

describe('which positions are used', () => {
  it('undecided positions from the learner’s own games at moves 10 to 19, one per game stretch', () => {
    const moves = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 'g1f3' : 'g8f6'));
    const game = {
      id: 'g', source: 'chess.com', url: null, date: '2026-11-01', endDate: '2026-11-01', endTime: null, timeControl: '600', timeClass: 'rapid', color: 'white', result: 'win',
      termination: null, playerRating: 1, opponentRating: 1, opponent: 'x', moves, clocks: null, analysis: null, importedAt: 0, updatedAt: 0, analysisKey: null,
      measure: { decisions: [], events: [], facts: [{ ply: 8, wp: 50, played: 0, best: 0 }, { ply: 20, wp: 50, played: 0, best: 0 }, { ply: 22, wp: 55, played: 0, best: 0 }, { ply: 30, wp: 97, played: 0, best: 0 }, { ply: 36, wp: 40, played: 0, best: 0 }, { ply: 44, wp: 50, played: 0, best: 0 }] },
      measureKey: 'k',
    } as unknown as GameRecord;
    // The fake game's moves are not legal chess, so positions cannot be built; the selection itself is what is tested.
    const picked = moveItems([game], { build: false }).map((i) => i.ply);
    expect(picked).toEqual([20, 36]); // ply 8 too early, 22 next to 20, 30 decided, 44 too late

    // Found by the practice audit: at 16 out of 100 no move can lose 20 points, so a blunder cannot
    // be told from a good move there. Positions below 25 are not used.
    const lost = { ...game, id: 'lost', measure: { decisions: [], events: [], facts: [{ ply: 20, wp: 16, played: 0, best: 0 }, { ply: 28, wp: 24, played: 0, best: 0 }, { ply: 36, wp: 26, played: 0, best: 0 }] } } as unknown as GameRecord;
    expect(moveItems([lost], { build: false }).map((i) => i.ply)).toEqual([36]);
  });
});

import { movePicture } from './ownmove';

describe('the three checks of one move, all from legal move generation', () => {
  it('what the opponent already threatened, what could be taken for nothing, and what the move left loose', () => {
    // Black to move. His bishop on b4 is attacked by the a3 pawn (a threat he faces).
    // White's knight on e5 can be taken by the d6 pawn and nothing takes back (a free capture he has).
    const fen = 'rnbqk1nr/ppp2ppp/3p4/4N3/1b2P3/P7/1PPP1PPP/RNBQKB1R b KQkq - 0 4';
    const quiet = movePicture(fen, 'g8f6');
    expect(quiet.threatsBefore.map((l) => `${l.piece}@${l.square}`)).toEqual(['bishop@b4']);
    expect(quiet.freeBefore.map((l) => `${l.piece}@${l.square} by ${l.by.piece}@${l.by.from}`)).toEqual(['knight@e5 by pawn@d6']);
    expect(quiet.loose.map((l) => l.square)).toContain('b4'); // left where it was
    expect(quiet.tookFree).toBe(false);
    expect(quiet.dealtWith).toEqual([]);
    // Taking the knight uses the free capture, but the bishop is still attacked.
    const takes = movePicture(fen, 'd6e5');
    expect(takes.tookFree).toBe(true);
    expect(takes.loose.map((l) => l.square)).toContain('b4');
    // Retreating the bishop deals with the threat.
    const retreats = movePicture(fen, 'b4a5');
    expect(retreats.dealtWith).toEqual(['b4']);
    expect(retreats.loose.map((l) => l.square)).not.toContain('a5');
  });

  it('a mate in one that was there is reported whether or not it was played', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
    expect(movePicture(fen, 'h2h3').mateBefore).toEqual({ uci: 'e1e8', san: 'Re8#' });
    expect(movePicture(fen, 'e1e8').mateBefore).toEqual({ uci: 'e1e8', san: 'Re8#' });
  });

  it('when the learner is in check there is no "what was already threatened" beyond the check itself', () => {
    const p = movePicture('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', 'e1e2');
    expect(p.threatsBefore).toEqual([]);
  });
});

import { isPunishingReply } from './ownmove';

describe('cases from the outside reviewer (fourth pass)', () => {
  it('a pawn that can be taken en passant is seen', () => {
    const f = looseAfter('6k1/8/8/8/p7/8/1P6/6K1 w - - 0 1', 'b2b4');
    expect(f.loose.map((l) => `${l.piece}@${l.square} by ${l.by.piece}@${l.by.from}`)).toEqual(['pawn@b4 by pawn@a4']);
  });

  it('"took the free piece" means the capture that was free, not any capture on that square', () => {
    // Nxb3 wins a rook for nothing; Qxb3 takes the same rook but loses the queen to ...Rxb3.
    const fen = '1r4k1/8/8/8/8/1r6/3N4/1Q4K1 w - - 0 1';
    expect(movePicture(fen, 'd2b3').tookFree).toBe(true);
    expect(movePicture(fen, 'b1b3').tookFree).toBe(false);
  });

  it('any reply that does the job counts as naming it: another capture of the loose piece, or another mate', () => {
    // After Nc3-d5 the knight can be taken by the e6 pawn or the c6 pawn.
    const f = looseAfter('4k3/8/2p1p3/8/8/2N5/8/6K1 w - - 0 1', 'c3d5');
    expect(isPunishingReply(f, 'e6d5')).toBe(true);
    expect(isPunishingReply(f, 'c6d5')).toBe(true);
    expect(isPunishingReply(f, 'e8e7')).toBe(false);
    // Two different mates in one on the back rank.
    const m = looseAfter('3rr1k1/5ppp/8/8/8/8/P4PPP/6K1 w - - 0 1', 'a2a3');
    expect(isPunishingReply(m, 'd8d1')).toBe(true);
    expect(isPunishingReply(m, 'e8e1')).toBe(true);
    expect(isPunishingReply(m, 'g8h8')).toBe(false);
  });

  it('when every legal move allows mate in one, allowing it is not an avoidable blunder', () => {
    // White king h1, boxed in; whatever White plays, ...Qg2 is mate.
    const fen = '6k1/8/8/8/8/5q1p/7P/7K w - - 0 1';
    const p = movePicture(fen, 'h1g1');
    expect(p.mateInOne).not.toBeNull();
    expect(p.mateUnavoidable).toBe(true);
    const rating = { loss: 0, isBest: true };
    expect(gradeMove(p, rating, 'h1g1')).toBe('best'); // rated like any other move, not called a blunder
    // An avoidable one is still a blunder.
    const avoidable = movePicture('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g2g4');
    expect(avoidable.mateUnavoidable).toBe(false);
    expect(gradeMove(avoidable, { loss: 2, isBest: false }, 'g2g4')).toBe('blunder');
  });
});

import { freeTag, looseNote } from './ownmove';

describe('what the practice audit found in the messages', () => {
  // Black to move; a white knight on e5 can be taken for nothing by the d6 pawn.
  const fen = 'rnbqk1nr/ppp2ppp/3p4/4N3/1b2P3/P7/1PPP1PPP/RNBQKB1R b KQkq - 0 4';

  it('a free capture he passed up is a miss only when his move was rated worse than good', () => {
    const quiet = movePicture(fen, 'g8f6');
    const took = movePicture(fen, 'd6e5');
    expect(freeTag(took, 'best', 'd6e5')).toBe('free-taken');
    // He played another move that the engine rates as its first choice or close to it: nothing was missed.
    expect(freeTag(quiet, 'best', 'g8f6')).toBe('free-declined');
    expect(freeTag(quiet, 'good', 'g8f6')).toBe('free-declined');
    expect(freeTag(quiet, 'inaccuracy', 'g8f6')).toBe('free-left');
    expect(freeTag(quiet, 'blunder', 'g8f6')).toBe('free-left');
    expect(freeTag(quiet, 'unrated', 'g8f6')).toBe('free-left'); // no rating: the plain fact stands
    // Nothing was free: no tag at all.
    expect(freeTag(movePicture('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4'), 'best', 'e2e4')).toBeNull();
  });

  it('says whether a piece that can be taken is really worth taking, from what the capture costs the opponent', () => {
    // The engine takes it itself.
    expect(looseNote({ passed: true, engineTakes: true, captureCost: null })).toContain('The engine does take it');
    // Taking it is a mistake for the opponent: say so, do not leave "can be taken" standing alone.
    const trap = looseNote({ passed: true, engineTakes: false, captureCost: 50 });
    expect(trap).toContain('not really hanging');
    expect(trap).toContain('50 points');
    // Taking it is nearly as good as the engine's reply: the piece is hanging, even if the rating passes.
    expect(looseNote({ passed: true, engineTakes: false, captureCost: 2 })).toContain('about as good for your opponent');
    // Not checked (no engine answer): the cautious wording, with the way to play it out.
    expect(looseNote({ passed: true, engineTakes: false, captureCost: null })).toContain('That alone does not show the capture is harmless');
    expect(looseNote({ passed: false, engineTakes: false, captureCost: null })).toContain('starts with a different move');
    expect(looseNote({ passed: false, engineTakes: true, captureCost: null })).toContain('takes it');
  });
});

