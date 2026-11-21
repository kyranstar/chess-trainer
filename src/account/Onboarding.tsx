/**
 * The screens in front of the app when accounts are on (ADR-063): install first (where an
 * installed app has its own storage), welcome and sign-in, not on the list, and the first open
 * of an invited account (hello, install where the browser offers it, Chess.com). They say
 * nothing about accounts, copies or databases unless something needs attention.
 */
import Dexie from 'dexie';
import { type ReactNode, useEffect, useState } from 'react';
import { backupFileName, exportBackup, serializeBackup } from '../db/backup';
import { openDb, setMeta, type TrainerDB } from '../db/db';
import { CHESSCOM_API } from '../games/chesscom';
import { accountDbName, LEGACY_DB, LEGACY_OWNER_KEY } from './device';
import { BROWSER_OK_KEY, installPrompt, onInstallPromptChange, platform } from './install';
import { currentLook, LOOK_SETTING, type LookId } from '../ui/looks';
import { LookPicker } from '../ui/LookPicker';
import type { AccountService } from './types';

function AppMark() {
  return <img className="onboard-mark" src="icon.svg" alt="" width={64} height={64} />;
}

function Screen({ testid, children }: { testid: string; children: ReactNode }) {
  return <div className="page onboard" data-testid={testid}>{children}</div>;
}

export function Splash() {
  return <div className="page onboard" data-testid="splash" aria-busy="true" />;
}

/** Drawn after the system's own symbols, so the step can be matched to what is on the screen. */
function ShareGlyph() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function AddGlyph() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function OpenGlyph() {
  return <img className="glyph" src="icon.svg" alt="" />;
}

/** The steps to add the app to the Home Screen (or, on a Mac with Safari, the Dock). */
export function InstallSteps({ mac = false }: { mac?: boolean }) {
  return (
    <ol className="install-steps">
      {mac ? (
        <>
          <li><ShareGlyph /><span>In Safari’s menu bar, choose <strong>File</strong>, then <strong>Add to Dock</strong>.</span></li>
          <li><AddGlyph /><span>Choose <strong>Add</strong>.</span></li>
          <li><OpenGlyph /><span>Open <strong>Chess Trainer</strong> from your Dock.</span></li>
        </>
      ) : (
        <>
          <li><ShareGlyph /><span>Tap <strong>Share</strong> in Safari’s toolbar.</span></li>
          <li><AddGlyph /><span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span></li>
          <li><OpenGlyph /><span>Open <strong>Chess Trainer</strong> from your Home Screen.</span></li>
        </>
      )}
    </ol>
  );
}

/** iPhone, iPad and Safari on the Mac: install before signing in, so sign-in happens once, in the installed app. */
export function InstallFirst({ onBrowser }: { onBrowser: () => void }) {
  const mac = platform() === 'mac-safari';
  return (
    <Screen testid="install-first">
      <AppMark />
      <h1>{mac ? 'Add Chess Trainer to your Dock' : 'Add Chess Trainer to your Home Screen'}</h1>
      <p className="lede">It opens like an app, works offline, and you sign in once, there.</p>
      <InstallSteps mac={mac} />
      <button className="link quiet-link" data-testid="install-browser" onClick={() => {
        try {
          localStorage.setItem(BROWSER_OK_KEY, '1');
        } catch {
          // Storage blocked: the guide shows again next time, nothing else changes.
        }
        onBrowser();
      }}>Use it in the browser instead</button>
    </Screen>
  );
}

export function Welcome({ service, error }: { service: AccountService; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Screen testid="welcome">
      <AppMark />
      <h1>Chess Trainer</h1>
      <p className="lede">A lesson, practice from your own games, and a check on what stuck. About half an hour a day.</p>
      {(failed ?? error) && <p className="note is-error" data-testid="sign-in-error">{failed ?? error}</p>}
      <button className="primary big" data-testid="sign-in" disabled={busy} onClick={() => {
        setBusy(true);
        setFailed(null);
        service.signIn().catch((e: Error) => setFailed(e.message)).finally(() => setBusy(false));
      }}>Continue with Google</button>
      <p className="muted small">By invitation. Your progress is saved to your account in Kyran’s Firebase project.</p>
    </Screen>
  );
}

