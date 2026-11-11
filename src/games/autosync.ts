/**
 * The no-manual-steps loop: when the app is open and a Chess.com username is set, it asks
 * the public API for ratings and new games every few hours, and analyses any game that has
 * no analysis yet with the in-app engine, a game at a time, only while the app is visible.
 */
import { getMeta, type TrainerDB } from '../db/db';
import type { GameRecord } from './types';
import { analyseGame, ANALYSIS_VERSION, analysisKeyFor, type Evaluator, RULES } from './analyse';
import { type SyncFetch, type SyncReport, syncChessCom } from './chesscom';

export const SYNC_EVERY_MS = 3 * 60 * 60 * 1000;
/** After a "too many requests" answer, automatic refreshes wait this long. */
export const RATE_LIMIT_WAIT_MS = 60 * 60 * 1000;
/** Username baked into the published build by the deploy script (from the git-ignored `data/deploy.env`); empty in every other build. It can be changed in the app. */
export const DEFAULT_USERNAME: string = (import.meta.env?.VITE_CHESSCOM_USERNAME as string | undefined) ?? '';

export async function getUsername(db: TrainerDB): Promise<string> {
  const stored = await getMeta<string>(db, 'chesscom.username');
  return (stored ?? DEFAULT_USERNAME).trim();
}

/** Runs a sync if a username is set and the last successful one is old enough. */
export async function syncIfDue(db: TrainerDB, fetcher: SyncFetch, now: number = Date.now(), force = false): Promise<SyncReport | null> {
  const username = await getUsername(db);
  if (!username) return null;
  const last = await getMeta<{ at: number; status: string }>(db, 'chesscom.lastSync');
  if (!force && last?.status === 'ok' && now - last.at < SYNC_EVERY_MS) return null;
  // Chess.com asked us to slow down: do not ask again on every launch.
  if (!force && last?.status === 'rate-limited' && now - last.at < RATE_LIMIT_WAIT_MS) return null;
  return syncChessCom(db, fetcher, username, now);
}

export interface AnalyseProgress {
  done: number;
  total: number;
}

/** True while a game has no measurement record under the current analysis version. */
export function needsMeasure(g: Pick<GameRecord, 'measure' | 'measureKey' | 'timeClass' | 'moves'>): boolean {
  return g.timeClass !== 'unknown' && g.moves.length > 0 && !(g.measure && (g.measureKey ?? '').startsWith(`${ANALYSIS_VERSION}/`));
}

/**
 * Gives every game its measurement record (the app's one fixed analysis), newest first.
 * A game that has no other analysis also gets this one as the analysis to look at; a deeper
 * analysis imported from the Mac is left in place for that purpose. Returns how many games
 * were completed.
 */
export async function analysePending(
  db: TrainerDB,
  engine: Evaluator & { name: string; newGame?: () => Promise<void> | void },
  opts: { nodes?: number; keepGoing?: () => boolean; onProgress?: (p: AnalyseProgress) => void; startTimeoutMs?: number } = {},
): Promise<number> {
  // The engine reports its name only once it has started; the record is labelled with it.
  // If it never starts (its files failed to load) this says so instead of waiting for ever.
  const started = await Promise.race([
    Promise.resolve(engine.newGame?.()).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), opts.startTimeoutMs ?? 30_000)),
  ]);
  if (!started) throw new Error('the built-in engine did not start');
  const key = analysisKeyFor(engine.name, opts.nodes ?? 0);
  const pending = (await db.games.toArray())
    .filter((g) => needsMeasure(g) || (g.timeClass !== 'unknown' && g.moves.length > 0 && g.measureKey !== key))
    .sort((a, b) => (a.endDate + (a.endTime ?? '') < b.endDate + (b.endTime ?? '') ? 1 : -1));
  let done = 0;
  opts.onProgress?.({ done, total: pending.length });
  for (const game of pending) {
    // Clear the engine's memory first: otherwise a game's analysis depends on what happened to
    // be analysed before it, and the same game would not get the same record twice.
    await engine.newGame?.();
    let analysis;
    try {
      analysis = await analyseGame(game, engine, { nodes: opts.nodes, keepGoing: opts.keepGoing });
    } catch {
      continue; // the engine gave no line somewhere: this game stays unmeasured and is tried again another time
    }
    if (!analysis) break; // stopped: this game is retried from its start next time
    await db.transaction('rw', db.games, async () => {
      // Re-read: the row may have changed meanwhile (an import from the Mac, a newer sync).
      const current = await db.games.get(game.id);
      if (!current) return;
      const fromDevice = !current.analysis || current.analysisKey == null || current.analysisKey === current.measureKey || current.analysisKey.split('/')[1] === engine.name;
      await db.games.put({
        ...current,
        measure: analysis,
        measureKey: key,
        ...(fromDevice ? { analysis, analysisKey: key, majorLoss: RULES.majorLoss } : {}),
        updatedAt: Date.now(),
      });
    });
    done++;
    opts.onProgress?.({ done, total: pending.length });
  }
  return done;
}
