/**
 * Lessons in modern notation (owner, 2026-11-20: "translate all of the old notation into modern
 * notation"). The lesson files stay as the books print them (their text is checked against the
 * books); what is shown is converted here.
 *
 * Two old styles: Lasker (1918) names squares as today but writes the piece and a dash ("Kt-f3",
 * "P-e4", "Pxe5"); Capablanca (1921) uses descriptive notation ("Kt - K B 3", "P x P").
 *
 * The rule that keeps it honest (ADR-064: a first version placed moves wherever they happened to
 * fit and wrote wrong chess): a move is placed only in the position the text is narrating — the
 * numbered move of the game being told (numbers count from each diagram's own move number), or
 * the next move after the last one placed with nothing but punctuation between — and only if
 * exactly one legal move there fits it, its check agreeing with the book's. Placed, it is written
 * as today's notation with its check or mate. Not placed, a Lasker piece move or pawn advance is
 * rewritten from its text alone (the square is already in today's form); anything else is left as
 * printed and reported.
 */
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, NormalMove, Role } from 'chessops/types';
import { parseSquare, squareFile, squareRank } from 'chessops/util';
import type { Lesson, LessonStep } from '../content/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROLE: Record<string, Role> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', Kt: 'knight', P: 'pawn' };
const DESC_FILES: Record<string, number[]> = { QR: [0], QKt: [1], QB: [2], Q: [3], K: [4], KB: [5], KKt: [6], KR: [7], R: [0, 7], Kt: [1, 6], B: [2, 5] };

type Spec =
  | { kind: 'castle'; long: boolean }
  | { kind: 'move'; role: Role; capture: boolean; to?: number; files?: number[]; rank?: number; captured?: Role; capturedFiles?: number[] };

interface Found {
  start: number;
  end: number;
  spec: Spec;
  /** The book's check mark: '' none, '+' check (or "ch"), '++' (Lasker: double check or mate). */
  check: string;
  marks: string;
  /** Lasker only: the move written today from its text alone, when no position places it. */
  plain?: string;
}

const LASKER = /\b(Kt|[KQRBP])([a-h][1-8])?\s?([-x])\s?([a-hA-H])([1-8])(?: ?(\+\/-|\+\+|\+|#))?([?!]*)/g;
const DESCRIPTIVE = /\b(Kt|[KQRBP]) ?([-x]) ?(?:((?:[KQ] ?)?(?:Kt|[BR])?) ?([1-8])|((?:[KQ] ?)?(?:Kt|[BR])? ?)(Kt|[KQRBP])(?![a-z]))((?: ?ch)?)([?!]*)/g;
/** What may stand between two moves of one list: punctuation, asides in brackets, and the words for check and mate. */
function listGap(gap: string): boolean {
  return /^[\s,;.:]*$/.test(gap.replace(/\([^()]*\)/g, '').replace(/\b(?:double check|discovered check|check|mate|checkmate|ch)\b/gi, ''));
}

const CASTLE = /\b([oO0]) ?- ?\1( ?- ?\1)?(\+)?([?!]*)/g;

function find(text: string, dialect: 'lasker' | 'descriptive'): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(CASTLE)) out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'castle', long: !!m[2] }, check: m[3] ?? '', marks: m[4] ?? '', plain: m[2] ? 'O-O-O' : 'O-O' });
  if (dialect === 'lasker') {
    for (const m of text.matchAll(LASKER)) {
      // "Pd7xc6": the pawn's own square is written, so its file is known without a position.
      const origin = m[2];
      const sq = `${m[4]!.toLowerCase()}${m[5]}`;
      const capture = m[3] === 'x';
      // "+/-" and "#" are this text's marks for mate; "++" its double check or mate.
      const check = m[6] === '#' || m[6] === '+/-' ? '++' : (m[6] ?? '');
      const plain = m[1] === 'P' ? (capture ? (origin ? `${origin[0]}x${sq}` : undefined) : sq) : `${m[1] === 'Kt' ? 'N' : m[1]}${origin ?? ''}${capture ? 'x' : ''}${sq}`;
      out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role: ROLE[m[1]!]!, capture, to: parseSquare(sq)! }, check, marks: m[7] ?? '', plain });
    }
  } else {
    for (const m of text.matchAll(DESCRIPTIVE)) {
      const role = ROLE[m[1]!]!;
      const capture = m[2] === 'x';
      const check = m[7]?.trim() === 'ch' ? '+' : '';
      if (m[4]) {
        const files = DESC_FILES[(m[3] ?? '').replace(/\s+/g, '')];
        if (!files) continue;
        // General advice ("avoid P - K R 3") is written from White's side, as books write it.
        const plain = role === 'pawn' && !capture && files.length === 1 ? `${'abcdefgh'[files[0]!]}${m[4]}` : undefined;
        out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role, capture, files, rank: Number(m[4]) }, check, marks: m[8] ?? '', plain });
      } else if (capture && m[6]) {
        const q = (m[5] ?? '').replace(/\s+/g, '');
        out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role, capture, captured: ROLE[m[6]]!, capturedFiles: q ? DESC_FILES[q] : undefined }, check, marks: m[8] ?? '' });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start).filter((f, i, all) => i === 0 || f.start >= all[i - 1]!.end);
}

