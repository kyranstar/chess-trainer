import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { href } from '../app/router';
import { type Learner, useDb, useDueReviews, useFocusMode, useNow } from '../app/store';
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../chess/rules';
import { getMeta, recordAttempt, setMeta } from '../db/db';
import { formatPct } from '../metrics/metrics';
import { declineEntry, DOUBTFUL_KEY, refreshRepertoire } from '../openings/auto';
import { DEFAULT_BAND, loadOpeningBook } from '../openings/book';
import { COURSES, courseFor, leftRepertoire, needsConfirming } from '../openings/courses';
import { useArmed, useScreenChange } from '../app/tapGuard';
import type { Doubtful } from '../openings/fromGames';
import { entriesFromPgn, repertoireToPgn } from '../openings/pgn';
import { classifyMove, type Decision, drillId, makeEntry, type MoveEvidence, type OpeningBook, type RepertoireEntry, type Side, SOUND_MARGIN, walkRepertoire } from '../openings/repertoire';
import { Board } from './Board';

let bookCache: OpeningBook | null | undefined;

/** The move-frequency book (a static, precached file). `null` when it is not available. */
export function useOpeningBook(): OpeningBook | null | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (bookCache !== undefined && bookCache !== null) return;
    let live = true;
    void loadOpeningBook().then((b) => {
      bookCache = b;
      if (live) bump((x) => x + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  return bookCache;
}

/** How a move got into the repertoire, in a few words. */
export function sourceLabel(e: RepertoireEntry): string {
  if (e.source === 'own-games') return `${e.games ? `from your games: played in ${e.games.played} of ${e.games.reached}` : 'from your games'}${needsConfirming(e) ? '; not yet confirmed against your course' : ''}`;
  if (e.source === 'suggested') return 'suggested: the sound move most played at your level';
  return 'recorded by you';
}

export function useRepertoire(): RepertoireEntry[] {
  const db = useDb();
  return useLiveQuery(() => db.repertoire.toArray(), [db]) ?? [];
}

export { DEFAULT_BAND };

export function useOpeningPrefs(): { band: number; side: Side; setBand: (b: number) => void; setSide: (s: Side) => void } {
  const db = useDb();
  const [band, setBandState] = useState(DEFAULT_BAND);
  const [side, setSideState] = useState<Side>('white');
  useEffect(() => {
    void getMeta<number>(db, 'openings.band').then((b) => b !== undefined && setBandState(b));
    void getMeta<Side>(db, 'openings.side').then((s) => s && setSideState(s));
  }, [db]);
  return {
    band,
    side,
    setBand: (b) => { setBandState(b); void setMeta(db, 'openings.band', b); },
    setSide: (s) => { setSideState(s); void setMeta(db, 'openings.side', s); },
  };
}

export function bandLabel(book: OpeningBook, i: number): string {
  const lo = book.manifest.bands[i]!;
  const hi = book.manifest.bands[i + 1];
  return lo === 0 ? `under ${hi}` : hi === undefined ? `${lo}+` : `${lo}–${hi - 1}`;
}

export function pathText(path: string[]): string {
  if (path.length === 0) return 'the starting position';
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

function EvidenceText({ ev, san }: { ev: MoveEvidence; san: string }) {
  return (
    <div className={`verdict ${ev.verdict === 'weaker' ? 'wrong' : 'neutral'}`} data-testid="move-evidence" data-verdict={ev.verdict}>
      <strong>{san}</strong>
      {ev.played !== undefined && <p>Played here by {formatPct(ev.played)} of players at this level.</p>}
      {ev.verdict === 'sound' && <p>Engine evidence: about {Math.round(ev.wp!)}% expected score after it; the engine’s first choice scores {Math.round(ev.bestWp!)}%. Within {SOUND_MARGIN} points counts as sound here.</p>}
      {ev.verdict === 'weaker' && <p>Engine evidence: about {Math.round(ev.wp!)}% expected score after it, against {Math.round(ev.bestWp!)}% for the engine’s first choice ({ev.bestSan}). That is a clear gap. It is your repertoire: keep it or choose another move.</p>}
      {ev.verdict === 'unknown' && <p>No engine evaluation is stored for this move here, so nothing is claimed about it.</p>}
    </div>
  );
}

/** Recall of one repertoire move. Disclosed recall mode: only the chosen move counts as recalled. */
export function OpeningDrill({ entry, book, band, sessionId, heading, onDone }: {
  entry: RepertoireEntry; book: OpeningBook | null | undefined; band: number; sessionId: string | null; heading?: string; onDone: () => void;
}) {
  const db = useDb();
  useFocusMode();
  const [result, setResult] = useState<{ ok: boolean; playedSan: string | null; ev: MoveEvidence | null; shown: boolean } | null>(null);
  const [fen, setFen] = useState(entry.fen);
  const [resetKey, setResetKey] = useState(0);
  const started = useRef(Date.now());
  const playedUci = useRef<string | null>(null);
  const [adopted, setAdopted] = useState<string | null>(null);

  /** A move the app put in (from his games, or a suggestion) gives way to the sound move he prefers. */
  async function adopt() {
    if (!playedUci.current) return;
    const mine = makeEntry(entry.side, entry.fen, entry.path, playedUci.current, Date.now());
    await db.repertoire.put(mine);
    setAdopted(mine.san);
    void refreshRepertoire(db);
  }

  async function record(uci: string | null, shown: boolean) {
    const pos = positionFromFen(entry.fen);
    const ok = !!uci && sameMove(pos, uci, entry.uci);
    const ev = uci && !ok && book ? classifyMove(book, entry.positionKey, uci, [band]) : null;
    playedUci.current = uci;
    setResult({ ok, playedSan: uci ? sanOf(pos, uci) : null, ev, shown });
    setFen(fenOf(applyUci(pos, entry.uci)));
    setResetKey((k) => k + 1);
    await recordAttempt(db, {
      sessionId, context: 'review', exerciseId: drillId(entry), exerciseKind: 'opening', contentVersion: `repertoire@${entry.updatedAt}`,
      conceptId: null, themes: [], rating: null, ts: Date.now(), elapsedMs: Date.now() - started.current, firstMove: uci, played: uci ? [uci] : [],
      mistakes: ok || shown ? 0 : 1, hints: shown ? 1 : 0, outcome: shown ? 'assisted' : ok ? 'success' : 'fail', acceptedAlternative: false,
      ...(ev ? { altVerdict: ev.verdict } : {}),
    });
  }

  return (
    <section className="puzzle" data-testid="opening-drill" data-expected={result ? '' : entry.uci} data-done={!!result}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>Your move as {entry.side === 'white' ? 'White' : 'Black'}</h2>
        <p className="muted">After {pathText(entry.path)}. Recall mode: only the repertoire move counts for the review schedule.{entry.source ? ` This one is ${sourceLabel(entry)}.` : ''}</p>
      </header>
      <Board fen={fen} orientation={entry.side} movable={result ? null : entry.side} lastMove={result ? entry.uci : null} onMove={(u) => void record(u, false)} resetKey={resetKey} />
      <div className="feedback" aria-live="polite">
        {result?.ok && <div className="verdict right" data-testid="drill-verdict" data-ok="true"><strong>{entry.san}: recalled.</strong></div>}
        {result && !result.ok && (
          <div className="verdict neutral" data-testid="drill-verdict" data-ok="false" data-alt={result.ev?.verdict ?? ''}>
            <strong>Your repertoire move is {entry.san}.</strong>
            {result.playedSan && result.ev?.verdict === 'sound' && <p>{result.playedSan} is also sound ({Math.round(result.ev.wp!)} against {Math.round(result.ev.bestWp!)} for the engine’s first choice).</p>}
            {result.playedSan && result.ev?.verdict === 'weaker' && <p>{result.playedSan} is weaker ({Math.round(result.ev.wp!)} against {Math.round(result.ev.bestWp!)} for the engine’s first choice).</p>}
            {result.playedSan && (!result.ev || result.ev.verdict === 'unknown') && <p>No evaluation is stored for {result.playedSan} here.</p>}
            {result.shown && <p>Shown: counts as assisted.</p>}
            {adopted && <p data-testid="drill-adopted">{adopted} is now your move here.</p>}
          </div>
        )}
      </div>
      <div className="actions">
        {!result && <button onClick={() => void record(null, true)}>Show my move</button>}
        {result && !result.ok && !adopted && entry.source && result.playedSan && result.ev?.verdict === 'sound' && (
          <button data-testid="drill-adopt" onClick={() => void adopt()}>Make {result.playedSan} my move here</button>
        )}
        {result && <button className="primary" data-testid="drill-next" onClick={onDone}>Continue</button>}
      </div>
    </section>
  );
}

/**
 * A move the app inferred inside an opening that one of his courses covers. The app does not
 * know what the course teaches, so it does not drill this move: it asks once whether it is his
 * move. His answer (a tap, or a different move played on the board) is what gets recalled later.
 */
function ConfirmMove({ entry, book, band, heading, onDone }: { entry: RepertoireEntry; book: OpeningBook | null | undefined; band: number; heading?: string; onDone: () => void }) {
  const db = useDb();
  useFocusMode();
  const course = courseFor(entry.side, entry.path)!;
  const pos = useMemo(() => positionFromFen(entry.fen), [entry.fen]);
  const [choice, setChoice] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useScreenChange(`confirm|${entry.id}|${choice ?? ''}`);
  const armed = useArmed();
  const same = choice ? sameMove(pos, choice, entry.uci) : false;
  const ev = choice && !same && book ? classifyMove(book, entry.positionKey, choice, [band]) : null;

  async function save(uci: string) {
    await db.repertoire.put(makeEntry(entry.side, entry.fen, entry.path, uci, Date.now()));
    void refreshRepertoire(db);
    onDone();
  }

  return (
    <section className="puzzle" data-testid="opening-confirm" data-inferred={entry.uci}>
      <header className="puzzle-head">
        {heading && <p className="kicker">{heading}</p>}
        <h2>Is {entry.san} your move here?</h2>
        <p className="muted">
          After {pathText(entry.path)}. This opening is covered by your course {course.title} on {course.provider}.{' '}
          {entry.source === 'own-games' ? `In your games you play ${entry.san} here${entry.games ? ` (${entry.games.played} of ${entry.games.reached})` : ''}.` : `${entry.san} was a suggestion.`}{' '}
          The app does not know what the course teaches. If the course plays a different move, play that move on the board.
        </p>
      </header>
      <Board fen={choice ? fenOf(applyUci(pos, choice)) : entry.fen} orientation={entry.side} movable={choice ? null : entry.side} lastMove={choice} onMove={setChoice} resetKey={resetKey} />
      <div className="feedback">{choice && !same && ev && <EvidenceText ev={ev} san={sanOf(pos, choice)} />}</div>
      <div className="actions">
        {!choice && <button className="primary" data-testid="confirm-yes" disabled={!armed} onClick={() => void save(entry.uci)}>Yes, {entry.san} is my move</button>}
        {choice && <button className="primary" data-testid="confirm-other" disabled={!armed} onClick={() => void save(choice)}>{same ? `Yes, ${entry.san} is my move` : `Make ${sanOf(pos, choice)} my move here`}</button>}
        {choice && <button disabled={!armed} onClick={() => { setChoice(null); setResetKey((k) => k + 1); }}>Take it back</button>}
        <a className="button" data-testid="confirm-course" href={course.url} target="_blank" rel="noreferrer">Open the course</a>
        <button className="quiet" data-testid="confirm-later" disabled={!armed} onClick={onDone}>Ask me later</button>
      </div>
    </section>
  );
}

function GapBuilder({ gap, side, book, band, onSaved, onSkip }: { gap: Decision; side: Side; book: OpeningBook; band: number; onSaved: () => void; onSkip: () => void }) {
  const db = useDb();
  const [choice, setChoice] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const pos = useMemo(() => positionFromFen(gap.fen), [gap.fen]);
  const ev = choice ? classifyMove(book, gap.positionKey, choice, [band]) : null;
  const shownFen = choice ? fenOf(applyUci(pos, choice)) : gap.fen;
  const course = courseFor(side, gap.path);

  async function save() {
    if (!choice) return;
    await db.repertoire.put(makeEntry(side, gap.fen, gap.path, choice, Date.now()));
    onSaved();
  }

  return (
    <section className="puzzle" data-testid="gap-builder" data-path={gap.path.join(' ')} data-reach={gap.reach.toFixed(4)}>
      <h2>What do you play here?</h2>
      <p className="muted">After {pathText(gap.path)}. With your repertoire so far, {formatPct(gap.reach)} of games at this level reach this position. {course ? `This opening is covered by your course ${course.title}: look the position up there and play its move here. The app suggests nothing of its own in this opening.` : 'Play the move you want to play here on the board.'}</p>
      {course && <p><a className="button" data-testid="gap-course" href={course.url} target="_blank" rel="noreferrer">Open {course.title} on {course.provider}</a></p>}
      <Board fen={shownFen} orientation={side} movable={choice ? null : side} lastMove={choice} onMove={setChoice} resetKey={resetKey} />
      <div className="feedback">{choice && ev && <EvidenceText ev={ev} san={sanOf(pos, choice)} />}</div>
      <div className="actions">
        {choice ? (
          <>
            <button className="primary" data-testid="save-move" onClick={() => void save()}>Save as my move</button>
            <button onClick={() => { setChoice(null); setResetKey((k) => k + 1); }}>Choose another</button>
          </>
        ) : (
          <button className="quiet" data-testid="skip-gap" onClick={onSkip}>Skip this position for now</button>
        )}
      </div>
    </section>
  );
}

export function OpeningsHome({ learner }: { learner: Learner }) {
  const db = useDb();
  const book = useOpeningBook();
  const entries = useRepertoire();
  const prefs = useOpeningPrefs();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const [skip, setSkip] = useState(0);
  const [pgnMessage, setPgnMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const pgnInput = useRef<HTMLInputElement>(null);

  async function importPgn(file: File) {
    try {
      const r = entriesFromPgn(await file.text(), prefs.side, Date.now());
      const have = new Map(entries.filter((e) => e.side === prefs.side).map((e) => [e.positionKey, e]));
      const fresh = r.entries.filter((e) => !have.has(e.positionKey));
      const differing = r.entries.filter((e) => have.has(e.positionKey) && have.get(e.positionKey)!.uci !== e.uci).length;
      await db.repertoire.bulkPut(fresh);
      setPgnMessage({
        kind: 'ok',
        text: `Read ${r.games} game${r.games === 1 ? '' : 's'}: added ${fresh.length} position${fresh.length === 1 ? '' : 's'}. ${differing} already had a different move recorded and ${r.conflicts.length} appeared with two different moves in the file; in both cases the earlier choice was kept.`,
      });
    } catch (e) {
      setPgnMessage({ kind: 'error', text: `${(e as Error).message}` });
    } finally {
      if (pgnInput.current) pgnInput.current.value = '';
    }
  }

  function exportPgn() {
    const blob = new Blob([repertoireToPgn(entries, prefs.side)], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `repertoire-${prefs.side}.pgn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const walk = useMemo(() => (book ? walkRepertoire(book, entries, prefs.side, [prefs.band]) : null), [book, entries, prefs.side, prefs.band]);
  const doubtful = useLiveQuery(async () => ((await getMeta<Doubtful[]>(db, DOUBTFUL_KEY)) ?? []), [db]) ?? [];
  const games = useLiveQuery(() => db.games.toArray(), [db]);
  const left = useMemo(() => (games ? leftRepertoire(games, entries).filter((x) => x.side === prefs.side) : []), [games, entries, prefs.side]);
  // Opening the page, recording or removing a move by hand, or choosing another rating band
  // brings the moves read from the games and the suggestions up to date.
  const handKey = entries.filter((e) => !e.source).map((e) => `${e.id}:${e.uci}`).sort().join(',');
  useEffect(() => {
    void refreshRepertoire(db);
  }, [db, handKey, prefs.band]);
  // The position on screen stays until it is answered or skipped, even if the app fills it in
  // meanwhile (a game arrives, a suggestion is added): what he then records replaces that.
  const held = useRef<{ side: Side; band: number; gap: Decision } | null>(null);

  if (book === undefined) return <div className="page"><p className="muted">Loading opening data</p></div>;
  if (book === null || !walk) {
    return (
      <div className="page" data-testid="openings-home">
        <a className="back" href={href('practice')}>Practice</a>
        <h1>Opening repertoire</h1>
        <p className="note" data-testid="book-missing">The move-frequency data is not on this device. Connect once so it can be downloaded with the app.</p>
      </div>
    );
  }
  const mine = entries.filter((e) => e.side === prefs.side);
  const queued = new Set(learner.reviews.map((r) => r.itemId));
  const dueIds = new Set(due.map((d) => d.itemId));
  const toRecall = mine.filter((e) => !queued.has(drillId(e)) || dueIds.has(drillId(e)));
  if (held.current && (held.current.side !== prefs.side || held.current.band !== prefs.band)) held.current = null;
  const heldEntry = held.current ? entries.find((e) => e.id === `${prefs.side}|${held.current!.gap.positionKey}`) : undefined;
  // Answered by hand: move on. Filled in by the app while it was on screen: keep showing it.
  if (held.current && heldEntry && !heldEntry.source) held.current = null;
  const gap = held.current?.gap ?? walk.gaps[Math.min(skip, Math.max(0, walk.gaps.length - 1))];
  if (gap && !held.current) held.current = { side: prefs.side, band: prefs.band, gap };
  const count = (src: RepertoireEntry['source']) => mine.filter((e) => e.source === src).length;
  const m = book.manifest;

  return (
    <div className="page" data-testid="openings-home">
      <a className="back" href={href('practice')}>Practice</a>
      <h1>Opening repertoire</h1>
      <p className="lede">One set of answers. In the openings your courses cover, the course decides: the app suggests nothing there and asks you to confirm a move before it is recalled. Elsewhere your moves are read from your own games, and common positions with no move get a suggestion from open game data and an engine check.</p>
      <section className="card" data-testid="courses-card">
        <h2>Your courses</h2>
        <ul className="attempt-list">
          {COURSES.filter((c) => c.side === prefs.side).map((c) => (
            <li key={c.id} data-testid="course-row">
              <span className="journal-row">
                <span className="concept-name">{c.title}</span>
                <span className="concept-meta">{c.author}; covers positions after {pathText(c.root)}</span>
                <a href={c.url} target="_blank" rel="noreferrer">Open on {c.provider}</a>
              </span>
            </li>
          ))}
          {COURSES.every((c) => c.side !== prefs.side) && <li className="muted">No course recorded for this side.</li>}
        </ul>
        <p className="definition-small" data-testid="course-note">The courses stay on Chessreps: its terms do not allow their lines to be copied or collected, so the app does not know them. It learns a course move from you, when you confirm it or play it on the board here, and then holds you to it.</p>
      </section>
      {left.length > 0 && (
        <section className="card" data-testid="left-card">
          <h2>Where recent games left your repertoire</h2>
          <ul className="attempt-list">
            {left.map((x) => (
              <li key={x.gameId} data-testid="left-row">
                {x.date}: after {pathText(x.path)} you played {x.playedSan}; your move is {x.mineSan}.{' '}
                {x.course && <a href={x.course.url} target="_blank" rel="noreferrer">Review it in {x.course.title}</a>}
              </li>
            ))}
          </ul>
          <p className="definition-small">Only moves you recorded or confirmed yourself count here. The first such move of each game, newest first.</p>
        </section>
      )}

      <div className="length-picker" role="group" aria-label="Side">
        {(['white', 'black'] as Side[]).map((s) => (
          <button key={s} className={s === prefs.side ? 'chip is-on' : 'chip'} aria-pressed={s === prefs.side} data-testid={`side-${s}`} onClick={() => { prefs.setSide(s); setSkip(0); }}>As {s === 'white' ? 'White' : 'Black'}</button>
        ))}
      </div>
      <fieldset className="choice">
        <legend>Opponents rated (Lichess scale)</legend>
        <div className="length-picker">
          {m.bands.map((_, i) => (
            <button key={i} className={i === prefs.band ? 'chip is-on' : 'chip'} aria-pressed={i === prefs.band} data-testid={`band-${i}`} onClick={() => { prefs.setBand(i); setSkip(0); }}>{bandLabel(book, i)}</button>
          ))}
        </div>
      </fieldset>

      <section className="card" data-testid="coverage">
        <h2>How far your repertoire reaches</h2>
        <table className="concept-table">
          <thead><tr><th scope="col">Your move</th><th scope="col">Answer ready</th><th scope="col">No answer yet</th><th scope="col">Outside the data</th></tr></thead>
          <tbody>
            {walk.levels.slice(0, 7).map((l) => (
              <tr key={l.myMove} data-testid={`level-${l.myMove}`} data-answered={l.answered.toFixed(4)}>
                <th scope="row">{l.myMove}</th>
                <td>{formatPct(l.answered)}</td>
                <td>{formatPct(l.gap)}</td>
                <td>{formatPct(l.beyondData + l.rare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="definition-small">
          Share of games in which you have a recorded answer at each of your moves, following your own choices and weighting the opponent’s replies by how often players rated {bandLabel(book, prefs.band)} on Lichess play them. Data: {m.games.used.toLocaleString()} rated blitz, rapid and classical games from the start of {m.source.month} (CC0). “Outside the data” means the statistics stop or the reply is too rare to be listed. It measures what is recorded, not what you remember at the board.
        </p>
      </section>

      {gap ? (
        // Keyed by position: a new position must start with no pending choice from the last one.
        <GapBuilder key={`${prefs.side}|${gap.positionKey}`} gap={gap} side={prefs.side} book={book} band={prefs.band} onSaved={() => { held.current = null; setSkip(0); }} onSkip={() => { held.current = null; setSkip((s) => (s + 1) % Math.max(1, walk.gaps.length)); }} />
      ) : (
        <p className="note">Every position the data reaches has an answer recorded.</p>
      )}

      <section className="card" data-testid="recall-card">
        <h2>Recall</h2>
        <p>{mine.length} move{mine.length === 1 ? '' : 's'} recorded as {prefs.side === 'white' ? 'White' : 'Black'}; {toRecall.length} to recall now (new or due).</p>
        {(count('own-games') > 0 || count('suggested') > 0) && <p className="muted" data-testid="repertoire-sources">{count('own-games')} read from your games, {count('suggested')} suggested, {count(undefined)} recorded or confirmed by you.{mine.filter(needsConfirming).length > 0 ? ` ${mine.filter(needsConfirming).length} in your courses’ openings wait for your confirmation; recall asks about those first-hand instead of testing them.` : ''}</p>}
        {toRecall.length > 0 && <div className="actions"><a className="button primary" data-testid="start-recall" href={href('practice/run', { mode: 'openings', side: prefs.side })}>Recall {toRecall.length} move{toRecall.length === 1 ? '' : 's'}</a></div>}
      </section>

      <section className="card" data-testid="pgn-card">
        <h2>Your own PGN</h2>
        <p className="muted">If you keep your lines in a PGN file that you wrote yourself, it can be read in: every move for {prefs.side === 'white' ? 'White' : 'Black'} in the main lines and variations becomes a recorded move. Do not import files copied out of a paid course.</p>
        <div className="actions">
          <button data-testid="pgn-import" onClick={() => pgnInput.current?.click()}>Import a PGN file</button>
          <input ref={pgnInput} data-testid="pgn-input" type="file" accept=".pgn,application/x-chess-pgn,text/plain" hidden onChange={(e) => e.target.files?.[0] && void importPgn(e.target.files[0])} />
          {mine.length > 0 && <button data-testid="pgn-export" onClick={exportPgn}>Export as PGN</button>}
        </div>
        {pgnMessage && <p className={`note ${pgnMessage.kind === 'error' ? 'is-error' : 'is-ok'}`} role="status" data-testid="pgn-message">{pgnMessage.text}</p>}
      </section>

      {doubtful.filter((d) => d.side === prefs.side).length > 0 && (
        <section className="card" data-testid="doubtful-card">
          <h2>Habits not taken over</h2>
          <p className="muted">In these positions the move you usually play is rated clearly below the best move by the engine check, so it was not added and no suggestion was put in its place. Record the move you want when the position comes up above.</p>
          <ul className="attempt-list">
            {doubtful.filter((d) => d.side === prefs.side).map((d) => (
              <li key={d.positionKey} data-testid="doubtful-row">After {pathText(d.path)} you usually play {d.san} ({d.played} of {d.reached} games){d.bestSan ? `; the engine’s first choice is ${d.bestSan}` : ''}.</li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && (
        <section className="concept-group">
          <h2>Your recorded moves</h2>
          <ul className="attempt-list">
            {mine.slice().sort((a, b) => a.path.length - b.path.length || (pathText(a.path) < pathText(b.path) ? -1 : 1)).map((e) => (
              <li key={e.id}>
                <span className="journal-row" data-testid="repertoire-row">
                  <span className="concept-name">{pathText([...e.path, e.san])}</span>
                  <span className="concept-meta" data-source={e.source ?? 'hand'}>after {pathText(e.path)}, you play {e.san}; {sourceLabel(e)}</span>
                  <button className="quiet" onClick={() => void declineEntry(db, e).then(() => refreshRepertoire(db))} aria-label={`Remove ${e.san} after ${pathText(e.path)}`}>Remove and choose again</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Runs through repertoire moves that are new (never recalled) or due. */
export function OpeningRecallRun({ learner, side, onFinished }: { learner: Learner; side: Side; onFinished: () => void }) {
  const book = useOpeningBook();
  const entries = useRepertoire();
  const prefs = useOpeningPrefs();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const queue = useRef<RepertoireEntry[] | null>(null);
  const [i, setI] = useState(0);
  if (queue.current === null && learner.ready && entries.length > 0) {
    const queued = new Set(learner.reviews.map((r) => r.itemId));
    const dueIds = new Set(due.map((d) => d.itemId));
    queue.current = entries.filter((e) => e.side === side && (!queued.has(drillId(e)) || dueIds.has(drillId(e)))).sort((a, b) => a.path.length - b.path.length);
  }
  const entry = queue.current?.[i];
  if (!queue.current) return <p className="muted">Loading</p>;
  if (!entry) {
    return (
      <div className="empty" data-testid="recall-done">
        <p>{queue.current.length === 0 ? 'Nothing to recall right now.' : `Recalled ${queue.current.length} position${queue.current.length === 1 ? '' : 's'}. Each comes back when it is due.`}</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back to the repertoire</button></div>
      </div>
    );
  }
  if (needsConfirming(entry)) return <ConfirmMove key={entry.id} entry={entry} book={book} band={prefs.band} heading={`Your course decides here, ${queue.current.length - i} left`} onDone={() => setI(i + 1)} />;
  return <OpeningDrill key={entry.id} entry={entry} book={book} band={prefs.band} sessionId={null} heading={`Recall, ${queue.current.length - i} left`} onDone={() => setI(i + 1)} />;
}
