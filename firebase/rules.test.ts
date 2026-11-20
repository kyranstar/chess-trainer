/**
 * The server rules (ADR-063), on the local Firestore emulator: who can read and write what.
 * Run with `npm run test:rules` (starts the emulators, needs Java; no cloud, no credentials).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const OWNER = 'owner@example.com';
const SAM = 'sam@example.com';
const EVE = 'eve@example.com';

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
    const fs = ctx.firestore();
    await setDoc(doc(fs, 'admins', OWNER), { addedAt: 1 });
    await setDoc(doc(fs, 'invites', SAM), { email: SAM, name: 'Sam', invitedAt: 1 });
    await setDoc(doc(fs, 'users', 'u-sam'), profile('u-sam', SAM));
    await setDoc(doc(fs, 'users', 'u-sam', 'copy', 'manifest'), { rev: 1, chunks: 1, bytes: 10 });
    await setDoc(doc(fs, 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0'), { rev: 1, i: 0, data: 'xyz' });
  });
});

function profile(uid: string, email: string) {
  return { uid, email, name: 'x', chesscom: null, createdAt: 1, lastSeenAt: 1, appVersion: 't', onboarded: false, copyAt: null };
}
const as = (uid: string, email: string, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const owner = () => as('u-owner', OWNER);
const sam = () => as('u-sam', SAM);
const eve = () => as('u-eve', EVE);

describe('invites', () => {
  it('the admin reads, lists, writes and deletes invites', async () => {
    await assertSucceeds(getDocs(collection(owner(), 'invites')));
    await assertSucceeds(setDoc(doc(owner(), 'invites', EVE), { email: EVE, name: 'Eve', invitedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(owner(), 'invites', EVE)));
  });
  it('an invite must name its address and a name of 1 to 60 characters', async () => {
    await assertFails(setDoc(doc(owner(), 'invites', EVE), { email: SAM, name: 'Eve', invitedAt: 2 }));
    await assertFails(setDoc(doc(owner(), 'invites', EVE), { email: EVE, name: '', invitedAt: 2 }));
    await assertFails(setDoc(doc(owner(), 'invites', EVE), { email: EVE, name: 'x'.repeat(61), invitedAt: 2 }));
  });
  it('an invited friend reads only their own invite and writes none', async () => {
    await assertSucceeds(getDoc(doc(sam(), 'invites', SAM)));
    await assertFails(getDoc(doc(sam(), 'invites', OWNER)));
    await assertFails(getDocs(collection(sam(), 'invites')));
    await assertFails(setDoc(doc(sam(), 'invites', EVE), { email: EVE, name: 'Eve', invitedAt: 2 }));
  });
  it('anyone signed in may look up their own invite, which tells them they are not on the list', async () => {
    await assertSucceeds(getDoc(doc(eve(), 'invites', EVE)));
  });
});

describe('admins', () => {
  it('only the address itself reads its admin entry, and no client writes one', async () => {
    await assertSucceeds(getDoc(doc(owner(), 'admins', OWNER)));
    await assertSucceeds(getDoc(doc(eve(), 'admins', EVE)));
    await assertFails(getDoc(doc(sam(), 'admins', OWNER)));
    await assertFails(setDoc(doc(eve(), 'admins', EVE), { addedAt: 2 }));
    await assertFails(setDoc(doc(owner(), 'admins', EVE), { addedAt: 2 }));
  });
});

describe('profiles and the account copy', () => {
  it('an invited friend reads and writes their own profile and copy', async () => {
    await assertSucceeds(getDoc(doc(sam(), 'users', 'u-sam')));
    await assertSucceeds(setDoc(doc(sam(), 'users', 'u-sam'), { lastSeenAt: 5 }, { merge: true }));
    await assertSucceeds(getDoc(doc(sam(), 'users', 'u-sam', 'copy', 'manifest')));
    await assertSucceeds(getDoc(doc(sam(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
    await assertSucceeds(setDoc(doc(sam(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '1'), { rev: 2, i: 1, data: 'abc' }));
    await assertSucceeds(setDoc(doc(sam(), 'users', 'u-sam', 'copy', 'manifest'), { rev: 2, chunks: 2, bytes: 20 }));
  });
  it('a profile cannot claim another address', async () => {
    await assertFails(setDoc(doc(sam(), 'users', 'u-sam'), { email: OWNER }, { merge: true }));
  });
  it('a friend cannot read or write another account', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'invites', EVE), { email: EVE, name: 'Eve', invitedAt: 1 }));
    await assertFails(getDoc(doc(eve(), 'users', 'u-sam')));
    await assertFails(getDoc(doc(eve(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
    await assertFails(setDoc(doc(eve(), 'users', 'u-sam', 'copy', 'manifest'), { rev: 9 }));
    await assertFails(getDocs(collection(eve(), 'users')));
  });
  it('someone not invited can do nothing under users, not even create their own profile', async () => {
    await assertFails(getDoc(doc(eve(), 'users', 'u-eve')));
    await assertFails(setDoc(doc(eve(), 'users', 'u-eve'), profile('u-eve', EVE)));
    await assertFails(setDoc(doc(eve(), 'users', 'u-eve', 'copy', 'manifest'), { rev: 1 }));
  });
  it('an unverified address is refused even with an invite', async () => {
    const unverified = as('u-sam', SAM, false);
    await assertFails(getDoc(doc(unverified, 'invites', SAM)));
    await assertFails(getDoc(doc(unverified, 'users', 'u-sam')));
    await assertFails(getDoc(doc(unverified, 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
  });
  it('the admin lists profiles and reads when a copy was saved, but never its content', async () => {
    await assertSucceeds(getDocs(collection(owner(), 'users')));
    await assertSucceeds(getDoc(doc(owner(), 'users', 'u-sam', 'copy', 'manifest')));
    await assertFails(getDoc(doc(owner(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
    await assertFails(setDoc(doc(owner(), 'users', 'u-sam', 'copy', 'manifest'), { rev: 9 }));
  });
  it('the admin deletes a removed friend\'s copy', async () => {
    await assertSucceeds(deleteDoc(doc(owner(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
    await assertSucceeds(deleteDoc(doc(owner(), 'users', 'u-sam', 'copy', 'manifest')));
  });
  it('a removed friend loses their own copy at once', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), 'invites', SAM)));
    await assertFails(getDoc(doc(sam(), 'users', 'u-sam')));
    await assertFails(getDoc(doc(sam(), 'users', 'u-sam', 'copy', 'manifest', 'chunks', '0')));
  });
  it('the admin has an account of their own without an invite', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'users', 'u-owner'), profile('u-owner', OWNER)));
    await assertSucceeds(setDoc(doc(owner(), 'users', 'u-owner', 'copy', 'manifest'), { rev: 1, chunks: 0, bytes: 0 }));
  });
});