async function ownDb(uid: string): Promise<TrainerDB | null> {
  let name = accountDbName(uid);
  try {
    if (localStorage.getItem(LEGACY_OWNER_KEY) === uid) name = LEGACY_DB;
  } catch {
    // Storage blocked: only the account's own database is looked for.
  }
  if (!(await Dexie.exists(name))) return null;
  const db = openDb(name);
  return (await db.attempts.count()) > 0 || (await db.lessonEvents.count()) > 0 ? db : null;
}

async function downloadBackup(db: TrainerDB): Promise<void> {
  const backup = await exportBackup(db);
  const file = new File([serializeBackup(backup)], backupFileName(backup), { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function NotInvited({ service, uid, email }: { service: AccountService; uid: string; email: string }) {
  const [own, setOwn] = useState<TrainerDB | null>(null);
  useEffect(() => {
    void ownDb(uid).then(setOwn);
  }, [uid]);
  return (
    <Screen testid="not-invited">
      <AppMark />
      <h1>Not on the list yet</h1>
      <p className="lede"><strong>{email}</strong> isn’t on the list for Chess Trainer. Ask Kyran to add it.</p>
      <div className="actions stack">
        <button className="primary big" data-testid="switch-account" onClick={() => void service.signOut().then(() => service.signIn())}>Use another account</button>
        {own && <button className="big" data-testid="download-own" onClick={() => void downloadBackup(own)}>Download your progress</button>}
      </div>
    </Screen>
  );
}

export function AccessError({ service, message }: { service: AccountService; message: string }) {
  return (
    <Screen testid="access-error">
      <AppMark />
      <h1>Can’t sign in right now</h1>
      <p className="lede">{message}</p>
      <div className="actions stack">
        <button className="primary big" data-testid="access-retry" onClick={() => service.recheck()}>Try again</button>
        <button className="big" onClick={() => void service.signOut()}>Use another account</button>
      </div>
    </Screen>
  );
}

export function Restoring() {
  return (
    <Screen testid="restoring">
      <AppMark />
      <h1>Getting your progress</h1>
      <p className="lede">One moment.</p>
    </Screen>
  );
}

interface Player { username: string; name: string | null; avatar: string | null; ratings: { label: string; value: number }[] }

async function lookUp(name: string): Promise<Player | 'none'> {
  const base = `${CHESSCOM_API}/${encodeURIComponent(name.trim().toLowerCase())}`;
  const opts: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) };
  const res = await fetch(base, opts);
  if (res.status === 404) return 'none';
  if (!res.ok) throw new Error(`Chess.com answered ${res.status}. Try again in a minute.`);
  const p = (await res.json()) as { username?: string; name?: string; avatar?: string };
  const stats = (await fetch(`${base}/stats`, opts).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))) as Record<string, { last?: { rating?: number } } | undefined>;
  const ratings = ([['Rapid', 'chess_rapid'], ['Blitz', 'chess_blitz'], ['Daily', 'chess_daily']] as const)
    .map(([label, key]) => ({ label, value: stats[key]?.last?.rating }))
    .filter((r): r is { label: 'Rapid' | 'Blitz' | 'Daily'; value: number } => typeof r.value === 'number');
  return { username: p.username ?? name.trim().toLowerCase(), name: p.name ?? null, avatar: p.avatar ?? null, ratings };
}

