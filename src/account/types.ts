/** The account layer's shapes (ADR-063). See src/account/service.ts for which implementation runs. */
import type { CopyStore } from './copy';

export interface Invite { email: string; name: string; invitedAt: number }

export interface Profile {
  uid: string;
  email: string;
  name: string;
  chesscom: string | null;
  createdAt: number;
  lastSeenAt: number;
  appVersion: string;
  /** Set once the first-open steps (hello, install, Chess.com) are done or skipped. */
  onboarded: boolean;
  copyAt: number | null;
}

export type Access =
  | { kind: 'checking' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'not-invited'; uid: string; email: string }
  /** Signed in, but the list could not be read and this device has no earlier answer (offline at the very first open). */
  | { kind: 'error'; message: string }
  | { kind: 'allowed'; uid: string; email: string; name: string; admin: boolean; onboarded: boolean };

/** What the admin page shows per copy: when it was written and its size, never its content. */
export interface CopyInfo { uid: string; exportTime: string; bytes: number }

export interface AccountService {
  mode: 'firebase' | 'fake';
  onAccess(cb: (a: Access) => void): () => void;
  /** Asks the server again (after coming back online). */
  recheck(): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  saveProfile(uid: string, p: Partial<Profile>): Promise<void>;
  copyStore(uid: string): CopyStore;
  listInvites(): Promise<Invite[]>;
  listProfiles(): Promise<Profile[]>;
  invite(name: string, email: string): Promise<void>;
  removeInvite(email: string): Promise<void>;
  copyInfo(uid: string): Promise<CopyInfo | null>;
  deleteCopyOf(uid: string): Promise<void>;
}

export const normEmail = (e: string): string => e.trim().toLowerCase();
/** "Sam" from "Sam Park", for a greeting when no name was given with the invite. */
export const firstName = (displayName: string | null | undefined, email: string): string =>
  (displayName ?? '').trim().split(/\s+/)[0] || email.split('@')[0]!;
