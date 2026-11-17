/**
 * What a due position from the learner's own games is asked as when it comes back for review.
 *
 * It comes back in the form it was last answered in (review policy v3, src/schedule/position.ts).
 * That form may no longer exist: an own-game question or a missed-move drill is derived from
 * the game's analysis, and a later rule or a new analysis can withdraw it. The position has
 * not gone anywhere, so it is then asked as "Your move", which needs nothing but the game.
 * Only a game that is not on the device leaves nothing to ask.
 *
 * Before this (owner report, 2026-11-17) a form that could not be rebuilt was announced as
 * "no longer in the installed content pack"; never being answered, it stayed due and was
 * announced again every day.
 */
import { positionOf } from '../schedule/position';
import { type DrillPosition, drillPositions } from './metrics';
import { type MoveItem, moveItemById } from './ownmove';
import { chanceItems, safetyItems, type SenseItem } from './sense';
import type { GameRecord } from './types';

export type OwnReview = { kind: 'sense'; item: SenseItem } | { kind: 'game'; drill: DrillPosition } | { kind: 'move'; item: MoveItem };

/** A question by its id, from every question the games can supply (a review item may predate the "move 7 onwards" rule). */
export function senseItemById(games: GameRecord[], id: string): SenseItem | undefined {
  return [...safetyItems(games), ...chanceItems(games)].find((x) => x.id === id);
}

export function ownGameReview(games: GameRecord[], askId: string): OwnReview | null {
  const position = positionOf(askId);
  if (!position) return null;
  if (askId.startsWith('sense:')) {
    const item = senseItemById(games, askId);
    if (item) return { kind: 'sense', item };
  } else if (askId.startsWith('game:')) {
    const drill = drillPositions(games).find((d) => d.id === askId);
    if (drill) return { kind: 'game', drill };
  }
  const item = moveItemById(games, `move:${position}`);
  return item ? { kind: 'move', item } : null;
}
