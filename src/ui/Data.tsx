import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { type Learner, useDb, usePack } from '../app/store';
import { SOURCES } from '../content';
import { backupFileName, exportBackup, importBackup, serializeBackup } from '../db/backup';
import { getMeta, setMeta } from '../db/db';
import { installPack } from '../db/pack';
import { browserRemoteFetch, clearRemote, DEFAULT_REMOTE_REPO, REMOTE_REPO_KEY, REMOTE_STATE_KEY, remoteMessage, type RemoteState, setRemote, uploadBackup } from '../db/remote';
import { GamesImport } from './Games';

/**
 * A copy of the backup in the learner's own private GitHub repository (ADR-048). Off until a
 * repository and a token are entered here; the token stays on this device.
 */
function RemoteCopy() {
  const db = useDb();
  const repo = useLiveQuery(() => getMeta<string>(db, REMOTE_REPO_KEY), [db]);
  const state = useLiveQuery(() => getMeta<RemoteState>(db, REMOTE_STATE_KEY), [db]);
  const [repoField, setRepoField] = useState(DEFAULT_REMOTE_REPO);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function send() {
    setBusy(true);
    const r = await uploadBackup(db, browserRemoteFetch, Date.now());
    setNote({ kind: r.ok ? 'ok' : 'error', text: remoteMessage(r) });
    setBusy(false);
  }
  async function start() {
    try {
      await setRemote(db, repoField, token);
      setToken('');
      await send();
    } catch (e) {
      setNote({ kind: 'error', text: (e as Error).message });
    }
  }
  async function stop() {
    await clearRemote(db);
    setNote({ kind: 'ok', text: 'Stopped. The token has been removed from this device; what was already sent stays in the repository.' });
  }

  return (
    <section className="card" data-testid="card-remote" data-on={!!repo}>
      <h2>Private copy for review</h2>
      {repo ? (
        <>
          <p data-testid="remote-status">This device sends its backup to your private repository <strong>{repo}</strong> whenever your practice data has changed and there is a connection. {state ? `Last sent ${new Date(state.at).toLocaleString()} (${(state.bytes / 1024).toFixed(0)} KB).` : 'Nothing has been sent yet.'}</p>
          <div className="actions">
            <button className="primary" data-testid="remote-send" disabled={busy} onClick={() => void send()}>{busy ? 'Sending' : 'Send now'}</button>
            <button data-testid="remote-stop" disabled={busy} onClick={() => void stop()}>Stop and forget the token</button>
          </div>
        </>
      ) : (
        <>
          <p>Off. With a private GitHub repository of your own and a token for it, this device puts its backup file there whenever your practice data changes. That is a copy outside this phone, and it lets your practice be reviewed from your computer without exporting a file. The token is kept on this device only and is sent to GitHub alone.</p>
          <label className="field">Repository (owner/name)
            <input data-testid="remote-repo" value={repoField} onChange={(e) => setRepoField(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="yourname/chess-trainer-data" />
          </label>
          <label className="field">Token for that repository (Contents: read and write)
            <input data-testid="remote-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <div className="actions"><button className="primary" data-testid="remote-start" disabled={busy || !token.trim() || !repoField.trim()} onClick={() => void start()}>Start sending</button></div>
        </>
      )}
      {note && <p className={`note ${note.kind === 'error' ? 'is-error' : 'is-ok'}`} role="status" data-testid="remote-note">{note.text}</p>}
    </section>
  );
}

/** Backup, restore, storage durability, installed content and licences. */
export function DataPanel({ learner }: { learner: Learner }) {
  const db = useDb();
  const pack = usePack();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMeta<number>(db, 'lastBackupAt').then((t) => setLastBackup(t ?? null));
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1e6).toFixed(1)} MB used`));
  }, [db]);

  async function makeFile(): Promise<File> {
    const backup = await exportBackup(db);
    await setMeta(db, 'lastBackupAt', Date.now());
    setLastBackup(Date.now());
    return new File([serializeBackup(backup)], backupFileName(backup), { type: 'application/json' });
  }

  async function download() {
    const file = await makeFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage({ kind: 'ok', text: `Backup written: ${file.name} (${learner.attempts.length} attempts). Keep it somewhere outside this browser.` });
  }

  async function share() {
    const file = await makeFile();
    try {
      await navigator.share({ files: [file], title: 'Chess Trainer backup' });
      setMessage({ kind: 'ok', text: `Backup shared: ${file.name}. Choose “Save to Files” to keep it.` });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage({ kind: 'error', text: 'Sharing failed on this device. Use “Download backup” instead.' });
    }
  }

  async function restore(file: File) {
    setBusy(true);
    try {
      const report = await importBackup(db, await file.text());
      setMessage({
        kind: 'ok',
        text: `Restored from ${report.manifest.exportTime.slice(0, 10)}: added ${report.added.attempts} attempts, ${report.added.lessonEvents} lesson records and ${report.added.sessions} sessions. Nothing already on this device was removed.`,
      });
    } catch (e) {
      setMessage({ kind: 'error', text: `${(e as Error).message} Nothing on this device was changed.` });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function persist() {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
  }

  async function reinstall() {
    setBusy(true);
    try {
      const row = await installPack(db);
      setMessage({ kind: 'ok', text: `Practice pack ${row.manifest.version} is installed (${row.manifest.count} positions).` });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const remoteRepo = useLiveQuery(() => getMeta<string>(db, REMOTE_REPO_KEY), [db]);
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  const m = pack?.manifest;

  return (
    <>
      <section className="card" data-testid="card-data">
        <h2>Your data</h2>
        <p>
          Everything is stored only in this browser on this device: {learner.attempts.length} attempts, {learner.events.length} lesson records. {remoteRepo ? `A copy of the backup is sent to your private repository ${remoteRepo} (set up below); nothing else is uploaded.` : 'Nothing is uploaded.'} The only outside service the app ever contacts is Chess.com’s public API, to read your own games and ratings, and only if a username is set below.
          {' '}Progress lives on this device only; a backup file is the way to keep a copy or to move it to another device.
        </p>
        <p className="definition-small" data-testid="last-backup">
          {lastBackup ? `Last backup made ${new Date(lastBackup).toLocaleString()}.` : 'No backup has been made from this device.'}
          {' '}Browsers can clear site storage, so a backup file is the only durable copy.
        </p>
        <div className="actions">
          <button className="primary" data-testid="backup-download" onClick={() => void download()}>Download backup</button>
          {canShare && <button data-testid="backup-share" onClick={() => void share()}>Share or save to Files</button>}
          <button data-testid="restore-button" disabled={busy} onClick={() => fileInput.current?.click()}>Restore from backup</button>
          <input ref={fileInput} data-testid="restore-input" type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        </div>
        {message && <p className={`note ${message.kind === 'error' ? 'is-error' : 'is-ok'}`} role="status" data-testid="data-message">{message.text}</p>}
        <p className="definition-small" data-testid="persist-state">
          Storage protection: {persisted === null ? 'not reported by this browser' : persisted ? 'granted (the browser will not clear this data on its own)' : 'not granted yet'}.{usage ? ` ${usage}.` : ''}
        </p>
        <div className="actions">
          {persisted === false && <button onClick={() => void persist()}>Ask the browser to protect storage</button>}
          <a className="button" data-testid="open-device-check" href="#/progress/device-check">Check this device</a>
        </div>
      </section>

      <RemoteCopy />

      <GamesImport />

      <section className="card" data-testid="card-content">
        <h2>Installed content</h2>
        {m ? (
          <>
            <p data-testid="pack-info">{pack.puzzleCount} practice positions, pack {m.version} ({(m.bytes / 1e6).toFixed(1)} MB), from the {m.source.title} ({m.source.license}).</p>
            <p className="definition-small">{m.verification.engine ? `Checked with ${m.verification.engine} at ${m.verification.limit?.nodes?.toLocaleString()} nodes per move: ${m.verification.passed} of ${m.verification.checked} candidates kept. ` : ''}{m.verification.policy}</p>
          </>
        ) : (
          <p data-testid="pack-info">No practice pack is installed.</p>
        )}
        <div className="actions"><button disabled={busy} onClick={() => void reinstall()}>{m ? 'Check for a newer pack' : 'Download practice pack'}</button></div>
        <h3>Sources and licences</h3>
        <ul className="source-list">
          {SOURCES.map((s) => (
            <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>, {s.author}. {s.licenseNotes}</li>
          ))}
          <li><a href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer">Lichess puzzle database</a> and puzzle theme definitions: CC0.</li>
          <li>Board and rules: chessground and chessops by Lichess, GPL-3.0-or-later. This app is licensed GPL-3.0-or-later. <a href="./source.tar.gz">Download the source of this build</a> (available where the app is hosted).</li>
          <li>Typefaces: Atkinson Hyperlegible Next and Literata, SIL Open Font License 1.1.</li>
        </ul>
        <p className="definition-small">Chess Trainer {__APP_VERSION__}. Lessons on Chess.com, Chessreps and Lichess are linked, never copied.</p>
      </section>
    </>
  );
}
