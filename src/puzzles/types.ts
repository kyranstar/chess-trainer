/** One row of an offline puzzle pack. Field semantics follow the Lichess puzzle CSV. */
export interface Puzzle {
  id: string;
  /** Position BEFORE the opponent's setup move. */
  fen: string;
  /** Space-separated UCI. moves[0] is the opponent's setup move; then solver, reply, ... */
  moves: string;
  rating: number;
  rd: number;
  pop: number;
  plays: number;
  themes: string[];
  /** Path on lichess.org of the source game, e.g. "game/787zsVup/black#48". */
  game: string;
  opening?: string[];
}

export interface PackManifest {
  id: string;
  version: string;
  schema: number;
  file: string;
  bytes: number;
  contentHash: string;
  count: number;
  buildDate: string;
  source: { id: string; title: string; url: string; license: string; rawSha256: string; rawRows: number };
  verification: { engine: string | null; policy: string; limit?: { nodes: number }; checked?: number; passed?: number };
  counts: { byTheme: Record<string, number>; byOpening: Record<string, number>; byBand: Record<string, number> };
}
