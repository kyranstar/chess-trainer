/**
 * Device check: the app tests its own plumbing on the device it is running on (storage that
 * survives closing, backup and restore, offline cache, content integrity, the rules library,
 * the endgame table). It uses throwaway databases and never touches the learner's history.
 */
import { applyUci, fenOf, legalDests, positionFromFen } from '../chess/rules';
import { exportBackup, importBackup, serializeBackup } from '../db/backup';
import { deleteDb, openDb, recordAttempt, type TrainerDB } from '../db/db';
import { packStatus } from '../db/pack';
import { distanceKpk, keepingMoves, probeKpk } from '../endgames/kpk';

export interface CheckResult {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'info';
  detail: string;
}

const result = (id: string, label: string, status: CheckResult['status'], detail: string): CheckResult => ({ id, label, status, detail });

/** Number of legal move sequences of the given length (a standard move-generator test). */
export function perft(fen: string, depth: number): number {
  const pos = positionFromFen(fen);
  let n = 0;
  for (const [from, tos] of legalDests(pos)) {
    for (const to of tos) {
      // chessground-style destinations list castling twice (king-two-squares and king-takes-rook).
      const king = pos.board.king.has(sq(from)) && pos.board[pos.turn].has(sq(to)) && pos.board.rook.has(sq(to));
      if (king) continue;
      const promo = pos.board.pawn.has(sq(from)) && (to[1] === '8' || to[1] === '1');
      for (const u of promo ? ['q', 'r', 'b', 'n'].map((p) => `${from}${to}${p}`) : [`${from}${to}`]) {
        n += depth === 1 ? 1 : perft(fenOf(applyUci(pos, u)), depth - 1);
      }
    }
  }
  return n;
}
const sq = (name: string) => name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8;