function legalMoves(pos: Chess): NormalMove[] {
  const out: NormalMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from)!;
      const promo = piece.role === 'pawn' && (squareRank(to) === 0 || squareRank(to) === 7);
      out.push(promo ? { from, to, promotion: 'queen' } : { from, to });
    }
  }
  return out;
}

function fits(pos: Chess, m: NormalMove, spec: Spec): boolean {
  const piece = pos.board.get(m.from)!;
  const target = pos.board.get(m.to);
  const castle = piece.role === 'king' && (Math.abs(squareFile(m.to) - squareFile(m.from)) > 1 || (target?.color === piece.color && target.role === 'rook'));
  if (spec.kind === 'castle') return castle && (squareFile(m.to) < squareFile(m.from)) === spec.long;
  if (castle || piece.role !== spec.role) return false;
  const enPassant = piece.role === 'pawn' && squareFile(m.to) !== squareFile(m.from) && !target;
  const captured: Role | undefined = enPassant ? 'pawn' : target && target.color !== piece.color ? target.role : undefined;
  if (spec.capture !== !!captured) return false;
  if (spec.to !== undefined) return m.to === spec.to;
  if (spec.captured) return captured === spec.captured && (!spec.capturedFiles || spec.capturedFiles.includes(squareFile(m.to)));
  const rank = piece.color === 'white' ? spec.rank! - 1 : 8 - spec.rank!;
  return squareRank(m.to) === rank && spec.files!.includes(squareFile(m.to));
}

