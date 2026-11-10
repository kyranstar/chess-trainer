/** A second, lazily started engine for checking a single position while the learner waits. */
import { browserEngine, type UciEngine, winPercent } from './uci';

let engine: UciEngine | null = null;
let chain: Promise<unknown> = Promise.resolve();

/**
 * The engine's best line for the side to move in `fen` with its expected score (0-100) for
 * that side, or null if the engine is not available or does not answer in time. Never throws.
 */
export function bestLineFor(fen: string, nodes = 40_000, timeoutMs = 8_000): Promise<{ wp: number; pv: string[] } | null> {
  const job = chain.then(async () => {
    try {
      engine ??= browserEngine();
      const lines = await Promise.race([
        engine.analyse(fen, nodes, 1),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return lines && lines[0] ? { wp: winPercent(lines[0].score), pv: lines[0].pv } : null;
    } catch {
      return null;
    }
  });
  chain = job.catch(() => null);
  return job;
}

/**
 * Expected score (0-100) for the side to move in `fen`, or null if the engine is not
 * available or does not answer in time. Callers treat null as "unverified".
 */
export async function evaluateForSideToMove(fen: string, nodes = 40_000, timeoutMs = 8_000): Promise<number | null> {
  return (await bestLineFor(fen, nodes, timeoutMs))?.wp ?? null;
}