/** Find a Chess.com account and confirm it by its name and ratings. Used on first open and on the Account page. */
export function LinkChessCom({ db, service, uid, onDone, skipLabel, compact = false }: {
  db: TrainerDB; service: AccountService; uid: string; onDone: () => void; skipLabel: string;
  /** Inside the Account page: no heading of its own. */
  compact?: boolean;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Player | null>(null);
  async function check() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await lookUp(name);
      if (p === 'none') setError(`No Chess.com player is called “${name.trim()}”.`);
      else setFound(p);
    } catch (e) {
      setError(e instanceof TypeError ? 'Chess.com could not be reached. Check the connection and try again.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(p: Player) {
    await setMeta(db, 'chesscom.username', p.username);
    void service.saveProfile(uid, { chesscom: p.username }).catch(() => {});
    onDone();
  }
  return (
    <div className="link-chesscom" data-testid="link-chesscom">
      {!compact && <h1>Your Chess.com account</h1>}
      {!compact && <p className="lede">Your games come in by themselves, and practice is built from them.</p>}
      {found ? (
        <>
          <div className="player-card" data-testid="chesscom-found">
            {found.avatar ? <img src={found.avatar} alt="" width={56} height={56} referrerPolicy="no-referrer" /> : <span className="player-initial" aria-hidden>{(found.name ?? found.username)[0]!.toUpperCase()}</span>}
            <div>
              <p className="player-name">{found.name ?? found.username}</p>
              <p className="muted small">{found.username}</p>
              {found.ratings.length > 0 && <p className="player-ratings">{found.ratings.map((r) => <span key={r.label}>{r.label} <strong>{r.value}</strong></span>)}</p>}
            </div>
          </div>
          <div className="actions stack">
            <button className="primary big" data-testid="chesscom-confirm" onClick={() => void confirm(found)}>That’s me</button>
            <button className="big" data-testid="chesscom-not-me" onClick={() => setFound(null)}>Not me</button>
          </div>
        </>
      ) : (
        <form className="actions stack" onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <label className="field">
            <span>Chess.com username</span>
            <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={name} data-testid="chesscom-input" onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p className="note is-error" data-testid="chesscom-error">{error}</p>}
          <button className="primary big" type="submit" data-testid="chesscom-check" disabled={busy || !name.trim()}>{busy ? 'Looking…' : 'Find me'}</button>
        </form>
      )}
      <button className="link quiet-link" data-testid="chesscom-skip" onClick={onDone}>{skipLabel}</button>
    </div>
  );
}

export const lookAskedKey = (uid: string): string => `ct.lookAsked.${uid}`;

/** Pick a look (ADR-064): on first open after hello, and once for accounts set up before looks existed. */
export function LookStep({ db, uid, onDone }: { db: TrainerDB; uid: string; onDone: () => void }) {
  const [look, setLook] = useState<LookId>(currentLook());
  async function done() {
    await setMeta(db, LOOK_SETTING, look);
    try {
      localStorage.setItem(lookAskedKey(uid), '1');
    } catch {
      // Storage blocked: the setting in the account is what counts.
    }
    onDone();
  }
  return (
    <Screen testid="first-look">
      <h1>Pick a look</h1>
      <p className="lede">You can change it any time on your Account page.</p>
      <LookPicker value={look} onPick={setLook} />
      <button className="primary big" data-testid="look-continue" onClick={() => void done()}>Continue</button>
    </Screen>
  );
}

/** First open of an invited account: hello, a look, install where the browser offers it, Chess.com. */
export function FirstOpen({ db, service, uid, name, onDone }: { db: TrainerDB; service: AccountService; uid: string; name: string; onDone: () => void }) {
  const [step, setStep] = useState<'hello' | 'look' | 'install' | 'link'>('hello');
  const [, bump] = useState(0);
  useEffect(() => onInstallPromptChange(() => bump((x) => x + 1)), []);
  const prompt = installPrompt();
  const finish = () => {
    try {
      localStorage.setItem(`ct.onboarded.${uid}`, '1');
    } catch {
      // Storage blocked: the profile on the server remembers it.
    }
    void service.saveProfile(uid, { onboarded: true }).catch(() => {});
    onDone();
  };
  if (step === 'hello') {
    return (
      <Screen testid="hello">
        <AppMark />
        <h1>Hi, {name}</h1>
        <p className="lede">Welcome to Chess Trainer. Two quick steps and you’re in.</p>
        <button className="primary big" data-testid="hello-continue" onClick={() => setStep('look')}>Continue</button>
      </Screen>
    );
  }
  if (step === 'look') return <LookStep db={db} uid={uid} onDone={() => setStep(prompt ? 'install' : 'link')} />;
  if (step === 'install' && prompt) {
    return (
      <Screen testid="install-offer">
        <AppMark />
        <h1>Install the app</h1>
        <p className="lede">It opens from your home screen and works offline.</p>
        <div className="actions stack">
          <button className="primary big" data-testid="install-now" onClick={() => void prompt().finally(() => setStep('link'))}>Install</button>
          <button className="big" data-testid="install-later" onClick={() => setStep('link')}>Not now</button>
        </div>
      </Screen>
    );
  }
  return (
    <Screen testid="first-link">
      <LinkChessCom db={db} service={service} uid={uid} onDone={finish} skipLabel="I don’t play on Chess.com" />
    </Screen>
  );
}
