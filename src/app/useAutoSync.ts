import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { TrainerDB } from '../db/db';
import { browserEngine, type UciEngine } from '../engine/uci';
import { DEVICE_NODES } from '../games/analyse';
import { analysePending, type AnalyseProgress, needsMeasure, syncIfDue } from '../games/autosync';
import { browserFetch, type SyncReport } from '../games/chesscom';

export interface SyncState {
  syncing: boolean;
  last: SyncReport | null;
  analysing: AnalyseProgress | null;
  engineError: string | null;
}

let state: SyncState = { syncing: false, last: null, analysing: null, engineError: null };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function useSyncState(): SyncState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

let engine: UciEngine | null = null;
let syncRunning = false;
let forceQueued = false;
let analysisRunning = false;
let analysisAgain = false;

/**
 * Fetching. A forced request ("Refresh now") is never dropped: if a fetch is already under
 * way it runs once more straight after. Fetching does not wait for analysis.
 */
async function syncPart(db: TrainerDB, force: boolean): Promise<void> {
  if (syncRunning) {
    if (force) forceQueued = true;
    return;
  }
  syncRunning = true;
  try {
    let forced = force;
    do {
      forceQueued = false;
      // Offline nothing is asked in the background. A refresh the learner asked for is still
      // attempted, so that the screen can say plainly that Chess.com could not be reached.
      if (navigator.onLine || forced) {
        set({ syncing: true });
        const report = await syncIfDue(db, browserFetch, Date.now(), forced);
        set({ syncing: false, ...(report ? { last: report } : {}) });
      }
      forced = true; // only repeated when a forced request arrived meanwhile
    } while (forceQueued);
  } finally {
    syncRunning = false;
    set({ syncing: false });
  }
}

/** Analysis of games that have none. One run at a time; games that arrive during a run are picked up by a further pass. */
async function analysisPart(db: TrainerDB): Promise<void> {
  if (analysisRunning) {
    analysisAgain = true;
    return;
  }
  analysisRunning = true;
  try {
    do {
      analysisAgain = false;
      const pending = await db.games.filter((g) => needsMeasure(g)).count();
      if (pending === 0) break;
      try {
        engine ??= browserEngine();
        await analysePending(db, engine, {
          nodes: DEVICE_NODES,
          keepGoing: () => document.visibilityState === 'visible',
          onProgress: (p) => set({ analysing: p.done < p.total ? p : null }),
        });
      } catch (e) {
        set({ engineError: (e as Error).message });
        break;
      } finally {
        set({ analysing: null });
      }
    } while (analysisAgain && document.visibilityState === 'visible');
  } finally {
    analysisRunning = false;
  }
}

/** One round: sync if due (or forced), then analyse whatever has no analysis. Safe to call often. */
export async function runSyncRound(db: TrainerDB, force = false): Promise<void> {
  await syncPart(db, force);
  await analysisPart(db);
}

/** Starts a round on launch and whenever the app returns to the foreground or comes back online. */
export function useAutoSync(db: TrainerDB): void {
  const dbRef = useRef(db);
  dbRef.current = db;
  useEffect(() => {
    const kick = () => {
      if (document.visibilityState === 'visible') void runSyncRound(dbRef.current);
    };
    kick();
    document.addEventListener('visibilitychange', kick);
    window.addEventListener('online', kick);
    return () => {
      document.removeEventListener('visibilitychange', kick);
      window.removeEventListener('online', kick);
    };
  }, []);
}
