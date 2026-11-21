/**
 * Keeps the account copy in step (ADR-063), out of sight: the account's copy is merged in
 * when the app opens, comes to the front or gets a connection back; this device's data is
 * sent when it has changed, at most every two minutes while the app is in use, and at once
 * when the app is sent to the background. What went wrong, if anything, is kept for the
 * Account page (`copy.error`); nothing interrupts practice.
 */
import { useEffect, useRef } from 'react';
import { setMeta, type TrainerDB } from '../db/db';
import type { AccountInfo } from './context';
import { COPY_ERROR, syncOnce } from './copy';

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
      try {
        const r = await syncOnce(d, a.service.copyStore(a.uid), kind, Date.now(), lastPush);
        if (kind === 'pull' && !seen) {
          seen = true;
          void a.service.saveProfile(a.uid, { lastSeenAt: Date.now(), appVersion: __APP_VERSION__ }).catch(() => {});
        }
        if (r.pushedAt) {
          lastPush = r.pushedAt;
          void a.service.saveProfile(a.uid, { copyAt: r.pushedAt, lastSeenAt: Date.now() }).catch(() => {});
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
