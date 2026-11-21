/**
 * Account (ADR-063): who is signed in, the Chess.com link, whether progress is saved to the
 * account, how to install on a phone, signing out; for the admin, Manage access and the
 * private GitHub copy (ADR-048), moved here from Your data.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { href } from '../app/router';
import { useDb } from '../app/store';
import { getMeta, setMeta } from '../db/db';
import { RemoteCopy } from '../ui/Data';
import { useAccount } from './context';
import { COPY_AT, COPY_ERROR } from './copy';
import { isInstalled, platform } from './install';
import { InstallSteps, LinkChessCom } from './Onboarding';

/** "just now", "12 min ago", "today at 9:40", "Nov 19". */
export function whenSaid(at: number, now: number = Date.now()): string {
  const min = Math.round((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (new Date(now).toDateString() === d.toDateString()) return `today at ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function copyStatus(at: number | undefined, error: string | undefined): string {
  if (error === 'offline') return 'Not saved yet: there is no connection. It is saved as soon as there is one.';
  if (error === 'newer-app') return 'Your account has progress from a newer version of the app. Close and reopen the app to update it, and it is brought in.';
  if (error) return `Not saved: ${error}. It is tried again by itself.`;
  if (at) return `Saved to your account ${whenSaid(at)}. Sign in on another device and it picks up from here.`;
  return 'Saved to your account as soon as you have practised.';
}

export function AccountPage() {
  const account = useAccount();
  const db = useDb();
  const username = useLiveQuery(() => getMeta<string>(db, 'chesscom.username'), [db]);
  const copyAt = useLiveQuery(() => getMeta<number>(db, COPY_AT), [db]);
  const copyError = useLiveQuery(() => getMeta<string>(db, COPY_ERROR), [db]);
  const [changing, setChanging] = useState(false);
  if (!account) {
    return (
      <div className="page" data-testid="account">
        <a className="back" href={href('today')}>Today</a>
        <h1>Account</h1>
        <p>This copy of the app runs without accounts: everything stays on this device.</p>
      </div>
    );
  }
  async function unlink() {
    if (!account) return;
    await setMeta(db, 'chesscom.username', '');
    void account.service.saveProfile(account.uid, { chesscom: null }).catch(() => {});
  }
  const p = platform();
  return (
    <div className="page" data-testid="account">
      <a className="back" href={href('today')}>Today</a>
      <h1>{account.name}</h1>
      <p className="muted account-email">{account.email}</p>

      <section className="card">
        <h2>Chess.com</h2>
        {changing ? (
          <LinkChessCom compact db={db} service={account.service} uid={account.uid} onDone={() => setChanging(false)} skipLabel="Cancel" />
        ) : (
          <>
            <p data-testid="account-chesscom">{username ? <>Linked to <strong>{username}</strong>. Your games come in by themselves.</> : 'Not linked.'}</p>
            <div className="actions">
              <button data-testid="chesscom-change" onClick={() => setChanging(true)}>{username ? 'Change' : 'Link Chess.com'}</button>
              {username && <button data-testid="chesscom-unlink" onClick={() => void unlink()}>Unlink</button>}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Your progress</h2>
        <p data-testid="account-copy">{copyStatus(copyAt, copyError)}</p>
      </section>

      {!isInstalled() && (
        <section className="card" data-testid="account-install">
          <h2>Install on your phone</h2>
          {p === 'android'
            ? <p>In Chrome, open the menu (⋮) and choose <strong>Install app</strong>.</p>
            : (
              <>
                <p className="muted small">On iPhone or iPad, in Safari:</p>
                <InstallSteps />
                {p !== 'ios' && <p className="muted small">On Android, in Chrome: menu (⋮), then <strong>Install app</strong>.</p>}
              </>
            )}
        </section>
      )}

      {account.admin && <a className="button big" data-testid="manage-access" href={href('admin')}>Manage access</a>}
      {account.admin && <RemoteCopy />}

      <button className="big" data-testid="sign-out" onClick={() => void account.service.signOut()}>Sign out</button>
    </div>
  );
}
