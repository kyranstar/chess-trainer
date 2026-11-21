/**
 * Manage access (ADR-063), the admin's alone: invite by name and Google address, see who has
 * signed in, remove access, and, once someone is removed, delete the progress saved to their
 * account. The server rules enforce all of it; this page only asks.
 */
import { useCallback, useEffect, useState } from 'react';
import { go, href } from '../app/router';
import { whenSaid } from './AccountPage';
import { useAccount } from './context';
import { type CopyInfo, type Invite, normEmail, type Profile } from './types';

interface Row { email: string; name: string; invite: Invite | null; profile: Profile | null; copy: CopyInfo | null; self: boolean }

export function AdminPage() {
  const account = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account?.admin) return;
    try {
      const [invites, profiles] = await Promise.all([account.service.listInvites(), account.service.listProfiles()]);
      const byEmail = new Map<string, Row>();
      for (const p of profiles) byEmail.set(p.email, { email: p.email, name: p.name, invite: null, profile: p, copy: null, self: p.uid === account.uid });
      for (const i of invites) {
        const r = byEmail.get(i.email);
        byEmail.set(i.email, r ? { ...r, invite: i, name: i.name } : { email: i.email, name: i.name, invite: i, profile: null, copy: null, self: false });
      }
      const list = [...byEmail.values()];
      await Promise.all(list.filter((r) => r.profile && !r.invite && !r.self).map(async (r) => {
        r.copy = await account.service.copyInfo(r.profile!.uid).catch(() => null);
      }));
      // You first, then those with access by name, then those removed.
      list.sort((a, b) => Number(b.self) - Number(a.self) || Number(!!b.invite) - Number(!!a.invite) || a.name.localeCompare(b.name));
      setRows(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account]);
  useEffect(() => {
    if (account && !account.admin) go('today');
    else void load();
  }, [account, load]);
  if (!account?.admin) return null;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid = name.trim().length > 0 && name.trim().length <= 60 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="page" data-testid="admin">
      <a className="back" href={href('account')}>Account</a>
      <h1>Manage access</h1>
      <p className="muted">Only the Google accounts listed here can use the app.</p>

      <form className="card admin-invite" onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void act(async () => {
          await account.service.invite(name, email);
          setName('');
          setEmail('');
        });
      }}>
        <h2>Invite someone</h2>
        <label className="field"><span>Name</span><input data-testid="invite-name" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Google address</span><input data-testid="invite-email" type="email" value={email} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="primary" type="submit" data-testid="invite-add" disabled={busy || !valid}>Invite</button>
      </form>

      {error && <p className="note is-error" data-testid="admin-error">{error}</p>}
      {!rows ? <p className="muted">Loading</p> : (
        <ul className="admin-list">
          {rows.map((r) => (
            <li key={r.email} className="card admin-row" data-testid="invite-row">
              <div className="admin-who">
                <p className="admin-name">{r.name}{r.self ? ' (you)' : ''}</p>
                <p className="muted small">{normEmail(r.email)}</p>
                <p className="small" data-testid="invite-state">{stateLine(r)}</p>
              </div>
              <div className="actions">
                {r.invite && !r.self && <button data-testid="invite-remove" disabled={busy} onClick={() => void act(() => account.service.removeInvite(r.email))}>Remove access</button>}
                {!r.invite && !r.self && r.copy && confirming !== r.email && (
                  <button data-testid="delete-copy" disabled={busy} onClick={() => setConfirming(r.email)}>Delete their saved progress</button>
                )}
                {confirming === r.email && r.profile && (
                  <>
                    <button className="danger" data-testid="delete-copy-confirm" disabled={busy} onClick={() => void act(async () => {
                      await account.service.deleteCopyOf(r.profile!.uid);
                      setConfirming(null);
                    })}>Delete for good</button>
                    <button onClick={() => setConfirming(null)}>Keep it</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function stateLine(r: Row): string {
  if (r.self) return 'Admin';
  if (!r.invite) return r.copy ? `Access removed · progress saved ${whenSaid(Date.parse(r.copy.exportTime))}` : 'Access removed';
  if (!r.profile) return 'Invited, not signed in yet';
  return `Last seen ${whenSaid(r.profile.lastSeenAt)} · ${r.profile.chesscom ? `Chess.com: ${r.profile.chesscom}` : 'No Chess.com'}`;
}
