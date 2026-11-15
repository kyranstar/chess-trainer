/** A second, lazily started engine for checking a single position while the learner waits. */
import { browserEngine, type UciEngine, winPercent } from './uci';

let engine: UciEngine | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** One of the engine's lines from a position: its first move, what follows, and the expected score (0-100) for the side to move. */
export interface EngineLine { uci: string; wp: number; pv: string[]; mate: number | null }

/**
 * The engine's `multipv` best lines for the side to move in `fen`, best first, or null if the
 * engine is not available or does not answer in time. One search at a time. Never throws.
 */
export function linesFor(fen: string, nodes: number, multipv: number, timeoutMs = 8_000): Promise<EngineLine[] | null> {
  const job = chain.then(async () => {
    try {
      engine ??= browserEngine();
      const lines = await Promise.race([
        engine.analyse(fen, nodes, multipv),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!lines) {
        // The search is still running inside the engine; its answer would be taken for the
        // answer to the next position. Start afresh next time.
        engine.terminate();
        engine = null;
        return null;
      }
      return lines.map((l) => ({ uci: l.move, wp: winPercent(l.score), pv: l.pv, mate: 'mate' in l.score ? l.score.mate : null }));
    } catch {
      return null;
    }
  });
  chain = job.catch(() => null);
  return job;
}

/**
 * The engine's best line for the side to move in `fen` with its expected score (0-100) for
 * that side, or null if the engine is not available or does not answer in time. Never throws.
 */
export async function bestLineFor(fen: string, nodes = 40_000, timeoutMs = 8_000): Promise<{ wp: number; pv: string[]; mate: number | null } | null> {
  const first = (await linesFor(fen, nodes, 1, timeoutMs))?.[0];
  return first ? { wp: first.wp, pv: first.pv, mate: first.mate } : null;
}

/**
 * Expected score (0-100) for the side to move in `fen`, or null if the engine is not
 * available or does not answer in time. Callers treat null as "unverified".
 */
export async function evaluateForSideToMove(fen: string, nodes = 40_000, timeoutMs = 8_000): Promise<number | null> {
  return (await bestLineFor(fen, nodes, timeoutMs))?.wp ?? null;
}

/**
 * The engine's first few choices in a position, for showing what else was good after an
 * answer (ADR-054). One search for all of them, so their numbers can be set side by side.
 * The budget is larger than a single line's because it is shared between the lines.
 */
export const OTHER_LINES = 4;
export const OTHER_NODES = 150_000;
const KEPT = 8;
const others = new Map<string, Promise<EngineLine[] | null>>();

/**
 * Asked for when a position appears, so that the answer is there by the time it is wanted,
 * and again when the result is shown: the same search is never run twice. A search that got
 * no answer is forgotten, so that a later ask tries again.
 */
export function otherLinesFor(fen: string): Promise<EngineLine[] | null> {
  const had = others.get(fen);
  if (had) return had;
  const job = linesFor(fen, OTHER_NODES, OTHER_LINES).then((lines) => {
    if (!lines?.length) others.delete(fen);
    // A search stopped by its budget in the middle of a pass can leave two lines out of
    // order; they are shown by their numbers, best first (equal numbers keep the engine's order).
    return lines?.length ? lines.map((l, i) => ({ l, i })).sort((a, b) => b.l.wp - a.l.wp || a.i - b.i).map((x) => x.l) : null;
  });
  others.set(fen, job);
  // Only the last few positions are kept: the one on screen and the one that can be gone back to.
  for (const k of others.keys()) {
    if (others.size <= KEPT) break;
    others.delete(k);
  }
  return job;
}
