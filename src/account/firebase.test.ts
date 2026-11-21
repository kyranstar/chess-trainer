/**
 * Opening never waits on the network once an account has been let in on this device (final
 * review of ADR-063, critical): Firebase holds its first auth answer back until its own start-up
 * finishes, which on a connection that is up but passes nothing (the subway) takes up to a
 * minute or more. The last answer kept on the device must come first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firebaseAccountService } from './firebase';
import type { Access } from './types';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

let n = 0;
function service() {
  // Emulators on a port where nothing listens: nothing on the network can answer.
  return firebaseAccountService({
    config: { apiKey: 'demo-key', projectId: 'demo-chess-trainer', authDomain: 'localhost' },
    name: `boot-${++n}`,
    emulators: { auth: 'http://127.0.0.1:9', firestoreHost: '127.0.0.1', firestorePort: 9 },
  });
}

describe('opening on the answer kept on this device', () => {
  it('an account let in before is allowed at once, before Firebase answers', async () => {
    const kept: Access = { kind: 'allowed', uid: 'u-sam', email: 'sam@example.com', name: 'Sam', admin: false, onboarded: true };
    store.set('ct.access', JSON.stringify(kept));
    const first = await new Promise<Access>((resolve) => {
      service().onAccess((a) => {
        if (a.kind !== 'checking') resolve(a);
      });
    });
    expect(first).toEqual(kept);
  });

  it('with nothing kept, it waits for Firebase as before', async () => {
    const first = await new Promise<Access>((resolve) => {
      service().onAccess((a) => {
        if (a.kind !== 'checking') resolve(a);
      });
    });
    expect(first.kind).toBe('signed-out');
  });
});
