/**
 * A position from the learner's own games is one thing to learn, whichever exercise asks
 * about it. Four exercises draw on the same positions: "Your move" (`move:`), the missed-move
 * drill (`game:`), "is this move safe?" and "is there something to win?" (`sense:`). Each
 * used its own id, so each kept its own review schedule and its own idea of what had been
 * seen: the second practice audit found one position asked five times in 45 hours under
 * three of them. Here they are one item.
 */
import type { Attempt } from '../db/types';

const OWN = /^(move|game|sense:safe-or-not|sense:chance-or-not):([^:]+):(\d+)$/;
const FORMS = ['move', 'game', 'sense:safe-or-not', 'sense:chance-or-not'];

/** "<gameId>:<ply>" for an exercise on a position from the learner's own games; null for anything else. */
export function positionOf(exerciseId: string): string | null {
  const m = OWN.exec(exerciseId);
  return m ? `${m[2]}:${m[3]}` : null;
}

/** What a review schedule is kept under: the position for own-game exercises, the exercise itself otherwise. */
export function reviewKey(exerciseId: string): string {
  const p = positionOf(exerciseId);
  return p ? `pos:${p}` : exerciseId;
}

/** Every id under which the same thing can have been asked (the exercise's own id included). */
export function sameItemIds(exerciseId: string): string[] {
  const p = positionOf(exerciseId);
  return p ? FORMS.map((f) => `${f}:${p}`) : [exerciseId];
}

/** Positions from the learner's games that have been put in front of him, in any form. */
export function seenPositions(attempts: Pick<Attempt, 'exerciseId'>[]): Set<string> {
  const out = new Set<string>();
  for (const a of attempts) {
    const p = positionOf(a.exerciseId);
    if (p) out.add(p);
  }
  return out;
}
