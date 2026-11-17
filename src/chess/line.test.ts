import { describe, expect, it } from 'vitest';
import { lineSan } from '../games/analyse';
import { branchOf, consequenceOf, lineAt, ucisOfSanLine, ABOUT_EQUAL, otherMoves, othersLabel, replaySpan, STANDS_OUT, triedMove, triedScore } from './line';
import { GRADE_BANDS } from '../games/ownmove';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('a stored line can be played through on the board', () => {
  it('reads a printed line back into moves, whichever side starts', () => {
    const pv = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
    expect(ucisOfSanLine(START, lineSan(START, pv))).toEqual(pv);
    const black = ['e7e5', 'g1f3', 'b8c6'];
    expect(ucisOfSanLine(BLACK_TO_MOVE, lineSan(BLACK_TO_MOVE, black))).toEqual(black);
  });

  it('reads castling, captures, promotion and check marks', () => {
    const fen = 'r3k2r/pP3ppp/8/8/8/8/5PPP/4K2R w Kkq - 0 1';
    const pv = ['b7a8q', 'e8e7', 'e1g1'];
    expect(ucisOfSanLine(fen, lineSan(fen, pv))).toEqual(pv);
  });

  it('stops at the first move it cannot read rather than guessing', () => {
    expect(ucisOfSanLine(START, '1. e4 e5 2. Qh8 Nc6')).toEqual(['e2e4', 'e7e5']);
    expect(ucisOfSanLine(START, '')).toEqual([]);
  });

  it('gives the position and the last move after any number of steps, and never runs past the end', () => {
    const pv = ['e2e4', 'e7e5'];
    expect(lineAt(START, pv, 0)).toEqual({ fen: START, last: null });
    expect(lineAt(START, pv, 1)).toEqual({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', last: 'e2e4' });
    expect(lineAt(START, pv, 9).last).toBe('e7e5');
    // An illegal move in the line: stay at the last position that could be reached.
    expect(lineAt(START, ['e2e4', 'e2e4'], 2).last).toBe('e2e4');
  });
});

describe('where a line is decided', () => {
  // After 1.e4 e5 2.Nf3 d6 3.Nxe5: the knight took a pawn and can be taken by the d-pawn.
  const BEFORE = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
  const AFTER = 'rnbqkbnr/ppp2ppp/3p4/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3';

  it('stops at the capture that settles it, names the piece and the square, and counts from before the learner’s own move', () => {
    const c = consequenceOf(AFTER, ['d6e5', 'b1c3', 'g8f6', 'f1c4'], 'white', BEFORE)!;
    expect(c).toMatchObject({ ply: 1, kind: 'material', square: 'e5' });
    // A pawn won, a knight lost: two points behind, not three.
    expect(c.text).toBe('Knight taken on e5. You end 2 points behind.');
    // The same line seen from the other side.
    expect(consequenceOf(AFTER, ['d6e5', 'b1c3', 'g8f6'], 'black', BEFORE)!.text).toBe('Knight taken on e5. You end 2 points ahead.');
  });

  it('claims nothing when the line stops on a capture: the recapture may be next', () => {
    expect(consequenceOf(AFTER, ['d6e5'], 'white', BEFORE)).toBeNull();
    expect(consequenceOf(AFTER, ['b8c6', 'e5c6'], 'white', BEFORE)).toBeNull();
  });

  it('claims nothing for an even exchange or a line with no capture', () => {
    // 1.e4 d5 2.exd5 Qxd5 3.Nc3: pawn for pawn.
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(consequenceOf(start, ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3'], 'white')).toBeNull();
    expect(consequenceOf(start, ['e2e4', 'e7e5', 'g1f3'], 'white')).toBeNull();
  });

  it('runs through a whole exchange to its last capture before saying who came out ahead', () => {
    // White takes a defended pawn with the knight, Black retakes, White retakes: knight and pawn for knight... 
    // 1.e4 e5 2.Nf3 Nc6 3.Nxe5 Nxe5 4.d4 (quiet): White gave a knight for a pawn.
    const start = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const c = consequenceOf(start, ['f3e5', 'c6e5', 'd2d4', 'e5c6'], 'white')!;
    expect(c).toMatchObject({ ply: 2, square: 'e5' });
    expect(c.text).toBe('Knight taken on e5. You end 2 points behind.');
  });

  it('stops at the capture that cost the piece, not at an even exchange that follows it', () => {
    // 3...dxe5 wins the knight; then bishop is exchanged for bishop on e6. The knight is the point.
    const c = consequenceOf(AFTER, ['d6e5', 'f1c4', 'c8e6', 'c4e6', 'f7e6', 'd2d3'], 'white', BEFORE)!;
    expect(c).toMatchObject({ ply: 1, square: 'e5' });
    expect(c.text).toBe('Knight taken on e5. You end 2 points behind.');
  });

  it('stops at checkmate and marks the king', () => {
    // Fool's mate: 1.f3 e5 2.g4 Qh4#.
    const start = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
    const c = consequenceOf(start, ['g2g4', 'd8h4'], 'white')!;
    expect(c).toMatchObject({ ply: 2, kind: 'mate', square: 'e1' });
    expect(c.text).toBe('Checkmate.');
  });

  it('counts a promotion, and an en passant capture as a pawn', () => {
    const promo = consequenceOf('8/4P1k1/8/8/8/8/6K1/8 w - - 0 1', ['e7e8q', 'g7f6', 'e8e4'], 'white')!;
    expect(promo).toMatchObject({ ply: 1, square: 'e8' });
    expect(promo.text).toBe('The pawn queens on e8. You end 8 points ahead.');
    // White pawn on e5, Black has just played d7-d5: exd6 e.p. takes the pawn on d5.
    const ep = consequenceOf('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', ['e5d6', 'e8d7', 'e1e2'], 'white')!;
    expect(ep).toMatchObject({ ply: 1, square: 'd6' });
    expect(ep.text).toBe('Pawn taken on d5. You end 1 point ahead.');
  });
});


import { mergeLines, numberedSans } from './line';

describe('the moves compared after an answer: you, the game, the best (ADR-052)', () => {
  // The owner's game of 9 November, move 19, White: he tried Bb5+, had played Qe4, best was Bh5+.
  const fen = '2qrkb1r/1pp3p1/p3bp1p/5n2/1P6/2N1Q1B1/P1P1BPPP/3R1RK1 w k - 1 19';
  const you = { who: 'you' as const, uci: 'e2b5', score: 11, pv: ['a6b5'] };
  const game = { who: 'game' as const, uci: 'e3e4', score: 76, pv: null };
  const best = { who: 'best' as const, uci: 'e2h5', score: 97, pv: ['e8e7', 'e3c5'] };

  it('three different moves are three lines, always in the order you, game, best', () => {
    const lines = mergeLines(fen, [best, game, you]);
    expect(lines.map((l) => [l.kind, l.label, l.san, l.score])).toEqual([['you', 'You', 'Bb5+', 11], ['game', 'Game', 'Qe4', 76], ['best', 'Best', 'Bh5+', 97]]);
    expect(lines[1]!.pv).toBeNull(); // not searched yet: asked for when the line is opened
  });

  it('the move from the game played again is one line carrying both names', () => {
    const lines = mergeLines(fen, [{ ...you, uci: 'e3e4', score: 75, pv: ['f8d6'] }, game, best]);
    expect(lines.map((l) => l.label)).toEqual(['You · Game', 'Best']);
    expect(lines[0]).toMatchObject({ kind: 'you', who: ['you', 'game'], score: 75, pv: ['f8d6'] });
  });

  it('the best move found is one line in the engine\'s colour, with the engine\'s figures and line', () => {
    const lines = mergeLines(fen, [{ ...you, uci: 'e2h5', score: 95, pv: [] }, game, best]);
    expect(lines.map((l) => l.label)).toEqual(['You · Best', 'Game']);
    expect(lines[0]).toMatchObject({ kind: 'best', score: 97, pv: ['e8e7', 'e3c5'] });
    // All three the same move: one line.
    expect(mergeLines(fen, [{ ...you, uci: 'e2h5' }, { ...game, uci: 'e2h5' }, best]).map((l) => l.label)).toEqual(['You · Game · Best']);
  });

  it('castling written either way is the same move; a move that cannot be played is left out; a puzzle names its own', () => {
    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(mergeLines(castle, [{ who: 'you', uci: 'e1h1', score: null, pv: [] }, { who: 'best', uci: 'e1g1', score: null, pv: [] }]).map((l) => l.label)).toEqual(['You · Best']);
    expect(mergeLines(fen, [{ ...you, uci: 'a1a8' }, best]).map((l) => l.label)).toEqual(['Best']);
    expect(mergeLines(fen, [{ ...best, label: 'Solution' }])[0]!.label).toBe('Solution');
    expect(mergeLines('not a position', [best])).toEqual([]);
  });

  it('a line is written with its move numbers, whichever side starts', () => {
    expect(numberedSans(fen, ['e2h5', 'e8e7', 'e3c5'])).toEqual([{ san: 'Bh5+', no: '19.' }, { san: 'Ke7', no: null }, { san: 'Qc5+', no: '20.' }]);
    expect(numberedSans(BLACK_TO_MOVE, ['e7e5', 'g1f3'])).toEqual([{ san: 'e5', no: '1…' }, { san: 'Nf3', no: '2.' }]);
    // It stops at a move that cannot be played rather than guessing.
    expect(numberedSans(fen, ['e2h5', 'a1a8']).map((t) => t.san)).toEqual(['Bh5+']);
  });
});

describe('a capture that the rest of the line takes back is not a result (ADR-053)', () => {
  // White takes a knight, quiet moves follow, and Black takes a knight back at the end of the line.
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4';
  const line = ['f3e5', 'c6e5', 'd2d4', 'e5c6', 'd4d5', 'c6e7', 'f1d3', 'd7d6'];
  it('claims nothing for the whole line, although its first moves alone would show a gain', () => {
    // Knight takes pawn, knight takes knight: after six moves White is two points down, and stays so.
    expect(consequenceOf(fen, line, 'white')?.text).toBe('Knight taken on e5. You end 2 points behind.');
    // The same start, but the material comes back later in the line: nothing is claimed ...
    const back = ['f3e5', 'c6e5', 'd2d4', 'e5c6', 'd4d5', 'c6e7', 'd5d6', 'c7d6', 'd1d6', 'e7c6', 'd6f6', 'd8f6'];
    const whole = consequenceOf(fen, back, 'white');
    const head = consequenceOf(fen, back.slice(0, 6), 'white');
    expect(head).not.toBeNull();
    // ... or, if something is, it is not what the first six moves alone would have said.
    expect(whole === null || whole.text !== head!.text).toBe(true);
  });
});

describe("the engine's other choices under the compared moves (ADR-054)", () => {
  // The owner's position of 12 October, move 10: he played Qe4 and could not see why a pawn move was "best".
  const fen = 'rnb1qrk1/ppp1ppbp/1n4p1/4P1B1/8/2N2N2/PPP1QPPP/3RKB1R w K - 5 10';
  const searched = [
    { uci: 'h2h3', wp: 52.8, pv: ['h2h3', 'c8f5', 'b2b3'], mate: null },
    { uci: 'e2e3', wp: 51.9, pv: ['e2e3', 'c8g4'], mate: null },
    { uci: 'g5f4', wp: 51.7, pv: ['g5f4', 'c8f5'], mate: null },
    { uci: 'e2e4', wp: 50.9, pv: ['e2e4', 'b8c6'], mate: null },
  ];
  it('leaves out the moves already compared and keeps the engine order', () => {
    const others = otherMoves(fen, searched, ['e2e4', 'c3b5', 'h2h3']);
    expect(others.map((o) => o.san)).toEqual(['Qe3', 'Bf4']);
    expect(others.every((o) => o.kind === 'other')).toBe(true);
    // What follows the move, without the move itself; the number is the search's own.
    expect(others[0]).toMatchObject({ uci: 'e2e3', pv: ['c8g4'], score: 51.9 });
  });
  it('shows at most three, and none twice', () => {
    expect(otherMoves(fen, [...searched, searched[1]!], []).map((o) => o.san)).toEqual(['h3', 'Qe3', 'Bf4']);
  });
  it('reads castling however the engine writes it, and skips a move that cannot be played', () => {
    const castle = 'r3k2r/pppq1ppp/2n5/8/8/2N5/PPPQ1PPP/R3K2R w KQkq - 0 1';
    const got = otherMoves(castle, [{ uci: 'e1g1', wp: 50, pv: ['e1g1'], mate: null }, { uci: 'a1a8', wp: 50, pv: ['a1a8'], mate: null }], []);
    expect(got.map((o) => o.san)).toEqual(['O-O']);
    // The same castling move written the other way is already taken.
    expect(otherMoves(castle, [{ uci: 'e1h1', wp: 50, pv: ['e1h1'], mate: null }], [got[0]!.uci])).toEqual([]);
  });
  it('heads them "About as good" when the bands would not tell them from the first choice: the answer to "why is that one best"', () => {
    const others = otherMoves(fen, searched, ['h2h3']);
    expect(othersLabel(searched, others)).toBe('About as good');
  });
  it('heads them "Much worse" when one move stands out, and plainly when they are between or mixed', () => {
    const at = (wp: number, mate: number | null = null) => ({ uci: 'x', wp, pv: [], mate });
    expect(othersLabel([at(90), at(55), at(40)], [{ score: 55 }, { score: 40 }])).toBe('Much worse');
    expect(othersLabel([at(70), at(58)], [{ score: 58 }])).toBe('Others');
    expect(othersLabel([at(70), at(68), at(40)], [{ score: 68 }, { score: 40 }])).toBe('Others');
    expect(othersLabel([at(70)], [])).toBe('Others');
    expect(othersLabel([at(70), at(69)], [{ score: null }])).toBe('Others');
  });
  it('does not call a large advantage as good as a forced mate, though their expected scores are', () => {
    const at = (wp: number, mate: number | null = null) => ({ uci: 'x', wp, pv: [], mate });
    expect(othersLabel([at(100, 1), at(99.2)], [{ score: 99.2 }])).toBe('Others');
    expect(othersLabel([at(100, 1), at(50)], [{ score: 50 }])).toBe('Much worse');
    // Being mated either way is the same.
    expect(othersLabel([at(0, -2), at(0, -1)], [{ score: 0 }])).toBe('About as good');
  });
  it('uses the same bands as the rating of a move', () => {
    expect(ABOUT_EQUAL).toBe(GRADE_BANDS.good);
    expect(STANDS_OUT).toBe(GRADE_BANDS.mistake);
  });
});

describe('how far a line is shown and where its replay rests', () => {
  const CAP = 6;
  it('ends where it is decided, and plays to there', () => {
    expect(replaySpan({ length: 10, decidedPly: 4, stopThere: true, least: 0, cap: CAP })).toEqual({ shown: 4, stop: 4 });
  });
  it('a solution is shown to its end, and its replay still rests on the decisive move when asked to', () => {
    expect(replaySpan({ length: 10, decidedPly: 4, stopThere: false, least: 0, cap: CAP })).toEqual({ shown: 10, stop: 4 });
  });
  it('a line that is not decided is capped, and rests at its end or where it was asked to', () => {
    expect(replaySpan({ length: 10, decidedPly: null, stopThere: true, least: 0, cap: CAP })).toEqual({ shown: 6, stop: 6 });
    expect(replaySpan({ length: 10, decidedPly: null, stopThere: true, least: 2, cap: CAP })).toEqual({ shown: 6, stop: 2 });
    expect(replaySpan({ length: 3, decidedPly: null, stopThere: false, least: 0, cap: CAP })).toEqual({ shown: 3, stop: 3 });
  });
  it('a wrong puzzle move that took a pawn and kept it is still answered on the board', () => {
    // Seen in the browser suite on 15 November: "fxe4 is not the move. Pawn taken on e4. You end
    // 1 point ahead.", with the replay resting on fxe4 and the engine's answer never shown.
    expect(replaySpan({ length: 9, decidedPly: 1, stopThere: true, least: 2, cap: CAP })).toEqual({ shown: 2, stop: 2 });
    // Where it is decided later, nothing changes.
    expect(replaySpan({ length: 9, decidedPly: 3, stopThere: true, least: 2, cap: CAP })).toEqual({ shown: 3, stop: 3 });
    // A wrong move with no answer known yet is one move long.
    expect(replaySpan({ length: 1, decidedPly: null, stopThere: true, least: 2, cap: CAP })).toEqual({ shown: 1, stop: 1 });
  });
});

describe('a move made by hand on a result (ADR-055)', () => {
  // The compared moves from the starting position: e4 and d4 are on the screen.
  const firsts = ['e2e4', 'd2d4'];

  it('in the position asked, the first move of a line already shown opens that line', () => {
    expect(branchOf(START, [], 'd2d4', null, firsts)).toEqual({ kind: 'line', index: 1 });
  });

  it('in the position asked, any other move is a line of its own', () => {
    expect(branchOf(START, [], 'g1f3', null, firsts)).toEqual({ kind: 'try', path: ['g1f3'] });
  });

  it('the move the line on the board goes on with is one step on, not a new line', () => {
    expect(branchOf(START, ['e2e4'], 'e7e5', 'e7e5', firsts)).toEqual({ kind: 'on' });
  });

  it('another move inside a line, for whichever side is to move, is tried from there with the moves that led to it', () => {
    // "What if they did this instead": Black's move, two moves into White's line.
    expect(branchOf(START, ['e2e4'], 'c7c5', 'e7e5', firsts)).toEqual({ kind: 'try', path: ['e2e4', 'c7c5'] });
    // "What if I did this instead": White's, a move later.
    expect(branchOf(START, ['e2e4', 'e7e5'], 'f1c4', 'g1f3', firsts)).toEqual({ kind: 'try', path: ['e2e4', 'e7e5', 'f1c4'] });
  });

  it('a first move of a shown line made later in a line is not that line: the position is another one', () => {
    expect(branchOf(START, ['g1f3', 'g8f6'], 'd2d4', null, firsts)).toEqual({ kind: 'try', path: ['g1f3', 'g8f6', 'd2d4'] });
  });

  it('at the end of a line there is nothing to step on to: the move is tried', () => {
    expect(branchOf(START, ['e2e4', 'e7e5'], 'g1f3', null, firsts)).toEqual({ kind: 'try', path: ['e2e4', 'e7e5', 'g1f3'] });
  });

  it('reads castling however it is written, and promotion with its piece', () => {
    const castle = 'r3k2r/pppq1ppp/2n5/8/8/2N5/PPPQ1PPP/R3K2R w KQkq - 0 1';
    // King onto the rook is the same move as the king's two squares.
    expect(branchOf(castle, [], 'e1h1', 'e1g1', [])).toEqual({ kind: 'on' });
    expect(branchOf(castle, [], 'e1h1', null, ['e1g1'])).toEqual({ kind: 'line', index: 0 });
    expect(branchOf(castle, [], 'e1a1', null, ['e1g1'])).toEqual({ kind: 'try', path: ['e1c1'] });
    const promote = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    // An underpromotion is its own move, not the queen's line.
    expect(branchOf(promote, [], 'a7a8n', 'a7a8q', ['a7a8q'])).toEqual({ kind: 'try', path: ['a7a8n'] });
    expect(branchOf(promote, [], 'a7a8q', null, ['a7a8q'])).toEqual({ kind: 'line', index: 0 });
  });

  it('a move that cannot be played there is nothing, and so is a line that cannot be followed', () => {
    expect(branchOf(START, [], 'e2e5', null, firsts)).toBeNull();
    expect(branchOf(START, ['e2e4'], 'e2e4', null, firsts)).toBeNull();
    expect(branchOf(START, ['e2e5'], 'e7e5', null, firsts)).toBeNull();
    expect(branchOf('not a position', [], 'e2e4', null, firsts)).toBeNull();
  });

  it('a tried move is named with its number unless it was made in the position asked', () => {
    expect(triedMove(START, ['g1f3'])).toEqual({ san: 'Nf3', no: null });
    // a3 can also be played in the position asked: made a move later, it says so.
    expect(triedMove(START, ['g1f3', 'g8f6', 'a2a3'])).toEqual({ san: 'a3', no: '2.' });
    expect(triedMove(START, ['e2e4', 'c7c5'])).toEqual({ san: 'c5', no: '1…' });
    expect(triedMove(BLACK_TO_MOVE, ['e7e5', 'g1f3'])).toEqual({ san: 'Nf3', no: '2.' });
    expect(triedMove(START, ['e2e5'])).toBeNull();
    expect(triedMove(START, [])).toBeNull();
  });

  it('what a tried line is worth is always said from the learner’s side, whoever is to move after it', () => {
    // After White's try it is Black to move: the engine's 30 for Black is 70 for White.
    expect(triedScore(START, ['g1f3'], 'white', 30)).toEqual({ over: false, score: 70 });
    expect(triedScore(START, ['g1f3'], 'black', 30)).toEqual({ over: false, score: 30 });
    // After a try for the opponent it is the learner's move: the engine's number is already his.
    expect(triedScore(START, ['e2e4', 'c7c5'], 'white', 55)).toEqual({ over: false, score: 55 });
    // No answer from the engine: no number.
    expect(triedScore(START, ['g1f3'], 'white', null)).toEqual({ over: false, score: null });
  });

  it('a tried move that ends the game needs no engine: mate is all or nothing, stalemate is a draw', () => {
    // Fool's mate, tried for Black against White.
    const fools = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    expect(triedScore(START, fools, 'white', null)).toEqual({ over: true, score: 0 });
    expect(triedScore(START, fools, 'black', null)).toEqual({ over: true, score: 100 });
    // Qb6 stalemates the king in the corner.
    const stale = 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1';
    expect(triedScore(stale, ['b1b6'], 'white', null)).toEqual({ over: true, score: 50 });
  });

  it('a tried move is always answered on the board, and its line ends where it is decided after the move', () => {
    const CAP = 6;
    // Tried three moves into a line: the engine answered with ten moves, nothing is decided.
    // The replay rests on the reply; six of the engine's moves can be stepped through.
    expect(replaySpan({ length: 13, decidedPly: null, stopThere: true, least: 4, cap: 3 + CAP })).toEqual({ shown: 9, stop: 4 });
    // Decided two moves after the reply: it plays on to there and ends there.
    expect(replaySpan({ length: 13, decidedPly: 6, stopThere: true, least: 4, cap: 3 + CAP })).toEqual({ shown: 6, stop: 6 });
    // The tried move itself took something and kept it: the reply is still shown.
    expect(replaySpan({ length: 13, decidedPly: 3, stopThere: true, least: 4, cap: 3 + CAP })).toEqual({ shown: 4, stop: 4 });
    // No answer yet: the line is the moves made so far.
    expect(replaySpan({ length: 3, decidedPly: null, stopThere: true, least: 4, cap: 3 + CAP })).toEqual({ shown: 3, stop: 3 });
  });
});
