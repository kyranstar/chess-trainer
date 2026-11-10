/**
 * Automatic import of the owner's own games and ratings from Chess.com's Published-Data API,
 * straight from the device (the API answers cross-origin requests).
 *
 * Only when the owner has entered their username. Only their own public games and ratings.
 * Strictly serial, one pass per sync: stats, the archive list, then months that were never
 * read plus the current month. Past months never change, so they are read once. A 429 or a
 * network failure ends the pass quietly; everything already stored stays.
 *
 * Game ids are the same hash of the game link that the Mac pipeline uses, so a game that
 * arrives by both routes is one row, and a stored analysis is never overwritten from here.
 */
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { getMeta, setMeta, type TrainerDB } from '../db/db';
import type { GameRecord, PipelineGame, TimeClass } from './types';

export const CHESSCOM_API = 'https://api.chess.com/pub/player';

export interface SyncResponse {
  status: number;
  json: unknown;
  etag: string | null;
}
/** (url, etag we already hold or null) -> response. Throws when the network is unreachable. */
export type SyncFetch = (url: string, etag: string | null) => Promise<SyncResponse>;

/** Browser transport. `no-cache` makes the browser revalidate with its own stored ETag. */
export const browserFetch: SyncFetch = async (url) => {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
  return { status: res.status, json: res.ok ? await res.json() : null, etag: res.headers.get('ETag') };
};

export async function gameIdFromUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

interface ApiGame {
  url?: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  rated?: boolean;
  rules?: string;
  white?: { username?: string; rating?: number };
  black?: { username?: string; rating?: number };
}

export type SkipReason = 'notPlayer' | 'variant' | 'computer' | 'empty';
const CLK = /\[%clk (\d+):(\d\d):(\d\d(?:\.\d+)?)\]/;
const CLASSES: TimeClass[] = ['rapid', 'blitz', 'bullet', 'daily'];

/** Chess.com's boundaries: estimated duration = base + 40 x increment; under 3 min bullet, under 10 blitz. */
export function timeClassOf(tc: string): TimeClass {
  if (!tc || tc === '-') return 'unknown';
  if (tc.includes('/')) return 'daily';
  const [base, inc] = tc.split('+');
  const est = Number(base) + 40 * Number(inc ?? 0);
  if (!Number.isFinite(est)) return 'unknown';
  return est < 180 ? 'bullet' : est < 600 ? 'blitz' : 'rapid';
}

