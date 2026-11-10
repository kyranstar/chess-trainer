/**
 * One-button practice: what to put in front of the learner next, so that he does not have to
 * choose and cannot tell in advance what kind of thing is coming.
 *
 * Four kinds of material are mixed by weight:
 *   review  : something due again (missed before);
 *   sense   : a question from his own games ("is this move safe?", "is there something here?");
 *   missed  : a position from his own games where one move was clearly best and he played another;
 *   puzzle  : an unseen position on the concept with the least evidence so far, with no hint
 *             of the theme.
 * The same kind never comes three times running while another is available. The weights are
 * a first policy (v1): a third each to what was missed, to his own games, and to new
 * positions. They are constants here so a change is one edit and one test.
 */
import type { ReviewState } from '../db/types';

export type MixKind = 'review' | 'sense' | 'missed' | 'puzzle';
export const MIX_VERSION = 'mix-v1';
export const MIX_WEIGHTS: Record<MixKind, number> = { review: 3, sense: 3, puzzle: 3, missed: 1 };
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

const RANK: [string, number][] = [['sense:', 0], ['game:', 0], ['lesson:', 1], ['opening:', 2], ['kpk:', 3]];
const rankOf = (id: string) => RANK.find(([p]) => id.startsWith(p))?.[1] ?? 4;

/**
 * Due items in the order they are worth the learner's limited review minutes: positions from
 * his own games first (that is where his rating is lost), then lesson examples, repertoire
 * moves, endings and puzzles; the longest overdue first within each group.
 */
export function reviewOrder(due: ReviewState[]): ReviewState[] {
  return due.slice().sort((a, b) => rankOf(a.itemId) - rankOf(b.itemId) || a.due - b.due || (a.itemId < b.itemId ? -1 : 1));
}
