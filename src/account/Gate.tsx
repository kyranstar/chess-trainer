/**
 * In front of the app (ADR-063): which screen shows, and which database the app runs on.
 *
 * Local mode (a build without accounts): the app as it always was, on the one database.
 * Accounts: install first where that saves a second sign-in, then sign in, then the account's
 * own database, the first-open steps once, and the app. Once an account has been let in on a
 * device the app opens straight away on later opens, online or not. Signing out or another
 * account signing in reloads the page, so nothing of one account stays in memory for the next.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { DbContext } from '../app/store';
import { openDb, type TrainerDB } from '../db/db';
import { AccountContext, type AccountInfo } from './context';
import { hasNoPractice, pullCopy } from './copy';
import { dbNameFor, inferUsername } from './device';
import { installFirst } from './install';
import { AccessError, FirstOpen, InstallFirst, NotInvited, Restoring, Splash, Welcome } from './Onboarding';
import { setRole } from './role';
import { getAccountService } from './service';
import type { Access, AccountService } from './types';
import { useCopySync } from './useCopySync';

export function AccountGate({ children }: { children: ReactNode }) {
  const [service, setService] = useState<AccountService | null | undefined>(undefined);
  useEffect(() => {
    void getAccountService().then(setService);
  }, []);
  if (service === undefined) return <Splash />;
  if (service === null) return <LocalMode>{children}</LocalMode>;
  return <Accounts service={service}>{children}</Accounts>;
}

function LocalMode({ children }: { children: ReactNode }) {
  const db = useMemo(() => openDb(), []);
  setRole('local');
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

function CopySync({ db, account }: { db: TrainerDB; account: AccountInfo }) {
  useCopySync(db, account);
  return null;
}

function onboardedHere(uid: string): boolean {
  try {
    return localStorage.getItem(`ct.onboarded.${uid}`) === '1';
  } catch {
    return false;
  }
}

type Opened = { uid: string; db: TrainerDB; phase: 'restoring' | 'first-open' | 'ready' };

function Accounts({ service, children }: { service: AccountService; children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ kind: 'checking' });
  const [browserOk, setBrowserOk] = useState(() => !installFirst());
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => service.onAccess(setAccess), [service]);
  useEffect(() => {
    const again = () => service.recheck();
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [service]);

  // Another account, or none, after the app was opened on one: start clean.
  useEffect(() => {
    if (!opened) return;
    if ((access.kind === 'allowed' && access.uid !== opened.uid) || access.kind === 'signed-out' || access.kind === 'not-invited') window.location.reload();
  }, [access, opened]);

  const allowedUid = access.kind === 'allowed' ? access.uid : null;
  useEffect(() => {
    if (access.kind !== 'allowed' || opened) return;
    const a = access;
    void (async () => {
      setRole(a.admin ? 'admin' : 'member');
      const db = openDb(await dbNameFor(a.uid, a.admin));
      await inferUsername(db);
      const phase = a.onboarded || onboardedHere(a.uid) ? 'ready' : 'first-open';
      // A new device of an account that has practised elsewhere: bring the progress in first.
      if (navigator.onLine && (await hasNoPractice(db))) {
        try {
          const store = service.copyStore(a.uid);
          if (await store.readManifest()) {
            setOpened({ uid: a.uid, db, phase: 'restoring' });
            await pullCopy(db, store);
          }
        } catch {
          // Not merged now: the copy is tried again in the background once the app is open.
        }
      }
      setOpened({ uid: a.uid, db, phase });
    })();
    // Opens once per account; later answers for the same account only refresh the name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedUid]);

  if (access.kind === 'signed-out' && !browserOk) return <InstallFirst onBrowser={() => setBrowserOk(true)} />;
  if (access.kind === 'checking') return <Splash />;
  if (access.kind === 'signed-out') return <Welcome service={service} error={access.error} />;
  if (access.kind === 'not-invited') return <NotInvited service={service} uid={access.uid} email={access.email} />;
  if (access.kind === 'error') return <AccessError service={service} message={access.message} />;
  if (!opened || opened.uid !== access.uid) return <Splash />;
  if (opened.phase === 'restoring') return <Restoring />;
  if (opened.phase === 'first-open') {
    return <FirstOpen db={opened.db} service={service} uid={access.uid} name={access.name} onDone={() => setOpened({ ...opened, phase: 'ready' })} />;
  }
  const account: AccountInfo = { uid: access.uid, email: access.email, name: access.name, admin: access.admin, service };
  return (
    <AccountContext.Provider value={account}>
      <DbContext.Provider value={opened.db}>
        <CopySync db={opened.db} account={account} />
        {children}
      </DbContext.Provider>
    </AccountContext.Provider>
  );
}
