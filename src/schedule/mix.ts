/**
 * One-button practice: what to put in front of the learner next, so that he does not have to
 * choose and cannot tell in advance what kind of thing is coming.
 *
 * Kinds of material, drawn by weight from those that have something to offer (mix-v2, the
 * shares the outside reviewer proposed as starting defaults, not as proven optima):
 *   review 25 : something missed before that is due again;
 *   move   25 : "your move": he plays his own move in an ordinary position from his games and
 *               is told what can now be taken (the check he does not yet make);
 *   safe   15 : "is this move safe?" about a move that was played in his games;
 *   chance 10 : "is there something here?" from his own games;
 *   missed  5 : a position from his own games where one move was clearly best and he played another;
 *   puzzle 20 : an unseen position with no hint of its theme, half the time on what is being
 *               learned now, half on concepts already studied.
 * The same kind never comes three times running while another is available. A run ends
 * naturally after MIX_MINUTES of practice, at the end of an item, with the offer of a few more.
 */
import type { ReviewState } from '../db/types';

export type MixKind = 'review' | 'move' | 'safe' | 'chance' | 'missed' | 'puzzle';
export const MIX_VERSION = 'mix-v3';
export const MIX_WEIGHTS: Record<MixKind, number> = { review: 25, move: 25, safe: 15, chance: 10, missed: 5, puzzle: 20 };
export const MIX_MINUTES = 20;
export const MIX_EXTRA_MINUTES = 5;
const MAX_RUN = 2;

export function nextMixKind(available: Record<MixKind, boolean>, history: MixKind[], rnd: () => number): MixKind | null {
  let kinds = (Object.keys(MIX_WEIGHTS) as MixKind[]).filter((k) => available[k]);
  if (kinds.length === 0) return null;
  const tail = history.slice(-MAX_RUN);
  if (tail.length === MAX_RUN && tail.every((k) => k === tail[0]) && kinds.some((k) => k !== tail[0])) kinds = kinds.filter((k) => k !== tail[0]);
  const total = kinds.reduce((t, k) => t + MIX_WEIGHTS[k], 0);
  let x = rnd() * total;
  for (const k of kinds) {
    x -= MIX_WEIGHTS[k];
    if (x < 0) return k;
  }
  return kinds[kinds.length - 1]!;
}

const RANK: [string, number][] = [['move:', 0], ['sense:', 0], ['game:', 0], ['lesson:', 1], ['opening:', 2], ['kpk:', 3]];
const rankOf = (id: string) => RANK.find(([p]) => id.startsWith(p))?.[1] ?? 4;

/**
 * Due items in the order they are worth the learner's limited review minutes: positions from
 * his own games first (that is where his rating is lost), then lesson examples, repertoire
 * moves, endings and puzzles; the longest overdue first within each group.
 */
export function reviewOrder(due: ReviewState[]): ReviewState[] {
  return due.slice().sort((a, b) => rankOf(a.itemId) - rankOf(b.itemId) || a.due - b.due || (a.itemId < b.itemId ? -1 : 1));
}
