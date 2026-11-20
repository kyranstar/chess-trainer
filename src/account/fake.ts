/**
 * A stand-in for the Firebase account service, kept in this browser's localStorage, for the
 * browser tests (ADR-063; `AGENTS.md`: tests run with no cloud). It is only ever used by a
 * build without a Firebase config, and only when a test has written `ct.fake`.
 *
 * `ct.fake`: the whole "server" (invites, admins, profiles, copies, who is signed in).
 * `ct.fake.as`: the Google address "Continue with Google" signs in as.
 */
import type { CopyManifest, CopyStore } from './copy';
import { type Access, type AccountService, type CopyInfo, firstName, type Invite, normEmail, type Profile } from './types';

export const FAKE_KEY = 'ct.fake';
export const FAKE_AS_KEY = 'ct.fake.as';

export interface FakeState {
  signedIn: string | null;
  invites: Invite[];
  admins: string[];
  profiles: Profile[];
  copies: Record<string, { manifest: CopyManifest | null; chunks: string[] }>;
}

const read = (): FakeState => ({ signedIn: null, invites: [], admins: [], profiles: [], copies: {}, ...(JSON.parse(localStorage.getItem(FAKE_KEY) ?? '{}') as Partial<FakeState>) });
const write = (s: FakeState) => localStorage.setItem(FAKE_KEY, JSON.stringify(s));
const uidOf = (email: string) => `fake-${normEmail(email)}`;

export function fakeAccountService(): AccountService {
  const listeners = new Set<(a: Access) => void>();
  const access = (): Access => {
    const s = read();
    if (!s.signedIn) return { kind: 'signed-out' };
    const email = normEmail(s.signedIn);
    const uid = uidOf(email);
    const admin = s.admins.includes(email);
    const invite = s.invites.find((i) => i.email === email);
    if (!admin && !invite) return { kind: 'not-invited', uid, email };
    let profile = s.profiles.find((p) => p.uid === uid);
    if (!profile) {
      profile = { uid, email, name: invite?.name ?? firstName(null, email), chesscom: null, createdAt: Date.now(), lastSeenAt: Date.now(), appVersion: __APP_VERSION__, onboarded: false, copyAt: null };
      s.profiles.push(profile);
      write(s);
    }
    return { kind: 'allowed', uid, email, name: invite?.name ?? profile.name, admin, onboarded: profile.onboarded };
  };
  const emit = () => {
    const a = access();
    listeners.forEach((l) => l(a));
  };
  const store = (uid: string): CopyStore => ({
    async readManifest() {
      return read().copies[uid]?.manifest ?? null;
    },
    async readChunks() {
      return [...(read().copies[uid]?.chunks ?? [])];
    },
    async write(expectedRev, m, chunks) {
      const s = read();
      if ((s.copies[uid]?.manifest?.rev ?? 0) !== expectedRev) return 'conflict';
      s.copies[uid] = { manifest: m, chunks };
      const p = s.profiles.find((x) => x.uid === uid);
      if (p) p.copyAt = Date.parse(m.exportTime);
      write(s);
      return 'ok';
    },
  });
  return {
    mode: 'fake',
    onAccess(cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(access()));
      return () => void listeners.delete(cb);
    },
    recheck: emit,
    async signIn() {
      const s = read();
      s.signedIn = localStorage.getItem(FAKE_AS_KEY);
      write(s);
      emit();
    },
    async signOut() {
      const s = read();
      s.signedIn = null;
      write(s);
      emit();
    },
    async saveProfile(uid, p) {
      const s = read();
      const i = s.profiles.findIndex((x) => x.uid === uid);
      if (i >= 0) s.profiles[i] = { ...s.profiles[i]!, ...p };
      write(s);
    },
    copyStore: store,
    async listInvites() {
      return read().invites;
    },
    async listProfiles() {
      return read().profiles;
    },
    async invite(name, email) {
      const s = read();
      const e = normEmail(email);
      s.invites = [...s.invites.filter((i) => i.email !== e), { email: e, name: name.trim(), invitedAt: Date.now() }];
      write(s);
    },
    async removeInvite(email) {
      const s = read();
      s.invites = s.invites.filter((i) => i.email !== normEmail(email));
      write(s);
    },
    async copyInfo(uid): Promise<CopyInfo | null> {
      const m = read().copies[uid]?.manifest;
      return m ? { uid, exportTime: m.exportTime, bytes: m.bytes } : null;
    },
    async deleteCopyOf(uid) {
      const s = read();
      delete s.copies[uid];
      write(s);
    },
  };
}
