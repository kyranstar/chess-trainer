/**
 * Which account service runs (ADR-063):
 *  - a build with a Firebase config (the published app): Firebase;
 *  - a build without one, where a test has written `ct.fake`: the stand-in in localStorage;
 *  - otherwise null: local mode, the app as it always was, with no sign-in.
 * The fake can never run in a build that carries a Firebase config.
 */
import type { AccountService } from './types';

export const FIREBASE_CONFIG: string = (import.meta.env?.VITE_FIREBASE_CONFIG as string | undefined) ?? '';

let service: Promise<AccountService | null> | null = null;

export function getAccountService(): Promise<AccountService | null> {
  service ??= (async () => {
    if (FIREBASE_CONFIG) {
      const { firebaseAccountService } = await import('./firebase');
      return firebaseAccountService({ config: JSON.parse(FIREBASE_CONFIG) });
    }
    let fake = false;
    try {
      fake = localStorage.getItem('ct.fake') !== null;
    } catch {
      fake = false;
    }
    if (!fake) return null;
    const { fakeAccountService } = await import('./fake');
    return fakeAccountService();
  })();
  return service;
}
