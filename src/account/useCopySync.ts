/**
 * Keeps the account copy in step (ADR-063), out of sight: the account's copy is merged in
 * when the app opens, comes to the front or gets a connection back; this device's data is
 * sent when it has changed, at most every two minutes while the app is in use, and at once
 * when the app is sent to the background. What went wrong, if anything, is kept for the
 * Account page (`copy.error`); nothing interrupts practice.
 */
import { useEffect, useRef } from 'react';
import { setMeta, type TrainerDB } from '../db/db';
import { REMOTE_MIN_INTERVAL_MS } from '../db/remote';
import type { AccountInfo } from './context';
import { COPY_AT, COPY_ERROR, hasNoPractice, pullCopy, pushCopy } from './copy';

const TICK_MS = 30_000;

export function useCopySync(db: TrainerDB, account: AccountInfo): void {
  const ref = useRef({ db, account });
  ref.current = { db, account };
  useEffect(() => {
    let busy = false;
    let lastPush = 0;
    let seen = false;
    const run = async (kind: 'pull' | 'tick' | 'hidden') => {
      if (busy || !navigator.onLine) return;
      busy = true;
      const { db: d, account: a } = ref.current;
      const store = a.service.copyStore(a.uid);
      try {
        if (kind === 'pull') {
          const r = await pullCopy(d, store);
          if (r.heldBack) await setMeta(d, COPY_ERROR, 'newer-app');
          if (!seen) {
            seen = true;
            void a.service.saveProfile(a.uid, { lastSeenAt: Date.now(), appVersion: __APP_VERSION__ }).catch(() => {});
          }
        }
        if (await hasNoPractice(d)) return;
        if (kind === 'tick' && Date.now() - lastPush < REMOTE_MIN_INTERVAL_MS) return;
        const before = (await d.meta.get(COPY_AT))?.value as number | undefined;
        const r = await pushCopy(d, store, Date.now());
        if (!r.ok) {
          await setMeta(d, COPY_ERROR, r.reason === 'error' ? (r.detail ?? 'error') : r.reason);
          return;
        }
        await d.meta.delete(COPY_ERROR);
        if (r.at !== before) {
          lastPush = r.at;
          void a.service.saveProfile(a.uid, { copyAt: r.at, lastSeenAt: Date.now() }).catch(() => {});
        }
      } catch (e) {
        await setMeta(d, COPY_ERROR, (e as Error).message).catch(() => {});
      } finally {
        busy = false;
      }
    };
    void run('pull');
    const onVisible = () => void run(document.visibilityState === 'hidden' ? 'hidden' : 'pull');
    const onOnline = () => void run('pull');
    const onHide = () => void run('hidden');
    const timer = setInterval(() => document.visibilityState === 'visible' && void run('tick'), TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
}
