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
}

export interface GameAnalysis {
  /** One row per decision the learner made: [ply, expected-score loss, clock seconds or null]. */
  decisions: [number, number, number | null][];
  events: GameEvent[];
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
}
