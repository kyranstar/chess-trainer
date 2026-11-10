/**
 * Import and export of the learner's own repertoire as PGN (their own file, written by them
 * or exported from a tool that permits it). Nothing here reads from a course provider.
 */
import { parsePgn, startingPosition } from 'chessops/pgn';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { fenOf } from '../chess/rules';
import { makeEntry, pathNumbered, type RepertoireEntry, type Side } from './repertoire';

export interface PgnImport {
  entries: RepertoireEntry[];
  games: number;
  /** Positions for which the file contained two different moves; the first one is kept. */
  conflicts: { path: string[]; kept: string; ignored: string }[];
}

export function entriesFromPgn(text: string, side: Side, now: number): PgnImport {
  const games = parsePgn(text);
  const byKey = new Map<string, RepertoireEntry>();
  const conflicts: PgnImport['conflicts'] = [];
  for (const game of games) {
    const start = startingPosition(game.headers);
    if (start.isErr) throw new Error('A game in this PGN starts from an invalid position.');
    type Frame = { node: (typeof game.moves.children)[number]; pos: typeof start.value; path: string[] };
    const stack: Frame[] = game.moves.children.map((node) => ({ node, pos: start.value.clone(), path: [] })).reverse();
    while (stack.length) {
      const { node, pos, path } = stack.pop()!;
      const move = parseSan(pos, node.data.san);
      if (!move) throw new Error(`Illegal or unreadable move ${node.data.san} after ${pathNumbered(path) || 'the start'}; nothing was imported.`);
      if (pos.turn === side) {
        const entry = makeEntry(side, fenOf(pos), path, makeUci(move), now);
        const seen = byKey.get(entry.positionKey);
        if (!seen) byKey.set(entry.positionKey, entry);
        else if (seen.uci !== entry.uci && !conflicts.some((c) => c.kept === seen.san && c.ignored === entry.san && c.path.join(' ') === seen.path.join(' '))) {
          conflicts.push({ path: seen.path, kept: seen.san, ignored: entry.san });
        }
      }
      const next = pos.clone();
      const san = makeSanAndPlay(next, move);
      for (const child of [...node.children].reverse()) stack.push({ node: child, pos: next.clone(), path: [...path, san] });
    }
  }
  return { entries: [...byKey.values()], games: games.length, conflicts };
}

/** One PGN game per recorded move: the path to the position followed by the chosen move. */
export function repertoireToPgn(entries: RepertoireEntry[], side: Side): string {
  return entries
    .filter((e) => e.side === side)
    .sort((a, b) => a.path.length - b.path.length || (a.path.join(' ') < b.path.join(' ') ? -1 : 1))
    .map((e) => `[Event "Repertoire as ${side}"]\n[Result "*"]\n\n${pathNumbered([...e.path, e.san])} *\n`)
    .join('\n');
}
