/**
 * Opening names by position (ADR-062), from the Lichess `chess-openings` dataset (CC0-1.0),
 * built by pipeline/trainer_pipeline/opening_names.py into a static, precached file. Names only.
 */
import { applyUci, fenOf, positionFromFen, positionKey } from '../chess/rules';

export interface OpeningNames {
  manifest: { id: string; version: string; source: { url: string; commit: string; license: string }; counts: { names: number; positions: number } };
  names: string[];
  /** positionKey → index into `names`. */
  positions: Record<string, number>;
}

export interface Opening {
  /** "Italian Game: Giuoco Piano". */
  name: string;
  /** The part before the colon: "Italian Game". */
  family: string;
  /** Plies played to reach the named position. */
  ply: number;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** A game's opening is looked for in its first 40 plies. */
export const OPENING_PLIES = 40;

export const familyOf = (name: string) => name.split(':')[0]!.trim();

/**
 * The deepest named position among the first plies of a game, as the dataset advises ("play
 * moves backwards until a named position is found"), so a transposition is named too.
 * Null when no position of the game is named (the start position is not).
 */
export function openingOf(moves: string[], names: OpeningNames, maxPlies = OPENING_PLIES): Opening | null {
  let pos;
  try {
    pos = positionFromFen(START);
  } catch {
    return null;
  }
  let found: Opening | null = null;
  for (let i = 0; i < Math.min(moves.length, maxPlies); i++) {
    try {
      pos = applyUci(pos, moves[i]!);
    } catch {
      break;
    }
    const at = names.positions[positionKey(fenOf(pos))];
    if (at !== undefined) {
      const name = names.names[at]!;
      found = { name, family: familyOf(name), ply: i + 1 };
    }
  }
  return found;
}

let cache: Promise<OpeningNames | null> | null = null;

/** The names file; null when it is not on the device. A failed load is tried again next time. */
export function loadOpeningNames(): Promise<OpeningNames | null> {
  if (!cache) {
    const attempt: Promise<OpeningNames | null> = fetch('./packs/opening-names.json')
      .then((r) => (r.ok ? (r.json() as Promise<OpeningNames>) : null))
      .then((b) => (b && b.positions && b.names ? b : null))
      .catch(() => null);
    cache = attempt;
    void attempt.then((b) => {
      if (!b && cache === attempt) cache = null;
    });
  }
  return cache;
}