export async function convertChessComGame(raw: unknown, username: string): Promise<{ game?: PipelineGame & { rated?: boolean }; skipped?: SkipReason }> {
  const g = raw as ApiGame;
  const me = username.toLowerCase();
  const white = g.white?.username ?? '';
  const black = g.black?.username ?? '';
  if (white.toLowerCase() !== me && black.toLowerCase() !== me) return { skipped: 'notPlayer' };
  if (g.rules && g.rules !== 'chess') return { skipped: 'variant' };
  const parsed = parsePgn(g.pgn ?? '')[0];
  if (!parsed) return { skipped: 'empty' };
  const h = parsed.headers;
  if ((h.get('Event') ?? '').startsWith('Play vs') || (g.url ?? '').includes('/game/computer/')) return { skipped: 'computer' };
  if (h.get('SetUp') === '1' || (h.get('Variant') && h.get('Variant') !== 'Standard')) return { skipped: 'variant' };
  const start = startingPosition(h);
  if (start.isErr) return { skipped: 'variant' };
  const pos = start.value;
  const moves: string[] = [];
  const clocks: (number | null)[] = [];
  for (const node of parsed.moves.mainline()) {
    const move = parseSan(pos, node.san);
    if (!move) break;
    moves.push(makeUci(move));
    pos.play(move);
    const m = (node.comments ?? []).join(' ').match(CLK);
    clocks.push(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
  }
  if (moves.length === 0) return { skipped: 'empty' };
  const color = white.toLowerCase() === me ? 'white' : 'black';
  const result = h.get('Result');
  const outcome = result === '1/2-1/2' ? 'draw' : result === '1-0' ? (color === 'white' ? 'win' : 'loss') : result === '0-1' ? (color === 'black' ? 'win' : 'loss') : null;
  const tc = g.time_control ?? h.get('TimeControl') ?? '';
  const dash = (s: string | undefined) => (s ?? '').replace(/\./g, '-');
  const url = g.url ?? h.get('Link') ?? '';
  const timeClass = CLASSES.includes(g.time_class as TimeClass) ? (g.time_class as TimeClass) : timeClassOf(tc);
  return {
    game: {
      id: await gameIdFromUrl(url),
      source: 'chess.com',
      url: url || null,
      date: dash(h.get('UTCDate') ?? h.get('Date')),
      endDate: dash(h.get('EndDate') ?? h.get('UTCDate') ?? h.get('Date')),
      endTime: h.get('EndTime') ?? h.get('UTCTime') ?? null,
      timeControl: tc,
      timeClass,
      color,
      result: outcome,
      termination: h.get('Termination') ?? null,
      playerRating: (color === 'white' ? g.white?.rating : g.black?.rating) ?? null,
      opponentRating: (color === 'white' ? g.black?.rating : g.white?.rating) ?? null,
      opponent: color === 'white' ? black : white,
      moves,
      clocks: clocks.some((c) => c !== null) ? clocks : null,
      analysis: null,
      rated: g.rated,
    },
  };
}

export interface RatingSnapshot {
  checkedAt: number;
  rapid?: { rating: number; date: number };
  blitz?: { rating: number; date: number };
  daily?: { rating: number; date: number };
  bullet?: { rating: number; date: number };
}

export interface SyncReport {
  status: 'ok' | 'offline' | 'rate-limited' | 'not-found' | 'error';
  added: number;
  skipped: Partial<Record<SkipReason, number>>;
  monthsRead: number;
  ratings: RatingSnapshot | null;
  at: number;
  detail?: string;
}

function ratingsFrom(stats: unknown, now: number): RatingSnapshot {
  const s = stats as Record<string, { last?: { rating?: number; date?: number } } | undefined>;
  const pick = (k: string) => (typeof s[k]?.last?.rating === 'number' ? { rating: s[k]!.last!.rating!, date: s[k]!.last!.date ?? 0 } : undefined);
  return { checkedAt: now, rapid: pick('chess_rapid'), blitz: pick('chess_blitz'), daily: pick('chess_daily'), bullet: pick('chess_bullet') };
}

/** One pass: ratings, then every month never read plus the newest month. Never throws. */
export async function syncChessCom(db: TrainerDB, fetcher: SyncFetch, username: string, now: number = Date.now()): Promise<SyncReport> {
  const report: SyncReport = { status: 'ok', added: 0, skipped: {}, monthsRead: 0, ratings: null, at: now };
  const base = `${CHESSCOM_API}/${encodeURIComponent(username.trim().toLowerCase())}`;
  const etags = (await getMeta<Record<string, string>>(db, 'chesscom.etags')) ?? {};
  const fail = (status: number): SyncReport['status'] | null => (status === 429 ? 'rate-limited' : status === 404 ? 'not-found' : status >= 400 ? 'error' : null);
  try {
    const stats = await fetcher(`${base}/stats`, null);
    const bad = fail(stats.status);
    if (bad) return finish(db, { ...report, status: bad, detail: `stats: HTTP ${stats.status}` });
    report.ratings = ratingsFrom(stats.json, now);
    await setMeta(db, 'chesscom.ratings', report.ratings);

    const list = await fetcher(`${base}/games/archives`, null);
    const badList = fail(list.status);
    if (badList) return finish(db, { ...report, status: badList, detail: `archives: HTTP ${list.status}` });
    const months = [...((list.json as { archives?: string[] })?.archives ?? [])].sort();
    const latest = months[months.length - 1];
    for (const url of months) {
      if (url !== latest && etags[url]) continue; // a past month, already read: it cannot change
      const res = await fetcher(url, etags[url] ?? null);
      if (res.status === 304) continue;
      const badMonth = fail(res.status);
      if (badMonth) return finish(db, { ...report, status: badMonth, detail: `${url.slice(-7)}: HTTP ${res.status}` });
      report.monthsRead++;
      for (const raw of (res.json as { games?: unknown[] })?.games ?? []) {
        const { game, skipped } = await convertChessComGame(raw, username);
        if (skipped) {
          report.skipped[skipped] = (report.skipped[skipped] ?? 0) + 1;
          continue;
        }
        if (!game) continue;
        const have = await db.games.get(game.id);
        if (have) {
          // A game that arrived as a PGN file does not say whether it was rated; the API does.
          if (have.rated === undefined && game.rated !== undefined) await db.games.put({ ...have, rated: game.rated, updatedAt: now });
          continue;
        }
        const row: GameRecord = { ...game, importedAt: now, updatedAt: now, analysisKey: null };
        await db.games.add(row);
        report.added++;
      }
      etags[url] = res.etag ?? 'read';
      await setMeta(db, 'chesscom.etags', etags);
    }
    return finish(db, report);
  } catch {
    return finish(db, { ...report, status: 'offline' });
  }
}

async function finish(db: TrainerDB, report: SyncReport): Promise<SyncReport> {
  await setMeta(db, 'chesscom.lastSync', { at: report.at, status: report.status, added: report.added, detail: report.detail ?? null });
  return report;
}