/** The one legal move the written move names in this position, its check agreeing with the book's mark. */
function place(pos: Chess, f: Found): { move: NormalMove; san: string } | null {
  const all = legalMoves(pos).filter((m) => fits(pos, m, f.spec));
  if (all.length !== 1) return null;
  const move = all[0]!;
  const san = makeSan(pos, move as Move);
  if (f.check && !/[+#]$/.test(san)) return null;
  return { move, san };
}

/**
 * A move named in a sentence, not in the game ("threatening Kt x P to follow"), may be either side's;
 * in descriptive notation the square depends on the side. When both sides have a move that fits, the
 * sentence says whose it is: these are those sentences, read once (ADR-064), each checked by a test.
 */
const PROSE_SIDE: { lesson: string; phrase: string; side: 'white' | 'black' }[] = [
  { lesson: 'capablanca-opening-strategy', phrase: 'Bishop for Knight with Kt x P to follow', side: 'black' },
  { lesson: 'capablanca-opening-strategy', phrase: 'combination to win quickly by Kt - Q 5', side: 'white' },
  { lesson: 'capablanca-control-of-centre', phrase: 'To prevent Kt - Q 5', side: 'white' },
];

/** The position with the other side to move (a null move): to read a move named for the side that just moved. */
function flipped(pos: Chess): Chess | null {
  const fen = makeFen(pos.toSetup()).split(' ');
  fen[1] = fen[1] === 'w' ? 'b' : 'w';
  fen[3] = '-';
  return fromFen(fen.join(' '));
}

function fromFen(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : pos.value;
}

/** A position's place in its game from the FEN's move number: 0 before White's first move, 1 before Black's, … */
function plyOf(fen: string): number {
  const parts = fen.split(' ');
  return 2 * ((Number(parts[5] ?? 1) || 1) - 1) + (parts[1] === 'b' ? 1 : 0);
}

/** The ply named by a move number written just before a move ("(2) ", "2. ", "1 ", "(2) ...., ", "5..."). */
function numberBefore(text: string, at: number): number | null {
  const before = text.slice(Math.max(0, at - 60), at);
  const m = before.match(/(?:\(\s*(\d+)\s*\)|(?:^|[\s;,(])(\d+)\s*(\.*))\s*(\.{3,8}\s*,?\s*)?$/);
  if (!m) return null;
  const dots = (m[3] ?? '').length;
  if (m[2] && dots === 0) {
    // A bare number is a move number unless it is the square of the move before ("Kt - K B 3   P - Q 3").
    const head = before.slice(0, m.index! + m[0].indexOf(m[2])).trimEnd();
    if (/(?:^|\s)(?:K|Q|B|R|Kt|[KQ] ?(?:B|R|Kt))$|\d$/.test(head)) return null;
  }
  const n = Number(m[1] ?? m[2]);
  if (!(n >= 1 && n <= 80)) return null;
  return 2 * (n - 1) + (m[4] || dots >= 3 ? 1 : 0);
}

/** Inside a parenthesis that is not a move number: an aside, never the game. */
function aside(text: string, at: number): boolean {
  const open = text.lastIndexOf('(', at);
  if (open < 0 || text.lastIndexOf(')', at) > open) return false;
  return !/^\(\s*\d+\s*\)?$/.test(text.slice(open, at).trim());
}

export interface Unresolved { step: number; token: string; text: string }
/** A move placed in a position: the review record (every placed move is checked by a test). */
export interface Placed { step: number; token: string; san: string; fen: string }

const cache = new WeakMap<Lesson, { lesson: Lesson; unresolved: Unresolved[]; placed: Placed[] }>();

/** The lesson with its moves in modern notation, the moves left as printed, and every move placed. */
export function modernLesson(lesson: Lesson): { lesson: Lesson; unresolved: Unresolved[]; placed: Placed[] } {
  const hit = cache.get(lesson);
  if (hit) return hit;
  const dialect = lesson.sourceId.startsWith('capablanca') ? 'descriptive' : 'lasker';
  const anchors = lesson.steps.flatMap((s) => (s.type === 'text' ? [] : [s.fen, ...('diagramFen' in s && typeof s.diagramFen === 'string' ? [s.diagramFen] : [])]));
  let line = new Map<number, Chess>([[0, fromFen(START)!]]);
  let cur = 0;
  const earlier: Map<number, Chess>[] = [];
  const unresolved: Unresolved[] = [];
  const placed: Placed[] = [];

  /** `question`: the text leads into a question whose position and answer are known. */
  const convert = (text: string, step: number, question?: { fen: string; move: string }): string => {
    const found = find(text, dialect);
    const pieces: string[] = [];
    let last = 0;
    let lastPlacedEnd: number | null = null;
    // "Qxe4 mate": where the book writes the word, the sign is not added as well.
    const written = (san: string, f: Found) => (/^\s*(?:mate|checkmate)\b/i.test(text.slice(f.end)) ? san.replace(/[+#]$/, '') : san) + f.marks;
    let lastTokenEnd: number | null = null;
    found.forEach((f) => {
      // In a move list ("(2) Rxe8+, Qg8;") a move is a game move, never a move named in a sentence.
      const inList = lastTokenEnd !== null && listGap(text.slice(lastTokenEnd, f.start));
      lastTokenEnd = f.end;
      const numbered = numberBefore(text, f.start);
      // Asides in brackets between two moves do not break the game: "R-h5 (threatening Qxh7), Pxh5".
      const continues = numbered === null && lastPlacedEnd !== null && listGap(text.slice(lastPlacedEnd, f.start));
      const isAside = aside(text, f.start);
      // The narrated positions this move may stand in, in order; the first where it fits is taken.
      const candidates: { pos: Chess; ply: number; from: 'line' | 'other' }[] = [];
      if (!isAside) {
        if (numbered !== null) {
          const inLine = line.get(numbered);
          if (inLine) candidates.push({ pos: inLine, ply: numbered, from: 'line' });
          for (const old of [...earlier].reverse()) {
            const p = old.get(numbered);
            if (p) candidates.push({ pos: p, ply: numbered, from: 'other' });
          }
          for (const fen of anchors) {
            const p = plyOf(fen) === numbered ? fromFen(fen) : null;
            if (p) candidates.push({ pos: p, ply: numbered, from: 'other' });
          }
        } else if (continues) {
          const p = line.get(cur);
          if (p) candidates.push({ pos: p, ply: cur, from: 'line' });
        }
      }
      let at: { pos: Chess; ply: number; from: 'line' | 'other' } | null = null;
      let got: { move: NormalMove; san: string } | null = null;
      for (const c of candidates) {
        got = place(c.pos, f);
        if (got) {
          at = c;
          break;
        }
      }
      // In the lead-in to a question: the move that leads to the question's position, or the question's
      // own answer — both checked exactly against the question's board.
      if (!got && !isAside && question) {
        const target = question.fen.split(' ').slice(0, 2).join(' ');
        const qpos = fromFen(question.fen);
        const own = qpos ? place(qpos, f) : null;
        const uci = (m: NormalMove) => `${'abcdefgh'[squareFile(m.from)]}${squareRank(m.from) + 1}${'abcdefgh'[squareFile(m.to)]}${squareRank(m.to) + 1}`;
        if (own && uci(own.move) === question.move.slice(0, 4)) got = own;
        else {
          for (const l of [line, ...[...earlier].reverse()]) {
            for (const [ply, pos] of l) {
              for (const m of legalMoves(pos).filter((x) => fits(pos, x, f.spec))) {
                const after = pos.clone();
                after.play(m as Move);
                if (makeFen(after.toSetup()).split(' ').slice(0, 2).join(' ') === target) {
                  got = { move: m, san: makeSan(pos, m as Move) };
                  at = { pos, ply, from: 'other' };
                  break;
                }
              }
              if (got) break;
            }
            if (got) break;
          }
        }
        if (got && !at) {
          const out = written(got.san, f);
          placed.push({ step, token: text.slice(f.start, f.end), san: got.san, fen: question.fen });
          pieces.push(text.slice(last, f.start), out);
          last = f.end;
          lastPlacedEnd = null;
          return;
        }
      }
      let out: string | null = null;
      if (!got && !isAside && numbered === null && !continues && !inList) {
        // A move named in a sentence: the side to move or the other; if both could, the sentence says.
        const here = line.get(cur);
        const other = here ? flipped(here) : null;
        const mine = here ? place(here, f) : null;
        const theirs = other ? place(other, f) : null;
        const said = PROSE_SIDE.find((p) => p.lesson === lesson.id && text.includes(p.phrase) && p.phrase.includes(text.slice(f.start, f.end)));
        let g: { move: NormalMove; san: string } | null = null;
        let now: Chess | null = null;
        if (said) [g, now] = said.side === here?.turn ? [mine, here] : [theirs, other];
        else if (mine && !theirs) [g, now] = [mine, here!];
        else if (theirs && !mine) [g, now] = [theirs, other];
        else if (mine && theirs && mine.san === theirs.san) [g, now] = [mine, here!];
        if (g && now) {
          placed.push({ step, token: text.slice(f.start, f.end), san: g.san, fen: makeFen(now.toSetup()) });
          pieces.push(text.slice(last, f.start), written(g.san, f));
          last = f.end;
          return;
        }
      }
      if (got && at) {
        out = written(got.san, f);
        placed.push({ step, token: text.slice(f.start, f.end), san: got.san, fen: makeFen(at.pos.toSetup()) });
        const after = at.pos.clone();
        after.play(got.move as Move);
        if (at.from === 'other') {
          earlier.push(line);
          line = new Map([[at.ply, at.pos]]);
        } else if (line.has(at.ply + 1)) {
          // Another move at the same point (an alternative): a branch; the main line is kept for later.
          earlier.push(line);
          const keep = at.ply;
          line = new Map([...line].filter(([p]) => p <= keep));
        }
        line.set(at.ply + 1, after);
        cur = at.ply + 1;
        lastPlacedEnd = f.end;
      } else {
        if (!isAside) lastPlacedEnd = null;
        if (f.plain) out = f.plain + (f.check ? '+' : '') + f.marks;
        else unresolved.push({ step, token: text.slice(f.start, f.end), text: text.slice(Math.max(0, f.start - 40), f.end + 20) });
      }
      if (out !== null) {
        pieces.push(text.slice(last, f.start), out);
        last = f.end;
      }
    });
    pieces.push(text.slice(last));
    return pieces.join('');
  };

  const follow = (fen: string, moves: string[] = []) => {
    let pos = fromFen(fen);
    if (!pos) return;
    let ply = plyOf(fen);
    for (const uci of moves) {
      const m = legalMoves(pos).find((x) => `${'abcdefgh'[squareFile(x.from)]}${squareRank(x.from) + 1}${'abcdefgh'[squareFile(x.to)]}${squareRank(x.to) + 1}` === uci.slice(0, 4));
      if (!m) break;
      pos = pos.clone();
      pos.play(m as Move);
      ply++;
    }
    earlier.push(line);
    line = new Map([[ply, pos]]);
    cur = ply;
  };
  const steps: LessonStep[] = lesson.steps.map((s, i) => {
    if (s.type === 'text') return { ...s, paragraphs: s.paragraphs.map((p) => convert(p, i)) };
    if (s.type === 'board') {
      follow(s.fen);
      return s;
    }
    const before = s.before?.map((p) => convert(p, i, s.moves[0] ? { fen: s.fen, move: s.moves[0] } : undefined));
    // The question's own moves happen before the text that follows it.
    follow(s.fen, s.moves);
    // The text after it may name the answer just played ("Q - Q Kt 3 wins a Pawn."): the same check.
    return { ...s, ...(before ? { before } : {}), after: s.after.map((p) => convert(p, i, s.moves[0] ? { fen: s.fen, move: s.moves[0] } : undefined)) };
  });
  const result = { lesson: { ...lesson, steps, ...(unresolved.length === 0 ? { notationNote: undefined } : {}) }, unresolved, placed };
  cache.set(lesson, result);
  return result;
}
