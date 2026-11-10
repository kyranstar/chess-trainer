/**
 * Test support: loads a games file (the shape of `my-games.fixture.json`) into the database.
 *
 * The app itself has no file import any more: games arrive only from Chess.com's public API
 * and are analysed on the device (ADR-034). This loader remains so that metric and selection
 * tests can start from hand-checked analysed games. It is idempotent by game id, and an
 * analysis with different engine settings replaces the stored one while leaving the device's
 * measurement record alone.
 */
import type { TrainerDB } from '../../db/db';
import type { GameRecord, GamesFile, PipelineGame } from '../types';

export const GAMES_FORMAT = 'chess-trainer-games';
export const GAMES_SCHEMA = 1;

export interface GamesImportReport {
  added: number;
  updated: number;
  unchanged: number;
  analysed: number;
  player: string;
  analysisKey: string | null;
}

export function parseGamesFile(text: string): GamesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it is not an analysed-games file from the Mac pipeline.');
  }
  const f = raw as Partial<GamesFile>;
  if (f?.manifest?.format !== GAMES_FORMAT || !Array.isArray(f.games)) throw new Error('This is not an analysed-games file from the Mac pipeline.');
  if (f.manifest.schema > GAMES_SCHEMA) throw new Error(`This games file uses format ${f.manifest.schema}, which this version of the app cannot read; update the app.`);
  for (const g of f.games as Partial<PipelineGame>[]) {
    if (typeof g.id !== 'string' || !Array.isArray(g.moves) || (g.color !== 'white' && g.color !== 'black') || typeof g.endDate !== 'string') {
      throw new Error('The games file contains a malformed game, so nothing was imported.');
    }
    if (g.analysis && (!Array.isArray(g.analysis.decisions) || !Array.isArray(g.analysis.events))) {
      throw new Error('The games file contains a malformed analysis, so nothing was imported.');
    }
  }
  return f as GamesFile;
}

export function analysisKeyOf(m: GamesFile['manifest']): string | null {
  return m.engine ? `${m.analysisVersion}/${m.engine.name}/${m.engine.nodes}` : null;
}

export async function importGames(db: TrainerDB, text: string, now: number = Date.now()): Promise<GamesImportReport> {
  const file = parseGamesFile(text); // all validation before any write
  const key = analysisKeyOf(file.manifest);
  const report: GamesImportReport = { added: 0, updated: 0, unchanged: 0, analysed: 0, player: file.manifest.player, analysisKey: key };
  await db.transaction('rw', db.games, async () => {
    for (const g of file.games) {
      const mine = await db.games.get(g.id);
      const incomingKey = g.analysis ? key : null;
      if (g.analysis) report.analysed++;
      if (!mine) {
        const row: GameRecord = { ...g, importedAt: now, updatedAt: now, analysisKey: incomingKey, majorLoss: file.manifest.rules.majorLoss };
        await db.games.add(row);
        report.added++;
      } else if (g.analysis && incomingKey !== mine.analysisKey) {
        await db.games.put({ ...mine, ...g, importedAt: mine.importedAt, updatedAt: now, analysisKey: incomingKey, majorLoss: file.manifest.rules.majorLoss });
        report.updated++;
      } else {
        report.unchanged++;
      }
    }
  });
  return report;
}
