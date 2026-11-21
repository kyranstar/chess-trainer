/**
 * The account service on Firebase (ADR-063): Google sign-in, and Firestore (the Lite SDK: no
 * realtime, no cache of its own; the app has its own database) for the invite list, profiles
 * and the account copy. Only loaded by a build that carries a Firebase config.
 *
 * Opening never waits on the network once the account has been let in on this device: the
 * last answer is kept, the app opens on it at once, and the list is asked again in the
 * background. A removed invite therefore takes effect at the next open with a connection.
 * The server rules (firebase/firestore.rules) are what enforce the list; this only follows them.
 */
import { type FirebaseOptions, initializeApp } from 'firebase/app';
import {
  type Auth, browserPopupRedirectResolver, connectAuthEmulator, getRedirectResult, GoogleAuthProvider,
  indexedDBLocalPersistence, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User,
} from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, type Firestore, getDoc, getDocs, getFirestore, runTransaction, setDoc,
} from 'firebase/firestore/lite';
import type { CopyManifest, CopyStore } from './copy';
import { preferRedirect } from './install';
import { type Access, type AccountService, type CopyInfo, firstName, type Invite, normEmail, type Profile } from './types';

export interface FirebaseSetup {
  config: FirebaseOptions;
  /** Tests: a name per instance, since one process holds several. */
  name?: string;
  /** Tests: the local emulators, and no persistence or popups. */
  emulators?: { auth: string; firestoreHost: string; firestorePort: number };
}

const ACCESS_KEY = 'ct.access';
const CHECK_TIMEOUT_MS = 10_000;
const MAX_CHUNKS = 64;

/** The answer kept from the last open, whoever it was for: the app opens on it at once. */
function bootAccess(): Access {
  try {
    const a = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? 'null') as Access | null;
    return a && a.kind === 'allowed' ? a : { kind: 'checking' };
  } catch {
    return { kind: 'checking' };
  }
}

/** A redirect sign-in is under way in this tab (Firebase marks it in session storage). */
function redirectPending(): boolean {
  try {
    for (let i = 0; i < sessionStorage.length; i++) if (sessionStorage.key(i)?.startsWith('firebase:pendingRedirect:')) return true;
  } catch {
    // No session storage: assume none.
  }
  return false;
}

function cached(uid: string): Access | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? 'null') as Access | null;
    return a && 'uid' in a && a.uid === uid ? a : null;
  } catch {
    return null;
  }
}
function remember(a: Access): void {
  try {
    if (a.kind === 'allowed' || a.kind === 'not-invited') localStorage.setItem(ACCESS_KEY, JSON.stringify(a));
    else if (a.kind === 'signed-out') localStorage.removeItem(ACCESS_KEY);
  } catch {
    // Storage blocked: the list is asked every time.
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('The sign-in check took too long.')), ms))]);
}

