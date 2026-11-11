/**
 * A repertoire without typing it in, and without copying anyone's course.
 *
 * The owner studies opening courses on Chessreps and asked for those lines to be imported.
 * Chessreps' terms forbid copying its content, collecting it with automated tools, and using
 * it to build another product, so nothing is read from there (ADR-046). Two sources that are
 * the learner's own or open are used instead:
 *
 *   1. His own games: in each position that his chosen moves lead to, the move he has played
 *      most, if he has played it at least twice. What he learned in a course shows up here
 *      because he plays it.
 *   2. For the positions he will meet most often and has no move for: the sound move most
 *      played by players of his rating in the open Lichess game data, checked by the engine.
 *      Marked as a suggestion; it is statistics and an engine check, not a course.
 *
 * Neither ever replaces a move he recorded himself, and a habit that the engine check rates
 * clearly below the best move is not taken over: it is listed for him instead.
 */
import { applyUci, canonicalUci, fenOf, isLegalUci, positionFromFen, positionKey, sanOf } from '../chess/rules';
import { classifyMove, type Decision, entryId, makeEntry, type OpeningBook, type RepertoireEntry, type Side, START_FEN, walkRepertoire } from './repertoire';

export interface GameLine {
  color: Side;
  /** UCI moves from the starting position. */
  moves: string[];
  date: string;
}

export interface Doubtful {
  side: Side;
  positionKey: string;
  path: string[];
  san: string;
  played: number;
  reached: number;
  bestSan?: string;
}

export interface FromGames {
  entries: RepertoireEntry[];
  /** Habits not taken over because the engine check rates them clearly below the best move. */
  doubtful: Doubtful[];
}

export const FROM_GAMES_DEFAULTS = { maxMyMoves: 10, minGames: 2 };

/** `declined`: ids of entries the learner removed; those positions are left for him to fill. */
export function repertoireFromGames(games: GameLine[], book: OpeningBook | null, existing: RepertoireEntry[], now: number, opts = FROM_GAMES_DEFAULTS, declined: Set<string> = new Set()): FromGames {
  const out: FromGames = { entries: [], doubtful: [] };
  for (const side of ['white', 'black'] as Side[]) {
    const mine = new Map(existing.filter((e) => e.side === side).map((e) => [e.positionKey, e]));
    type Node = { fen: string; path: string[]; lines: { moves: string[]; at: number; date: string }[] };
    let frontier = new Map<string, Node>();
    const reach = (map: Map<string, Node>, fen: string, path: string[], line: Node['lines'][number]) => {
      const key = positionKey(fen);
      const node = map.get(key);
      if (node) node.lines.push(line);
      else map.set(key, { fen, path, lines: [line] });
    };
    // Plays one move of a game from a position; null when the game ends or the move is unreadable.
    const step = (fen: string, path: string[], uci: string | undefined): { fen: string; path: string[] } | null => {
      if (!uci) return null;
      try {
        const pos = positionFromFen(fen);
        if (!isLegalUci(pos, uci)) return null;
        return { fen: fenOf(applyUci(pos, uci)), path: [...path, sanOf(pos, uci)] };
      } catch {
        return null;
      }
    };
    for (const g of games.filter((x) => x.color === side)) {
      if (side === 'white') reach(frontier, START_FEN, [], { moves: g.moves, at: 0, date: g.date });
      else {
        const first = step(START_FEN, [], g.moves[0]);
        if (first) reach(frontier, first.fen, first.path, { moves: g.moves, at: 1, date: g.date });
      }
    }
    for (let myMove = 1; myMove <= opts.maxMyMoves && frontier.size > 0; myMove++) {
      const next = new Map<string, Node>();
      for (const [key, node] of frontier) {
        const pos = positionFromFen(node.fen);
        // What he played here, in the app's one spelling of each move.
        const tally = new Map<string, { n: number; last: string }>();
        for (const line of node.lines) {
          const raw = line.moves[line.at];
          if (!raw || !isLegalUci(pos, raw)) continue;
          const uci = canonicalUci(pos, raw);
          const t = tally.get(uci) ?? { n: 0, last: '' };
          t.n++;
          if (line.date > t.last) t.last = line.date;
          tally.set(uci, t);
        }
        let chosen = mine.get(key)?.uci ?? null;
        if (!chosen) {
          if (declined.has(entryId(side, key))) continue;
          const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : -1))[0];
          if (!top || top[1].n < opts.minGames) continue;
          const reached = [...tally.values()].reduce((t, x) => t + x.n, 0);
          const evidence = book ? classifyMove(book, key, top[0]) : { verdict: 'unknown' as const };
          if (evidence.verdict === 'weaker') {
            out.doubtful.push({ side, positionKey: key, path: node.path, san: sanOf(pos, top[0]), played: top[1].n, reached, ...(evidence.bestSan ? { bestSan: evidence.bestSan } : {}) });
            continue;
          }
          chosen = top[0];
          out.entries.push({ ...makeEntry(side, node.fen, node.path, chosen, now), source: 'own-games', games: { played: top[1].n, reached } });
        }
        // Only the games that went on with the chosen move are followed further.
        const mineStep = step(node.fen, node.path, chosen);
        if (!mineStep) continue;
        for (const line of node.lines) {
          const raw = line.moves[line.at];
          if (!raw || !isLegalUci(pos, raw) || canonicalUci(pos, raw) !== chosen) continue;
          const reply = step(mineStep.fen, mineStep.path, line.moves[line.at + 1]);
          if (reply) reach(next, reply.fen, reply.path, { moves: line.moves, at: line.at + 2, date: line.date });
        }
      }
      frontier = next;
    }
  }
  return out;
}

