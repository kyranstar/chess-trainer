/**
 * Lessons in modern notation (owner, 2026-11-20: "remove that notation stuff and just translate
 * all of the old notation into modern notation if possible"). The lesson files stay as the books
 * print them (their text is checked against the books); what is shown is converted here.
 *
 * Two old styles: Lasker (1918) names squares as today but writes the piece and a dash
 * ("Kt-f3", "P-e4", "Pxe5"); Capablanca (1921) uses descriptive notation ("Kt - K B 3", "P x P").
 * A written move is never guessed: it is matched against the legal moves of the position the
 * text has reached (the game it is narrating, numbered "(2)" or "2.", alternatives at the same
 * number included), or else of a position the lesson shows, and replaced by the one legal move
 * that fits it, written in standard notation with its check or mate. A move that fits no legal
 * move, or more than one, stays as printed and is reported (a test requires none).
 */
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
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

interface Found { start: number; end: number; spec: Spec; marks: string; /** Lasker only: the move written today from its text alone (pieces and pawn advances), when no position places it. */ plain?: string }

const LASKER = /\b(Kt|[KQRBP])\s?([-x])\s?([a-hA-H])([1-8])(\+\+|\+|#)?([?!]*)/g;
const DESCRIPTIVE = /\b(Kt|[KQRBP]) ?([-x]) ?(?:((?:[KQ] ?)?(?:Kt|[BR])?) ?([1-8])|((?:[KQ] ?)?(?:Kt|[BR])? ?)(Kt|[KQRBP])(?![a-z]))((?: ?ch)?)([?!]*)/g;
const CASTLE = /\b([oO0])-\1(-\1)?(\+)?([?!]*)/g;

function find(text: string, dialect: 'lasker' | 'descriptive'): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(CASTLE)) out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'castle', long: !!m[2] }, marks: m[4] ?? '' });
  if (dialect === 'lasker') {
    for (const m of text.matchAll(LASKER)) {
      const sq = `${m[3]!.toLowerCase()}${m[4]}`;
      const check = m[5] ? '+' : '';
      const plain = m[1] === 'P' ? (m[2] === 'x' ? undefined : sq + check) : `${m[1] === 'Kt' ? 'N' : m[1]}${m[2] === 'x' ? 'x' : ''}${sq}${check}`;
      out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role: ROLE[m[1]!]!, capture: m[2] === 'x', to: parseSquare(sq)! }, marks: m[6] ?? '', plain });
    }
  } else {
    for (const m of text.matchAll(DESCRIPTIVE)) {
      const role = ROLE[m[1]!]!;
      const capture = m[2] === 'x';
      if (m[4]) {
        const files = DESC_FILES[(m[3] ?? '').replace(/\s+/g, '')];
        if (!files) continue;
        out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role, capture, files, rank: Number(m[4]) }, marks: m[8] ?? '' });
      } else if (capture && m[6]) {
        const q = (m[5] ?? '').replace(/\s+/g, '');
        out.push({ start: m.index!, end: m.index! + m[0].length, spec: { kind: 'move', role, capture, captured: ROLE[m[6]]!, capturedFiles: q ? DESC_FILES[q] : undefined }, marks: m[8] ?? '' });
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

function match(pos: Chess, spec: Spec): NormalMove | null {
  const all = legalMoves(pos).filter((m) => fits(pos, m, spec));
  return all.length === 1 ? all[0]! : null;
}

function fromFen(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : pos.value;
}

/** The move number written just before a move ("(2) ", "2. ", "1 ", "(2) ...., "), and whether the move is Black's. */
function numberBefore(text: string, at: number): { ply: number } | null {
  const before = text.slice(Math.max(0, at - 24), at);
  const m = before.match(/(?:\(\s*(\d+)\s*\)|(?:^|[\s;(])(\d+)\s*(\.?))\s*(\.{3,4}\s*,?\s*)?$/);
  if (!m) return null;
  // A bare number with no dot or brackets is a move number only when no letter is just before it:
  // in "Kt - K B 3   P - Q 3" the 3 is the square of the move before.
  if (m[2] && !m[3]) {
    const head = before.slice(0, m.index! + m[0].indexOf(m[2])).trimEnd();
    if (/(?:^|\s)(?:K|Q|B|R|Kt|[KQ] ?(?:B|R|Kt))$|[a-h]$|\d$/.test(head)) return null;
  }
  const n = Number(m[1] ?? m[2]);
  if (!(n >= 1 && n <= 80)) return null;
  return { ply: 2 * (n - 1) + (m[4] ? 1 : 0) };
}

/** Inside a parenthesis that is not a move number: an aside, not the game. */
function aside(text: string, at: number): boolean {
  const open = text.lastIndexOf('(', at);
  if (open < 0 || text.lastIndexOf(')', at) > open) return false;
  return !/^\(\s*\d+\s*\)?$/.test(text.slice(open, at).trim());
}

export interface Unresolved { step: number; token: string; text: string }

const cache = new WeakMap<Lesson, { lesson: Lesson; unresolved: Unresolved[]; trace: string[] }>();

/** The lesson with every move it can place written in modern notation, and the moves it could not place. */
export function modernLesson(lesson: Lesson): { lesson: Lesson; unresolved: Unresolved[]; trace: string[] } {
  const hit = cache.get(lesson);
  if (hit) return hit;
  const dialect = lesson.sourceId.startsWith('capablanca') ? 'descriptive' : 'lasker';
  const anchors = [
    ...lesson.steps.flatMap((s) => (s.type === 'text' ? [] : [s.fen, ...('diagramFen' in s && typeof s.diagramFen === 'string' ? [s.diagramFen] : [])])),
    START,
  ];
  // The game the text is narrating: positions by ply.
  let line = new Map<number, Chess>([[0, fromFen(START)!]]);
  let cur = { ply: 0 };
  // Lines the text narrated earlier: a numbered move may return to one after a question or a diagram.
  const earlier: Map<number, Chess>[] = [];
  const unresolved: Unresolved[] = [];
  const trace: string[] = [];

  const convert = (text: string, step: number): string => {
    const found = find(text, dialect);
    const pieces: string[] = [];
    let last = 0;
    for (const f of found) {
      const numbered = numberBefore(text, f.start);
      const ply = numbered?.ply ?? cur.ply;
      // `game`: the move continues the game being narrated, so the narrative follows it. Any other
      // place a move fits (a move named in prose, "better than B-c4") converts it without moving the game.
      const candidates: { pos: Chess; ply: number; fresh: boolean; game: boolean }[] = [];
      const atPly = line.get(ply);
      if (atPly) candidates.push({ pos: atPly, ply, fresh: false, game: true });
      if (numbered) for (const old of [...earlier].reverse()) { const p = old.get(ply); if (p) candidates.push({ pos: p, ply, fresh: true, game: true }); }
      for (const [p, pos] of line) if (p !== ply) candidates.push({ pos, ply: p, fresh: false, game: false });
      for (const fen of anchors) {
        const pos = fromFen(fen);
        if (pos) candidates.push({ pos, ply: numbered?.ply ?? (pos.turn === 'white' ? 0 : 1), fresh: true, game: !!numbered });
      }
      let done = false;
      for (const c of candidates) {
        const m = match(c.pos, f.spec);
        if (!m) continue;
        const san = makeSan(c.pos, m as Move);
        trace.push(`${text.slice(f.start, f.end)} -> ${san} @${c.ply}${c.fresh ? ' fresh' : ''}${aside(text, f.start) ? ' aside' : ''}`);
        // A move mentioned in passing ("(threatening Qxh7)") does not move the game on.
        if (c.game && !aside(text, f.start)) {
          const after = c.pos.clone();
          after.play(m as Move);
          if (c.fresh) {
            earlier.push(line);
            line = new Map([[c.ply, c.pos]]);
          } else if (line.has(c.ply + 1) && line.get(c.ply) === c.pos) {
            // Another move at the same point (an alternative): a branch, the main line kept for later.
            earlier.push(line);
            line = new Map([...line].filter(([p]) => p <= c.ply));
          }
          line.set(c.ply + 1, after);
          cur = { ply: c.ply + 1 };
        }
        pieces.push(text.slice(last, f.start), san + f.marks);
        last = f.end;
        done = true;
        break;
      }
      if (!done && f.plain) {
        pieces.push(text.slice(last, f.start), f.plain + f.marks);
        last = f.end;
        done = true;
      }
      if (!done) unresolved.push({ step, token: text.slice(f.start, f.end), text: text.slice(Math.max(0, f.start - 40), f.end + 20) });
    }
    pieces.push(text.slice(last));
    return pieces.join('');
  };

  const follow = (pos: Chess | null) => {
    if (!pos) return;
    const ply = pos.turn === 'white' ? 0 : 1;
    earlier.push(line);
    line = new Map([[ply, pos]]);
    cur = { ply };
  };
  const steps: LessonStep[] = lesson.steps.map((s, i) => {
    if (s.type === 'text') return { ...s, paragraphs: s.paragraphs.map((p) => convert(p, i)) };
    if (s.type === 'board') {
      follow(fromFen(s.fen));
      return s;
    }
    if (s.type === 'try') {
      const before = s.before?.map((p) => convert(p, i));
      // The question's own moves happen before the text that follows it.
      let pos = fromFen(s.fen);
      for (const uci of s.moves) {
        if (!pos) break;
        const m = legalMoves(pos).find((x) => `${'abcdefgh'[squareFile(x.from)]}${squareRank(x.from) + 1}${'abcdefgh'[squareFile(x.to)]}${squareRank(x.to) + 1}` === uci.slice(0, 4));
        if (!m) break;
        pos.play(m as Move);
      }
      follow(pos);
      return { ...s, ...(before ? { before } : {}), after: s.after.map((p) => convert(p, i)) };
    }
    return s;
  });
  const result = { lesson: { ...lesson, steps, ...(unresolved.length === 0 ? { notationNote: undefined } : {}) }, unresolved, trace };
  cache.set(lesson, result);
  return result;
}