export function firebaseAccountService(setup: FirebaseSetup): AccountService & { auth: Auth; fs: Firestore } {
  const app = initializeApp(setup.config, setup.name);
  const auth = initializeAuth(app, setup.emulators
    ? { persistence: inMemoryPersistence }
    // No popup/redirect resolver here: given one, Firebase loads its helper frame from the network
    // before its first answer on Safari. It is passed to the sign-in calls instead.
    : { persistence: indexedDBLocalPersistence });
  const fs = getFirestore(app);
  if (setup.emulators) {
    connectAuthEmulator(auth, setup.emulators.auth, { disableWarnings: true });
    connectFirestoreEmulator(fs, setup.emulators.firestoreHost, setup.emulators.firestorePort);
  }
  const listeners = new Set<(a: Access) => void>();
  // Opening never waits on the network once an account has been let in on this device: the kept
  // answer comes first, and Firebase's own (which can take a minute on a dead connection) follows.
  let current: Access = setup.emulators && typeof localStorage === 'undefined' ? { kind: 'checking' } : bootAccess();
  let redirectError: string | undefined;
  const emit = (a: Access) => {
    current = a;
    remember(a);
    listeners.forEach((l) => l(a));
  };

  async function ask(user: User): Promise<Access> {
    const email = normEmail(user.email ?? '');
    if (!email || !user.emailVerified) return { kind: 'not-invited', uid: user.uid, email };
    const [adminSnap, inviteSnap] = await Promise.all([getDoc(doc(fs, 'admins', email)), getDoc(doc(fs, 'invites', email))]);
    const admin = adminSnap.exists();
    const invite = inviteSnap.exists() ? (inviteSnap.data() as Invite) : null;
    if (!admin && !invite) return { kind: 'not-invited', uid: user.uid, email };
    const ref = doc(fs, 'users', user.uid);
    const snap = await getDoc(ref);
    let profile = snap.exists() ? (snap.data() as Profile) : null;
    if (!profile) {
      profile = {
        uid: user.uid, email, name: invite?.name ?? firstName(user.displayName, email), chesscom: null, createdAt: Date.now(),
        lastSeenAt: Date.now(), appVersion: __APP_VERSION__, onboarded: false, copyAt: null,
      };
      await setDoc(ref, profile);
    }
    return { kind: 'allowed', uid: user.uid, email, name: invite?.name || profile.name, admin, onboarded: !!profile.onboarded };
  }

  async function check(user: User): Promise<void> {
    const before = cached(user.uid);
    if (before) emit(before);
    if (typeof navigator !== 'undefined' && navigator.onLine === false && before) return;
    try {
      const fresh = await withTimeout(ask(user), CHECK_TIMEOUT_MS);
      if (auth.currentUser?.uid === user.uid) emit(fresh);
    } catch (e) {
      if (!before) emit({ kind: 'error', message: navigator.onLine === false ? 'You are offline. Connect once to sign in.' : (e as Error).message });
    }
  }

  if (!setup.emulators && redirectPending()) {
    void getRedirectResult(auth, browserPopupRedirectResolver).catch((e: { code?: string; message?: string }) => {
      redirectError = e.code === 'auth/redirect-cancelled-by-user' ? undefined : (e.message ?? 'Sign-in did not finish.');
      if (current.kind === 'signed-out' || current.kind === 'checking') emit({ kind: 'signed-out', error: redirectError });
    });
  }
  onAuthStateChanged(auth, (user) => {
    if (!user) emit({ kind: 'signed-out', ...(redirectError ? { error: redirectError } : {}) });
    else void check(user);
  });

  const chunkRef = (uid: string, i: number) => doc(fs, 'users', uid, 'copy', 'manifest', 'chunks', String(i));
  const manifestRef = (uid: string) => doc(fs, 'users', uid, 'copy', 'manifest');

  const copyStore = (uid: string): CopyStore => ({
    async readManifest() {
      const s = await getDoc(manifestRef(uid));
      return s.exists() ? (s.data() as CopyManifest) : null;
    },
    async readChunks(m) {
      return runTransaction(fs, async (tx) => {
        const now = await tx.get(manifestRef(uid));
        if (!now.exists() || (now.data() as CopyManifest).rev !== m.rev) throw new Error('The copy changed while it was read; it will be read again.');
        const out: string[] = [];
        for (let i = 0; i < m.chunks; i++) out.push(((await tx.get(chunkRef(uid, i))).data() as { data: string }).data);
        return out;
      });
    },
    async write(expectedRev, m, chunks) {
      return runTransaction(fs, async (tx) => {
        const now = await tx.get(manifestRef(uid));
        const old = now.exists() ? (now.data() as CopyManifest) : null;
        if ((old?.rev ?? 0) !== expectedRev) return 'conflict' as const;
        chunks.forEach((data, i) => tx.set(chunkRef(uid, i), { rev: m.rev, i, data }));
        for (let i = chunks.length; i < (old?.chunks ?? 0); i++) tx.delete(chunkRef(uid, i));
        tx.set(manifestRef(uid), m);
        return 'ok' as const;
      });
    },
  });

  return {
    mode: 'firebase',
    auth,
    fs,
    onAccess(cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(current));
      return () => void listeners.delete(cb);
    },
    recheck() {
      if (auth.currentUser) void check(auth.currentUser);
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (preferRedirect()) return signInWithRedirect(auth, provider, browserPopupRedirectResolver);
      try {
        await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') return signInWithRedirect(auth, provider, browserPopupRedirectResolver);
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') throw e;
      }
    },
    async signOut() {
      await signOut(auth);
    },
    async saveProfile(uid, p) {
      await setDoc(doc(fs, 'users', uid), p, { merge: true });
    },
    copyStore,
    async listInvites() {
      return (await getDocs(collection(fs, 'invites'))).docs.map((d) => d.data() as Invite);
    },
    async listProfiles() {
      return (await getDocs(collection(fs, 'users'))).docs.map((d) => d.data() as Profile);
    },
    async invite(name, email) {
      const e = normEmail(email);
      await setDoc(doc(fs, 'invites', e), { email: e, name: name.trim(), invitedAt: Date.now() } satisfies Invite);
    },
    async removeInvite(email) {
      await deleteDoc(doc(fs, 'invites', normEmail(email)));
    },
    async copyInfo(uid): Promise<CopyInfo | null> {
      const s = await getDoc(manifestRef(uid));
      if (!s.exists()) return null;
      const m = s.data() as CopyManifest;
      return { uid, exportTime: m.exportTime, bytes: m.bytes };
    },
    async deleteCopyOf(uid) {
      const s = await getDoc(manifestRef(uid));
      const n = s.exists() ? (s.data() as CopyManifest).chunks : 0;
      for (let i = 0; i < Math.min(Math.max(n, 1) + 8, MAX_CHUNKS); i++) await deleteDoc(chunkRef(uid, i));
      await deleteDoc(manifestRef(uid));
    },
  };
}