export async function checkRules(): Promise<CheckResult> {
  const got = perft('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2);
  return result('rules', 'Chess rules', got === 2039 ? 'pass' : 'fail', got === 2039 ? 'Move generation matches the reference count (castling, en passant, promotion, pins).' : `Expected 2039 move sequences, counted ${got}.`);
}

export async function checkEndgameTable(): Promise<CheckResult> {
  const fen = '8/4k3/8/5K2/4P3/8/8/8 w - - 0 1';
  const ok = probeKpk(fen) === 'win' && keepingMoves(fen).join() === 'f5e5' && (distanceKpk(fen) ?? 0) > 0 && probeKpk('k7/8/K7/P7/8/8/8/8 w - - 0 1') === 'draw';
  return result('endgame-table', 'Endgame table', ok ? 'pass' : 'fail', ok ? 'King-and-pawn table answers known positions correctly.' : 'The king-and-pawn table gave a wrong answer.');
}

/** Writes an attempt, closes and reopens the database, backs it up and restores it elsewhere. */
export async function checkStorageRoundTrip(): Promise<CheckResult> {
  const a = `device-check-a-${Math.random().toString(36).slice(2)}`;
  const b = `device-check-b-${Math.random().toString(36).slice(2)}`;
  let db: TrainerDB | null = null;
  let db2: TrainerDB | null = null;
  try {
    db = openDb(a);
    const written = await recordAttempt(db, {
      sessionId: null, context: 'practice', exerciseId: 'lichess:device-check', exerciseKind: 'puzzle', contentVersion: 'device-check', conceptId: null,
      themes: [], rating: 1000, ts: Date.now(), elapsedMs: 1, firstMove: 'e2e4', played: [], mistakes: 1, hints: 0, outcome: 'fail', acceptedAlternative: false,
    });
    db.close();
    db = openDb(a);
    const read = await db.attempts.get(written.uuid);
    if (!read || read.outcome !== 'fail') throw new Error('an attempt written to storage could not be read back after reopening');
    if ((await db.reviewStates.count()) !== 1) throw new Error('the review schedule was not stored with the attempt');
    const file = serializeBackup(await exportBackup(db));
    db2 = openDb(b);
    const report = await importBackup(db2, file);
    if (report.added.attempts !== 1 || (await db2.reviewStates.count()) !== 1) throw new Error('a backup did not restore into a clean database');
    return result('storage', 'Storage, backup and restore', 'pass', 'Wrote a test record, reopened the database, exported a backup and restored it in a second database. Test data removed.');
  } catch (e) {
    return result('storage', 'Storage, backup and restore', 'fail', (e as Error).message);
  } finally {
    db?.close();
    db2?.close();
    await deleteDb(a).catch(() => undefined);
    await deleteDb(b).catch(() => undefined);
  }
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Browser-only checks: service worker, offline cache, installed content, persistence. */
export async function runBrowserChecks(db: TrainerDB): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  out.push(result('secure', 'Secure connection', window.isSecureContext ? 'pass' : 'fail', window.isSecureContext ? 'Served over HTTPS (or localhost), so offline support can work.' : 'Not a secure page: offline support and storage protection are unavailable. Open the https address.'));

  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  out.push(result('service-worker', 'Offline engine', reg?.active ? 'pass' : 'fail', reg?.active ? `Service worker active${navigator.serviceWorker.controller ? ' and controlling this page' : '; it takes over on the next launch'}.` : 'No active service worker yet. Stay online, reload once, and run the check again.'));

  const wanted = ['./index.html', './packs/lichess-core.json', './packs/openings-lichess.json'];
  const cached = 'caches' in window ? await Promise.all(wanted.map((u) => caches.match(new URL(u, document.baseURI).href, { ignoreSearch: true }))) : [];
  const missing = wanted.filter((_, i) => !cached[i]);
  out.push(result('offline-cache', 'Files stored for offline use', cached.length && missing.length === 0 ? 'pass' : 'fail', cached.length && missing.length === 0 ? 'The app, the practice positions and the opening data are in the offline cache.' : `Not cached yet: ${missing.join(', ') || 'cache storage unavailable'}.`));

  const pack = await packStatus(db);
  let packOk = pack.state === 'installed' && pack.puzzleCount === pack.manifest?.count;
  let packDetail = packOk ? `${pack.puzzleCount} practice positions installed (pack ${pack.manifest!.version}).` : 'The practice pack is not fully installed.';
  if (packOk) {
    try {
      const body = await (await fetch(new URL(`./packs/${pack.manifest!.file}`, document.baseURI).href)).text();
      const same = `sha256:${await sha256Hex(body)}` === pack.manifest!.contentHash;
      packOk = same;
      packDetail += same ? ' File checksum verified.' : ' File checksum does NOT match the manifest.';
    } catch {
      packDetail += ' File could not be re-read for a checksum (not cached).';
      packOk = false;
    }
  }
  out.push(result('pack', 'Practice content', packOk ? 'pass' : 'fail', packDetail));

  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  out.push(result('installed', 'Installed to Home Screen', 'info', standalone ? 'Yes: running as an installed app. Its storage is not subject to Safari’s seven-day clearing.' : 'No: running in a browser tab. On iPhone use Share, then Add to Home Screen; progress made in the tab does not carry over.'));

  const persisted = await navigator.storage?.persisted?.();
  out.push(result('persistence', 'Storage protection', persisted === undefined ? 'info' : persisted ? 'pass' : 'info', persisted === undefined ? 'This browser does not report it.' : persisted ? 'Granted: the browser will not clear this data on its own.' : 'Not granted. The browser may clear site data under storage pressure; keep backups.'));

  const est = await navigator.storage?.estimate?.();
  out.push(result('space', 'Space', 'info', est?.usage !== undefined && est.quota ? `${(est.usage / 1e6).toFixed(1)} MB used of about ${(est.quota / 1e9).toFixed(1)} GB allowed.` : 'Not reported by this browser.'));

  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  out.push(result('export', 'Saving a backup file', 'info', canShare ? 'Share sheet with files is available (use “Share or save to Files”).' : 'Share sheet with files is not available here; “Download backup” is used instead.'));

  const counts = { attempts: await db.attempts.count(), games: await db.games.count(), repertoire: await db.repertoire.count() };
  out.push(result('history', 'Your data on this device', 'info', `${counts.attempts} attempts, ${counts.games} games, ${counts.repertoire} repertoire moves.`));
  return out;
}

export async function runAllChecks(db: TrainerDB): Promise<CheckResult[]> {
  return [...(await runBrowserChecks(db)), await checkStorageRoundTrip(), await checkRules(), await checkEndgameTable()];
}
