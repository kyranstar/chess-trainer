/** Own games as produced by pipeline/trainer_pipeline/games.py. */
export type TimeClass = 'rapid' | 'blitz' | 'bullet' | 'daily' | 'unknown';

export interface GameEvent {
  ply: number;
  fen: string;
  played: string;
  playedSan: string;
  best: string;
  bestSan: string;
  bestLine: string;
  bestWp: number;
  secondWp: number | null;
  playedWp: number;
  loss: number;
  clock: number | null;
  opportunity: 'mate' | 'material' | null;
  missed: boolean;
  majorError: boolean;
  errorLabel: 'allows-mate' | 'loses-material' | 'misses-material' | 'unclassified' | null;
  refutation: string | null;
  /** The engine found one clearly best move here, so the position can be drilled. */
  drill: boolean;
  /**
   * Analysis v3: the move allowed an avoidable mate or an avoidable loss of at least two
   * points of material in a short line, whatever it did to the expected score.
   */
  target?: 'mate' | 'material' | null;
}

/**
 * Analysis v3: concrete facts about one decision, independent of the expected-score scale
 * (which flattens out in positions that are already won or lost).
 */
export interface DecisionFact {
  ply: number;
  /** Expected score (0-100) before the move, with best play. */
  wp: number;
  /** Material balance at the end of the short line after the move played, relative to the balance before the move. */
  played: number;
  /** The same for the engine's best line. */
  best: number;
  /** The move played allows mate in three or fewer, and the best move did not. */
  mated?: true;
  /** The best line is a forced mate for the learner. */
  mating?: true;
  /**
   * One of the two lines stops in the middle of an exchange (a capture with the recapture
   * still pending), so its material balance cannot be trusted. Such a decision is neither
   * counted as a target event nor used as a "nothing here" control.
   */
  unsure?: true;
}

export interface GameAnalysis {
  /** One row per decision the learner made: [ply, expected-score loss, clock seconds or null]. */
  decisions: [number, number, number | null][];
  events: GameEvent[];
  /** One per decision, same order as `decisions` (analysis v3 and later). */
  facts?: DecisionFact[];
}

export interface PipelineGame {
  id: string;
  source: string;
  url: string | null;
  date: string;
  endDate: string;
  endTime: string | null;
  timeControl: string;
  timeClass: TimeClass;
  color: 'white' | 'black';
  result: 'win' | 'draw' | 'loss' | null;
  termination: string | null;
  playerRating: number | null;
  opponentRating: number | null;
  opponent: string;
  moves: string[];
  clocks: (number | null)[] | null;
  analysis: GameAnalysis | null;
  /** Present on games read from Chess.com's API; PGN downloads do not say. */
  rated?: boolean;
}

export interface GamesFile {
  manifest: {
    format: 'chess-trainer-games';
    schema: number;
    analysisVersion: string;
    createdAt: string;
    player: string;
    engine: { name: string | null; nodes: number; threads: number; multipv: number } | null;
    rules: { majorLoss: number; missLoss: number; materialSwing: number; pvPlies: number; uniqueGap: number; expectedScore: string };
    counts: Record<string, number>;
  };
  games: PipelineGame[];
}

/** A game as stored in the app, with the provenance of its analysis. */
export interface GameRecord extends PipelineGame {
  importedAt: number;
  updatedAt: number;
  /** "<analysisVersion>/<engine name>/<nodes>": games with different settings are never pooled silently. */
  analysisKey: string | null;
  /** Expected-score loss that counts as a major error in this analysis. */
  majorLoss?: number;
  /**
   * The measurement record: this game analysed on the device with the app's one fixed
   * protocol. `analysis` above is the best analysis available for looking at the game (a
   * deeper Mac run replaces it); this one is never replaced by an import, so numbers
   * compared over time always come from the same engine and settings.
   */
  measure?: GameAnalysis | null;
  measureKey?: string | null;
}
