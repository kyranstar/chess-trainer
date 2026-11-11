/**
 * The opening courses the learner studies elsewhere, and what follows from them here.
 *
 * The courses are on Chessreps and stay there: their lines are not read, copied or stored
 * (ADR-046, ADR-047). What this file knows about a course is its name, its link, the side it
 * is for, and which opening it is about, written as the moves that define that opening (a
 * fact about the opening's name, not taken from the course).
 *
 * Inside a course's opening the course decides the moves, so the app
 *   - suggests nothing of its own there,
 *   - does not drill a move it inferred from his games until he has confirmed it is his move
 *     (one tap, or by playing a different move on the board), and
 *   - points back to the course: for a position with no move yet, and for games in which he
 *     left a move he had confirmed.
 * That keeps one set of answers: the course's, entered here by him and never by the app.
 */
import { applyUci, fenOf, isLegalUci, positionFromFen, positionKey, sameMove, sanOf } from '../chess/rules';
import { type RepertoireEntry, type Side, START_FEN } from './repertoire';

export interface Course {
  id: string;
  title: string;
  author: string;
  provider: 'Chessreps';
  url: string;
  side: Side;
  /** The moves (SAN, from the start) that define the opening. Decisions after them belong to the course. */
  root: string[];
}

export const COURSES: Course[] = [
  { id: 'italian', title: 'The Italian Game', author: 'GM Wei Yi', provider: 'Chessreps', url: 'https://www.chessreps.com/opening/the-italian-game-oy2wyx0', side: 'white', root: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  // The exact course pages of the next two are not recorded; the link goes to the site, where his courses are listed first.
  { id: 'fried-liver', title: 'Fried Liver Attack', author: 'GM Fidel Corrales', provider: 'Chessreps', url: 'https://www.chessreps.com/', side: 'white', root: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { id: 'caro-kann', title: 'Counter the Caro-Kann', author: 'CM Azel Chua', provider: 'Chessreps', url: 'https://www.chessreps.com/opening/counter-the-caro-kann-qrhk82i', side: 'white', root: ['e4', 'c6'] },
  { id: 'qga', title: 'Queen’s Gambit Accepted', author: 'FM Aleksa Alimpic', provider: 'Chessreps', url: 'https://www.chessreps.com/', side: 'black', root: ['d4', 'd5', 'c4'] },
];

/** The course whose opening a decision lies in (the most specific one), for the side it is for. `path` is one move order to the position. */
export function courseFor(side: Side, path: string[]): Course | null {
  let found: Course | null = null;
  for (const c of COURSES) {
    if (c.side !== side || path.length < c.root.length || !c.root.every((san, i) => path[i] === san)) continue;
    if (!found || c.root.length > found.root.length) found = c;
  }
  return found;
}

/** A move the app put in, inside a course's opening: his to confirm before it is treated as his repertoire move. */
export function needsConfirming(entry: RepertoireEntry): boolean {
  return !!entry.source && !!courseFor(entry.side, entry.path);
}

export interface LeftRepertoire {
  gameId: string;
  date: string;
  side: Side;
  /** Moves up to the position where he left it. */
  path: string[];
  playedSan: string;
  mineSan: string;
  course: Course | null;
}

/**
 * Games in which he played something other than a move he recorded or confirmed himself: the
 * first such move of each game, newest game first. Moves the app inferred say nothing about
 * what he should have played and are ignored.
 */
export function leftRepertoire(games: { id: string; date: string; color: string; moves: string[] }[], entries: RepertoireEntry[], limit = 5): LeftRepertoire[] {
  const mine = new Map(entries.filter((e) => !e.source).map((e) => [e.id, e]));
  const out: LeftRepertoire[] = [];
  for (const g of games) {
    if (g.color !== 'white' && g.color !== 'black') continue;
    const side = g.color as Side;
    let pos = positionFromFen(START_FEN);
    const path: string[] = [];
    for (let ply = 0; ply < Math.min(g.moves.length, 24); ply++) {
      const uci = g.moves[ply]!;
      if (!isLegalUci(pos, uci)) break;
      if (pos.turn === side) {
        const entry = mine.get(`${side}|${positionKey(fenOf(pos))}`);
        if (entry && !sameMove(pos, uci, entry.uci)) {
          out.push({ gameId: g.id, date: g.date, side, path: [...path], playedSan: sanOf(pos, uci), mineSan: entry.san, course: courseFor(side, path) });
          break;
        }
      }
      path.push(sanOf(pos, uci));
      pos = applyUci(pos, uci);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
}
