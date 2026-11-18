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

/**
 * "Your move" positions that are owed (ADR-060): put on screen, left without an answer, and
 * not asked since in any form. The practice audit of 17 November found 9 of the owner's 56
 * such positions gone this way, each one the position on screen when he stopped for the day:
 * shown for a second, recorded as seen, and never asked again. A position that was only
 * glimpsed is not used up. It is asked again, first, the next time one is due; the answer is
 * marked `shown-before` and kept out of the timed comparison, where only first looks count.
 */
export function owedMoves(attempts: Pick<Attempt, 'exerciseId' | 'exerciseKind' | 'themes'>[]): Set<string> {
  const left = new Map<string, string>();
  const asked = new Set<string>();
  for (const a of attempts) {
    const p = positionOf(a.exerciseId);
    if (!p) continue;
    if (a.exerciseKind === 'own-move' && a.themes.includes('left')) left.set(p, a.exerciseId);
    else asked.add(p);
  }
  return new Set([...left].filter(([p]) => !asked.has(p)).map(([, id]) => id));
}

/**
 * The "Your move" positions that can be asked now, oldest game first as they are given: those
 * owed (see owedMoves) and those never met in any exercise. `shownNow` are exercise ids
 * already put on screen in this sitting, answered or not: none of them is asked again in it.
 */
export function movesToAsk<T extends { id: string; gameId: string; ply: number }>(items: T[], attempts: Pick<Attempt, 'exerciseId' | 'exerciseKind' | 'themes'>[], shownNow: Iterable<string> = []): { owed: T[]; fresh: T[] } {
  const now = new Set(shownNow);
  const owedIds = owedMoves(attempts);
  const met = seenPositions([...attempts, ...[...now].map((exerciseId) => ({ exerciseId }))]);
  const open = items.filter((m) => !now.has(m.id));
  return {
    owed: open.filter((m) => owedIds.has(m.id)),
    fresh: open.filter((m) => !owedIds.has(m.id) && !met.has(`${m.gameId}:${m.ply}`)),
  };
}
