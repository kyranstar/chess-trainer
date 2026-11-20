/**
 * The app's own Firebase account service (src/account/firebase.ts) against the local auth and
 * Firestore emulators with the real rules: sign-in, the access answer, the profile, and the
 * account copy written and read through the rules. `npm run test:rules`.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { firebaseAccountService } from '../src/account/firebase';
import type { Access } from '../src/account/types';

let env: RulesTestEnvironment;
let n = 0;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-chess-trainer',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'admins', 'owner@example.com'), { addedAt: 1 });
    await setDoc(doc(ctx.firestore(), 'invites', 'sam@example.com'), { email: 'sam@example.com', name: 'Sam', invitedAt: 1 });
  });
});

/** A fresh service (its own Firebase app) signed in as `email` on the emulator. */
async function signedIn(email: string, sub: string): Promise<{ svc: ReturnType<typeof firebaseAccountService>; access: Access }> {
  const svc = firebaseAccountService({
    config: { apiKey: 'demo-key', projectId: 'demo-chess-trainer', authDomain: 'localhost' },
    name: `app-${++n}`,
    emulators: { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 },
  });
  const access = await new Promise<Access>((resolve) => {
    svc.onAccess((a) => {
      if (a.kind !== 'checking' && a.kind !== 'signed-out') resolve(a);
    });
    void signInWithCredential(svc.auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: 'Sam Park' })));
  });
  return { svc, access };
}

describe('the Firebase account service on the emulators', () => {
  it('an invited friend is let in with the invite name, and their profile is created', async () => {
    const { svc, access } = await signedIn('Sam@Example.com', 'sub-sam');
    expect(access).toMatchObject({ kind: 'allowed', email: 'sam@example.com', name: 'Sam', admin: false, onboarded: false });
    await svc.saveProfile((access as { uid: string }).uid, { onboarded: true });
  });

  it('the admin is let in as admin', async () => {
    const { access } = await signedIn('owner@example.com', 'sub-owner');
    expect(access).toMatchObject({ kind: 'allowed', admin: true });
  });

  it('someone not invited is told so', async () => {
    const { access } = await signedIn('eve@example.com', 'sub-eve');
    expect(access).toMatchObject({ kind: 'not-invited', email: 'eve@example.com' });
  });

  it('the account copy is written and read back through the rules, with a conflict on a stale revision', async () => {
    const { svc, access } = await signedIn('sam@example.com', 'sub-sam2');
    const store = svc.copyStore((access as { uid: string }).uid);
    const m = { rev: 1, chunks: 2, bytes: 6, sha256: 'x', exportTime: '2026-11-20T00:00:00Z', deviceId: 'd', appVersion: 't', schemaVersion: 4 };
    expect(await store.write(0, m, ['abc', 'def'])).toBe('ok');
    expect(await store.write(0, { ...m, rev: 1 }, ['zzz'])).toBe('conflict');
    expect(await store.readManifest()).toMatchObject({ rev: 1, chunks: 2 });
    expect(await store.readChunks(m)).toEqual(['abc', 'def']);
    expect(await store.write(1, { ...m, rev: 2, chunks: 1 }, ['ghi'])).toBe('ok');
    expect(await store.readChunks({ ...m, rev: 2, chunks: 1 })).toEqual(['ghi']);
  });

  it('the admin invites, sees the friend and the copy time, removes and deletes the copy', async () => {
    const friend = await signedIn('sam@example.com', 'sub-sam3');
    const uid = (friend.access as { uid: string }).uid;
    await friend.svc.copyStore(uid).write(0, { rev: 1, chunks: 1, bytes: 3, sha256: 'x', exportTime: '2026-11-20T01:00:00Z', deviceId: 'd', appVersion: 't', schemaVersion: 4 }, ['abc']);
    const { svc } = await signedIn('owner@example.com', 'sub-owner2');
    await svc.invite('Eve', 'Eve@Example.com');
    expect((await svc.listInvites()).map((i) => i.email).sort()).toEqual(['eve@example.com', 'sam@example.com']);
    expect((await svc.listProfiles()).some((p) => p.uid === uid)).toBe(true);
    expect(await svc.copyInfo(uid)).toMatchObject({ exportTime: '2026-11-20T01:00:00Z', bytes: 3 });
    await svc.removeInvite('sam@example.com');
    await svc.deleteCopyOf(uid);
    expect(await svc.copyInfo(uid)).toBeNull();
  });
});