export const SUGGEST_DEFAULTS = { minReach: 0.01, max: 40 };
/**
 * A suggestion must be within this many points of expected score of the engine's first choice.
 * Tighter than SOUND_MARGIN, which decides whether a move he already plays is left alone: what
 * most players of his rating play is often playable and still not what one would recommend
 * (the popular 5...Nxd5 against the Fried Liver is 8 points below the best move).
 */
export const SUGGEST_MARGIN = 3;

/**
 * Suggested moves for the unanswered positions reached most often at this rating, most
 * frequent first. A suggestion is the move most played in `bands` among those the engine
 * check rates within SUGGEST_MARGIN of its best; where the data has no such move, nothing is
 * suggested. Each one extends the walk, so the next most frequent gap may lie behind it.
 */
/**
 * `skip`: position keys that are left to the learner (a move he removed, a habit not taken over).
 * `leave`: positions where the app has no business suggesting (inside an opening one of his courses covers).
 */
export function suggestForGaps(book: OpeningBook, existing: RepertoireEntry[], side: Side, bands: number[], now: number, opts = SUGGEST_DEFAULTS, skip: Set<string> = new Set(), leave: (gap: Decision) => boolean = () => false): RepertoireEntry[] {
  const added: RepertoireEntry[] = [];
  const noMove = new Set<string>(skip);
  const played = (n: number[]) => bands.reduce((t, i) => t + (n[i] ?? 0), 0);
  while (added.length < opts.max) {
    const walk = walkRepertoire(book, [...existing, ...added], side, bands);
    const gap = walk.gaps.find((d) => d.reach >= opts.minReach && !noMove.has(d.positionKey));
    if (!gap) break;
    if (leave(gap)) {
      noMove.add(gap.positionKey);
      continue;
    }
    const data = book.positions[gap.positionKey];
    const sound = (data?.moves ?? [])
      .filter((m) => m.wp !== undefined && data!.bestWp !== undefined && data!.bestWp - m.wp <= SUGGEST_MARGIN)
      .sort((a, b) => played(b.n) - played(a.n) || (b.wp ?? 0) - (a.wp ?? 0));
    const pick = sound[0];
    if (!pick) {
      noMove.add(gap.positionKey);
      continue;
    }
    added.push({ ...makeEntry(side, gap.fen, gap.path, pick.uci, now), source: 'suggested' });
  }
  return added;
}
