import { useEffect, useMemo, useRef, useState } from 'react';
import { go, href } from '../app/router';
import { type Learner, useDb, useDueReviews, useJournal, useAppCached, useNow, useOnline, usePack, usePool, useRecentSessions, useTodaySession } from '../app/store';
import { CONCEPT_BY_ID } from '../content';
import type { Concept } from '../content/types';
import { newUuid, saveSession, updateSession } from '../db/db';
import type { Attempt, BlockKind, GameJournalEntry, SessionBlock, SessionRecord } from '../db/types';
import { checkForSession } from '../learn/curriculum';
import { baselineProgress, DIAGNOSTIC, nextBaselineConcept } from '../learn/diagnostic';
import { activeBlockIndex, addAttempt, completeBlock, pickTestConcept, planPlaySession, planSession, SESSION_LENGTHS, spend, suggestSessionKind } from '../schedule/session';
import { ConceptStudy } from './Learn';
import { useGames } from './Games';
import { PlayBlock, ReflectBlock } from './PlayDay';
import { SenseDrill, senseItemsFrom } from './Sense';
import { pickSense, type SenseItem } from '../games/sense';
import { CheckRunner, conceptPicker, PuzzleStream, ReviewRunner } from './runners';
import { useArmed, useScreenChange } from '../app/tapGuard';
import { type MoveItem, moveItems } from '../games/ownmove';
import { paceFrom } from '../schedule/pace';
import { OwnMoveDrill } from './OwnMove';

/** A small stable hash for choosing among a few candidates by turn. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
}

const BLOCK_NAME: Record<BlockKind, string> = { review: 'Review', learn: 'Learn', apply: 'Practice', test: 'Test', play: 'Play', reflect: 'Reflect' };
const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function blockSubject(b: SessionBlock): string {
  const c = b.conceptId ? CONCEPT_BY_ID.get(b.conceptId) : null;
  if (b.kind === 'review') return 'Positions you missed before';
  if (b.kind === 'learn') return c ? c.title : 'No new concept today';
  if (b.kind === 'apply') return c ? `${c.title}, and your own games` : 'Your own games';
  if (b.kind === 'play') return 'One rapid game';
  if (b.kind === 'reflect') return 'Result and turning point';
  return 'Mixed unseen positions';
}

function Scoresheet({ session, activeIndex }: { session: SessionRecord; activeIndex: number }) {
  return (
    <ol className="scoresheet" data-testid="scoresheet">
      {session.blocks.map((b, i) => (
        <li key={b.kind} className={`sheet-row is-${b.status}${i === activeIndex ? ' is-current' : ''}`} data-testid={`block-${b.kind}`} data-status={b.status}>
          <span className="sheet-no">{i + 1}</span>
          <div className="sheet-main">
            <p className="sheet-title">
              {BLOCK_NAME[b.kind]} <span className="sheet-subject">{blockSubject(b)}</span>
            </p>
            <p className="sheet-why">{b.reason}</p>
            {b.notice && <p className="sheet-notice" data-testid={`notice-${b.kind}`}>{b.notice}</p>}
          </div>
          <span className="sheet-time">
            {b.status === 'skipped' ? 'skipped' : b.status === 'done' ? `${Math.max(1, Math.round(b.spentSec / 60))} min` : `${Math.round(b.budgetSec / 60)} min`}
          </span>
        </li>
      ))}
    </ol>
  );
}

const RESULT_TEXT = { win: 'won', draw: 'drew', loss: 'lost' } as const;

function PlaySummary({ session, entry }: { session: SessionRecord; entry: GameJournalEntry | undefined }) {
  const total = session.blocks.reduce((t, b) => t + b.spentSec, 0);
  return (
    <section className="summary" data-testid="summary">
      <h2>Play day finished</h2>
      <dl className="facts">
        <dt>Time</dt>
        <dd>{Math.round(total / 60)} minutes</dd>
        <dt>Game</dt>
        <dd data-testid="summary-game">{entry ? `${entry.timeControl} ${entry.timeClass}${entry.result ? `, ${RESULT_TEXT[entry.result]}` : ''}${entry.color ? ` as ${entry.color}` : ''}` : 'Not logged'}</dd>
        {entry?.turningPoint && (<><dt>Turning point</dt><dd>{entry.turningPoint}</dd></>)}
        {entry?.nextTime && (<><dt>Next time</dt><dd>{entry.nextTime}</dd></>)}
      </dl>
      <p className="muted">These are your own notes. Once the game is fetched from Chess.com and analysed, its turning points appear under Progress, in “Your games”.</p>
      <div className="actions"><a className="button primary" href={href('progress')}>See progress</a></div>
    </section>
  );
}

function Summary({ session, learner }: { session: SessionRecord; learner: Learner }) {
  const ids = new Set(session.blocks.flatMap((b) => b.attemptUuids));
  const mine = learner.attempts.filter((a) => ids.has(a.uuid) || a.sessionId === session.id);
  const fresh = mine.filter((a) => a.exerciseKind === 'puzzle' && a.fresh && a.outcome !== 'skipped');
  const reviews = mine.filter((a) => a.scheduledReview && a.outcome !== 'skipped');
  const learn = session.blocks.find((b) => b.kind === 'learn');
  const concept = learn?.conceptId ? learner.statuses.find((s) => s.concept.id === learn.conceptId) : null;
  const checks = learner.events.filter((e) => (e.type === 'check-passed' || e.type === 'check-failed') && e.ts >= session.createdAt);
  const missed = mine.filter((a) => a.exerciseKind === 'puzzle' && a.outcome !== 'success' && a.outcome !== 'skipped').length;
  const total = session.blocks.reduce((t, b) => t + b.spentSec, 0);
  return (
    <section className="summary" data-testid="summary">
      <h2>Today’s session is finished</h2>
      <dl className="facts">
        <dt>Time</dt>
        <dd>{Math.round(total / 60)} of {session.budgetMin} minutes</dd>
        <dt>New concept</dt>
        <dd>{concept ? `${concept.concept.title}: ${concept.stage === 'demonstrated' ? 'demonstrated' : concept.stage === 'taught' ? (concept.assessable ? 'studied; its check comes on a later day' : 'studied') : 'started'}` : (learn?.notice ?? 'None today')}</dd>
        <dt>Unseen positions</dt>
        <dd data-testid="summary-unseen">{fresh.length === 0 ? 'None attempted' : `${fresh.filter((a) => a.outcome === 'success').length} of ${fresh.length} solved first try`}</dd>
        <dt>Reviews</dt>
        <dd>{reviews.length === 0 ? 'None due' : `${reviews.filter((a) => a.outcome === 'success').length} of ${reviews.length} recalled`}</dd>
        {checks.length > 0 && (
          <>
            <dt>Checks</dt>
            <dd>{checks.map((c) => `${CONCEPT_BY_ID.get(c.conceptId)?.title}: ${c.type === 'check-passed' ? 'passed' : 'not passed'}`).join('; ')}</dd>
          </>
        )}
        <dt>Added to review</dt>
        <dd>{missed} position{missed === 1 ? '' : 's'}, first due tomorrow</dd>
      </dl>
      <p className="muted">One session is too small a sample to judge a trend. Progress shows the running totals with their uncertainty.</p>
      <div className="actions">
        <a className="button primary" href={href('progress')}>See progress</a>
        <a className="button" data-testid="summary-mix" href={href('practice/run', { mode: 'mix' })}>Keep practising</a>
      </div>
    </section>
  );
}

export function Today({ learner }: { learner: Learner }) {
  const db = useDb();
  const online = useOnline();
  const pack = usePack();
  const appCached = useAppCached();
  const now = useNow();
  const session = useTodaySession();
  const due = useDueReviews(learner.reviews, now);
  const [length, setLength] = useState<number>(30);
  const history = useRecentSessions();
  const journal = useJournal();
  const myGames = useGames();
  // Rapid games only: that is the kind of game the play day is for.
  const playedDates = useMemo(() => (myGames ?? []).filter((g) => g.timeClass === 'rapid').map((g) => g.endDate), [myGames]);
  const suggestion = useMemo(() => suggestSessionKind(history, now, playedDates), [history, now, playedDates]);
  const starting = useRef(false);
  const baseline = useMemo(() => baselineProgress(learner.statuses), [learner.statuses]);

  const preview = useMemo(
    () => planSession({ id: 'preview', now, budgetMin: length, statuses: learner.statuses, dueCount: due.length, online }),
    [now, length, learner.statuses, due.length, online],
  );

  if (session === undefined || !learner.ready) return <div className="page"><p className="muted">Loading</p></div>;

  async function start(kind: 'study' | 'play') {
    if (starting.current) return; // a second tap must not plan a second session
    starting.current = true;
    const s = kind === 'play'
      ? planPlaySession({ id: newUuid(), now: Date.now(), dueCount: due.length })
      : planSession({ id: newUuid(), now: Date.now(), budgetMin: length, statuses: learner.statuses, dueCount: due.length, online });
    try {
      await saveSession(db, s);
      go('today/run');
    } finally {
      starting.current = false;
    }
  }

  const packReady = pack?.state === 'installed';
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (!session) {
    return (
      <div className="page" data-testid="today" data-state="unplanned">
        <p className="kicker">{dateLabel}</p>
        <h1>Today</h1>
        <p className="lede" data-testid="suggestion" data-kind={suggestion.kind}>{suggestion.reason}</p>
        <div className="actions">
          {/* Fixed places: the suggestion can change a moment after launch (a game fetched from
              Chess.com counts as a play day), and buttons that swap under the finger start the wrong kind of day. */}
          <button className={suggestion.kind === 'study' ? 'primary big' : ''} data-testid="start-session" disabled={!packReady} onClick={() => void start('study')}>{suggestion.kind === 'study' ? `Start ${length}-minute session` : `Study for ${length} minutes instead`}</button>
          <button className={suggestion.kind === 'play' ? 'primary big' : ''} data-testid="start-play" onClick={() => void start('play')}>{suggestion.kind === 'play' ? 'Start play day: one rapid game' : 'Make today a play day instead'}</button>
          <a className="button" data-testid="start-mix" href={href('practice/run', { mode: 'mix' })}>Just practise: no plan, the app picks</a>
        </div>
        <div className="length-picker" role="group" aria-label="Session length">
          {SESSION_LENGTHS.map((m) => (
            <button key={m} className={m === length ? 'chip is-on' : 'chip'} aria-pressed={m === length} onClick={() => setLength(m)}>{m} min</button>
          ))}
        </div>
        {!baseline.complete && packReady && (
          <div className="return-card" data-testid="baseline-card">
            <p><strong>Baseline: {baseline.sampled} of {baseline.total} early concepts sampled.</strong> About {baseline.positionsLeft} unseen positions, no hints, at your own pace. It only replaces “untested” with a first, provisional reading.</p>
            <div className="actions"><a className="button" data-testid="start-baseline" href={href('today/baseline')}>{baseline.sampled === 0 && learner.attempts.length === 0 ? 'Take the baseline first' : 'Continue the baseline'}</a></div>
          </div>
        )}
        {!packReady && <p className="note" data-testid="pack-missing">The practice positions are not installed on this device yet. Connect once to download them.</p>}
        <p className="definition-small" data-testid="offline-ready" data-ready={packReady && appCached === true}>
          {packReady && appCached === true
            ? 'Stored on this phone: lessons, positions and the engine work with no connection. Only new games and linked lessons need one.'
            : appCached === false
              ? 'This browser cannot store the app for offline use. Add it to the Home Screen from Safari.'
              : online
                ? 'Still storing the app on this phone for offline use. Keep it open with a connection for a moment before going underground.'
                : 'The app is not fully stored on this phone yet; it needs a connection once.'}
        </p>
        <Scoresheet session={preview} activeIndex={-1} />
      </div>
    );
  }

  const idx = activeBlockIndex(session);
  return (
    <div className="page" data-testid="today" data-state={session.status}>
      <p className="kicker">{dateLabel}</p>
      <h1>Today</h1>
      {session.status === 'done' ? (
        session.kind === 'play' ? <PlaySummary session={session} entry={journal.find((j) => j.sessionId === session.id)} /> : <Summary session={session} learner={learner} />
      ) : (
        <div className="actions">
          <a className="button primary big" data-testid="resume-session" href={href('today/run')}>
            {session.blocks.some((b) => b.spentSec > 0 || b.status === 'done') ? `Resume: ${BLOCK_NAME[session.blocks[idx]!.kind]}` : 'Begin'}
          </a>
        </div>
      )}
      <Scoresheet session={session} activeIndex={idx} />
    </div>
  );
}

/** Counts seconds while the page is visible and saves them to the session every few seconds. */
function useBlockClock(session: SessionRecord | null, index: number, running: boolean) {
  const db = useDb();
  const id = session?.id ?? '';
  const [spent, setSpent] = useState(session?.blocks[index]?.spentSec ?? 0);
  const pending = useRef(0);
  useEffect(() => {
    setSpent(session?.blocks[index]?.spentSec ?? 0);
    pending.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, index]);
  useEffect(() => {
    if (!running || !id) return;
    const flush = () => {
      if (pending.current === 0) return;
      const add = pending.current;
      pending.current = 0;
      void updateSession(db, id, (s) => spend(s, index, add, Date.now()));
    };
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      pending.current += 1;
      setSpent((s) => s + 1);
      if (pending.current >= 5) flush();
    }, 1000);
    return () => {
      clearInterval(t);
      flush();
    };
  }, [db, id, index, running]);
  return spent;
}

export function SessionRun({ learner }: { learner: Learner }) {
  const db = useDb();
  const session = useTodaySession();
  const pool = usePool();
  const now = useNow();
  const dueNow = useDueReviews(learner.reviews, now);
  const idx = session ? activeBlockIndex(session) : -1;
  const block = session && idx >= 0 ? session.blocks[idx]! : null;
  const spent = useBlockClock(session ?? null, Math.max(idx, 0), !!block);
  const [testPhase, setTestPhase] = useState<'check' | 'mixed'>('check');
  const lastTestConcept = useRef<string | null>(null);
  const checkConcept = useRef<Concept | null>(null);
  const checkDecidedFor = useRef<string | null>(null);
  useScreenChange(`${session?.id ?? ''}|${idx}`);
  const armed = useArmed();
  // Set while a block is being closed because its time is up: nothing new is put on screen in between.
  const [leavingIdx, setLeavingIdx] = useState<number | null>(null);
  const games = useGames();
  const [testIndex, setTestIndex] = useState(0);
  const senseShown = useRef(new Set<string>());
  const learnShown = useRef(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // The item for a turn is chosen once: recording its attempt must not swap it for another mid-question.
  const senseLatch = useRef<{ index: number; item: SenseItem | null } | null>(null);
  const moveLatch = useRef<{ index: number; pick: { item: MoveItem; pace: number } | null } | null>(null);
  // Review items due when the block started; kept stable for the whole block.
  const dueAtStart = useRef<typeof dueNow | null>(null);
  if (block?.kind === 'review' && dueAtStart.current === null && learner.ready) dueAtStart.current = dueNow;
  if (block?.kind !== 'review') dueAtStart.current = null;

  useEffect(() => {
    if (session && (session.status === 'done' || idx < 0)) go('today');
  }, [session, idx]);

  if (session === undefined || !learner.ready) return <div className="page"><p className="muted">Loading</p></div>;
  if (!session || !block) return <div className="page"><p>No session is running. <a href={href('today')}>Go to Today</a></p></div>;

  const untimed = block.kind === 'play' || block.kind === 'reflect';
  const left = Math.max(0, block.budgetSec - spent);
  const timeUp = !untimed && left === 0;
  const finish = (how: 'done' | 'skipped' = 'done') => updateSession(db, session.id, (s) => (s.blocks[idx]?.status === 'done' || s.blocks[idx]?.status === 'skipped' ? s : completeBlock(s, idx, Date.now(), how)));
  const onAttempt = (a: Attempt) => void updateSession(db, session.id, (s) => addAttempt(s, idx, a.uuid, Date.now()));
  const concept = block.conceptId ? CONCEPT_BY_ID.get(block.conceptId) ?? null : null;
  const seed = `${session.date}|${session.id}|${block.kind}`;
  // Never on the day of the lesson; the longest-waiting concept first; then stale passes (see checkForSession).
  const checkTarget = checkForSession(learner.statuses, now)?.concept ?? null;
  // One check per concept per session. The concept is latched when the check starts: passing
  // it removes the concept from the awaiting list, and the result screen must still be shown.
  const checkedThisSession = !!checkTarget && learner.events.some(
    (e) => e.conceptId === checkTarget.id && (e.type === 'check-passed' || e.type === 'check-failed') && e.ts >= session.createdAt,
  );
  // Decided once, on entering the test block, and kept, including the answer "no check today".
  // The clock ticks every minute and a check can fall due at any of them (a pass turning 21
  // days old, six hours since a lesson, midnight); deciding again on each tick replaced the
  // position on screen with a check.
  if (block.kind === 'test' && checkDecidedFor.current !== session.id && learner.ready) {
    checkDecidedFor.current = session.id;
    checkConcept.current = checkTarget && !checkedThisSession ? checkTarget : null;
  }
  const activeCheck = block.kind === 'test' && testPhase === 'check' ? checkConcept.current : null;
  const learnStatus = block.kind === 'learn' && concept ? learner.statuses.find((s) => s.concept.id === concept.id) : null;
  // Practice and test blocks: questions from the learner's own games alternate with puzzles.
  // In practice the answer is followed by the engine's line; in the test nothing is announced.
  const nextTestItem = () => {
    // Always move on first, also when the block's time is up: otherwise the question just
    // answered would still be the current one when the next block starts, and be asked again.
    senseShown.current.add(senseTurn?.id ?? moveTurn?.item.id ?? '');
    setTestIndex((n) => n + 1);
    if (timeUp) {
      // Without this the next item would be on screen for an instant before the block changes.
      setLeavingIdx(idx);
      void finish();
    }
  };
  const leaving = leavingIdx === idx;
  // Practice block: two of every three own-game turns are "Your move" (his own move in an
  // ordinary position from his games), when such positions exist. Chosen once per turn.
  const moveTurn: { item: MoveItem; pace: number } | null = (() => {
    if (block.kind !== 'apply' || !games || leaving) return null;
    if (testIndex % 2 === 1 && concept) return null;
    if (moveLatch.current?.index === testIndex) return moveLatch.current.pick;
    let pick: { item: MoveItem; pace: number } | null = null;
    if (Math.floor(testIndex / 2) % 3 !== 2) {
      const done = new Set([...learner.attempts.filter((a) => a.exerciseKind === 'own-move').map((a) => a.exerciseId), ...senseShown.current]);
      const left = moveItems(games).filter((m) => !done.has(m.id));
      // Newest games first, with some variety among them.
      const item = left.length ? left[left.length - 1 - (hashOf(`${session.id}|${testIndex}`) % Math.min(8, left.length))] : undefined;
      if (item) pick = { item, pace: paceFrom(learner.attempts).pace };
    }
    moveLatch.current = { index: testIndex, pick };
    return pick;
  })();
  const senseTurn: SenseItem | null = (() => {
    if ((block.kind !== 'test' && block.kind !== 'apply') || activeCheck || !games || leaving || moveTurn) return null;
    // With no concept to practise, every turn of the practice block comes from the learner's games.
    if (testIndex % 2 === 1 && !(block.kind === 'apply' && !concept)) return null;
    const seen = new Set([...learner.attempts.filter((a) => a.exerciseKind === 'sense').map((a) => a.exerciseId), ...senseShown.current]);
    const kind = Math.floor(testIndex / 2) % 2 === 0 ? 'safe-or-not' : 'chance-or-not';
    if (senseLatch.current?.index === testIndex) return senseLatch.current.item;
    const all = senseItemsFrom(games);
    const other = kind === 'safe-or-not' ? 'chance-or-not' : 'safe-or-not';
    // If one kind has run out, the other is asked instead of ending the turn empty.
    const item = pickSense(all, kind, seen, 2, `${session.id}|${testIndex}`)[0] ?? pickSense(all, other, seen, 2, `${session.id}|${testIndex}`)[0] ?? null;
    senseLatch.current = { index: testIndex, item };
    return item;
  })();

  return (
    <div className="page run" data-testid="session-run" data-block={block.kind}>
      <header className="run-bar">
        <a className="back" href={href('today')}>Today</a>
        <p className="run-title">{idx + 1}. {BLOCK_NAME[block.kind]}</p>
        <p className={`run-clock${timeUp ? ' is-up' : ''}`} data-testid="block-clock" aria-label="Time left in this block">{untimed ? mins(spent) : timeUp ? 'time is up' : mins(left)}</p>
      </header>
      {timeUp && <p className="note" data-testid="time-up">This block’s minutes are used. Finish what is on screen, then move on.</p>}

      {block.kind === 'review' && dueAtStart.current && (
        <ReviewRunner due={dueAtStart.current} sessionId={session.id} stop={timeUp} onAttempt={onAttempt} onFinished={() => void finish()} />
      )}

      {block.kind === 'learn' && concept && (
        <>
          {block.notice && <p className="note">{block.notice}</p>}
          {learnStatus && (learnStatus.stage === 'taught' || learnStatus.stage === 'demonstrated') && (
            <div className="return-card" data-testid="learn-complete" ref={(el) => { if (el && !learnShown.current) { learnShown.current = true; el.scrollIntoView({ block: 'start' }); } }}>
              <p><strong>{learnStatus.stage === 'demonstrated' ? 'Already demonstrated.' : 'Lesson recorded as studied.'}</strong> Next: practice.{learnStatus.assessable && learnStatus.stage === 'taught' ? ' Its check comes on a later day, not today.' : ''}</p>
              <div className="actions"><button className="primary" data-testid="learn-continue" disabled={!armed} onClick={() => void finish()}>Continue to practice</button></div>
            </div>
          )}
          <ConceptStudy concept={concept} learner={learner} sessionId={session.id} embedded />
        </>
      )}

      {leaving && <p className="muted" data-testid="leaving-block">Moving on</p>}
      {block.kind === 'apply' && moveTurn && (
        <OwnMoveDrill key={moveTurn.item.id} item={moveTurn.item} sessionId={session.id} context="apply" heading="Practice: your move" pace={moveTurn.pace} onRecorded={onAttempt} onDone={nextTestItem} />
      )}
      {block.kind === 'apply' && senseTurn && (
        <SenseDrill key={senseTurn.id} item={senseTurn} sessionId={session.id} context="apply" heading="Practice: from your own games" onRecorded={onAttempt} onDone={nextTestItem} />
      )}
      {block.kind === 'apply' && !leaving && !moveTurn && !senseTurn && concept && pool && (
        <PuzzleStream
          key={`apply-${concept.id}-${testIndex}`}
          limit={1}
          pick={conceptPicker(pool.puzzles, concept, learner.level.level - 100, `${seed}|${testIndex}`)}
          context="apply" conceptId={concept.id} sessionId={session.id} allowHints seen={learner.seen}
          heading={`Practice: ${concept.title}`} onAttempt={onAttempt}
          onFinished={(why) => (why === 'exhausted' ? void finish() : nextTestItem())}
        />
      )}
      {block.kind === 'apply' && !leaving && !moveTurn && !senseTurn && !concept && (
        <div className="empty" data-testid="practice-empty">
          <p>{games && games.length > 0 ? 'No unseen questions from your games are left for now. More appear as new games are fetched and analysed.' : block.reason}</p>
          <div className="actions"><button className="primary" onClick={() => void finish()}>Continue</button></div>
        </div>
      )}

      {block.kind === 'test' && pool && activeCheck && (
        <CheckRunner key={`check-${activeCheck.id}`} concept={activeCheck} learner={learner} sessionId={session.id} onDone={() => { checkConcept.current = null; setTestPhase('mixed'); }} />
      )}
      {block.kind === 'test' && pool && !activeCheck && !leaving && (
        senseTurn ? (
          <SenseDrill key={senseTurn.id} item={senseTurn} sessionId={session.id} context="test" heading="From your own games, nothing announced" onRecorded={onAttempt} onDone={nextTestItem} />
        ) : (
          <PuzzleStream
            key={`mixed-${testIndex}`}
            limit={1}
            pick={(exclude, i) => {
              const s = pickTestConcept(learner.statuses, lastTestConcept.current);
              if (!s) return null;
              lastTestConcept.current = s.concept.id;
              return conceptPicker(pool.puzzles, s.concept, learner.level.level, `${seed}|${testIndex}`)(exclude, i);
            }}
            context="test" conceptId={() => lastTestConcept.current}
            sessionId={session.id} allowHints={false} seen={learner.seen} heading="Mixed test, no hints"
            onAttempt={onAttempt} onFinished={nextTestItem}
          />
        )
      )}

      {block.kind === 'play' && <PlayBlock onFinished={() => void finish()} />}
      {block.kind === 'reflect' && <ReflectBlock sessionId={session.id} onSaved={() => void finish()} />}

      <footer className="run-foot">
        {confirmEnd ? (
          <div className="actions" data-testid="end-confirm">
            <p className="muted">{block.kind === 'reflect' ? 'End without saving these notes? The day’s session is closed.' : 'End today’s session now? It cannot be reopened.'}</p>
            <button data-testid="end-confirm-yes" disabled={!armed} onClick={() => { setConfirmEnd(false); void finish(block.spentSec > 0 || spent > 0 ? 'done' : 'skipped'); }}>End session</button>
            <button className="primary" data-testid="end-confirm-no" onClick={() => setConfirmEnd(false)}>Keep going</button>
          </div>
        ) : (
          <button className="quiet" data-testid="end-block" disabled={!armed} onClick={() => (idx === session.blocks.length - 1 ? setConfirmEnd(true) : void finish(block.spentSec > 0 || spent > 0 ? 'done' : 'skipped'))}>
            {idx === session.blocks.length - 1 ? 'End session' : `End ${BLOCK_NAME[block.kind].toLowerCase()} and move on`}
          </button>
        )}
      </footer>
    </div>
  );
}

/** Self-paced baseline sampler: unseen positions for each early concept until every one has two. */
export function BaselineRun({ learner }: { learner: Learner }) {
  const pool = usePool();
  const last = useRef<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const progress = baselineProgress(learner.statuses);
  // Whether the baseline was already complete when this screen opened. While it is running,
  // the last position's first move completes the sample; the position must still be finished.
  const completeOnEntry = useRef<boolean | null>(null);
  if (!pool || !learner.ready) return <div className="page"><p className="muted">Loading positions</p></div>;
  completeOnEntry.current ??= progress.complete;

  if (completeOnEntry.current || stopped) {
    return (
      <div className="page" data-testid="baseline-result" data-complete={progress.complete}>
        <a className="back" href={href('today')}>Today</a>
        <h1>{progress.complete ? 'Baseline sampled' : 'Baseline paused'}</h1>
        <p className="lede">{progress.sampled} of {progress.total} early concepts have at least {DIAGNOSTIC.perConcept} unseen positions. Two positions cannot show strength or weakness; they only tell the app where to look next.</p>
        <table className="concept-table">
          <thead><tr><th scope="col">Concept</th><th scope="col">First try</th><th scope="col">Reading</th></tr></thead>
          <tbody>
            {progress.rows.map((r) => (
              <tr key={r.concept.id} data-testid={`baseline-${r.concept.id}`}>
                <th scope="row"><a href={href(`learn/${r.concept.id}`)}>{r.concept.title}</a></th>
                <td>{r.n === 0 ? <span className="muted">untested</span> : `${r.successes}/${r.n}`}</td>
                <td>{r.n === 0 ? '' : r.n >= DIAGNOSTIC.perConcept && r.successes === r.n ? <a href={href(`learn/${r.concept.id}`)}>pre-test to skip</a> : 'provisional'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="definition-small">“Pre-test to skip” appears when every sampled position was solved first try: the 5-position check on the concept page decides, not this sampler.</p>
        <div className="actions">
          <a className="button primary" href={href('today')}>Back to Today</a>
          {!progress.complete && <button onClick={() => setStopped(false)}>Continue the baseline</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="page run" data-testid="baseline-run">
      <header className="run-bar">
        <a className="back" href={href('today')}>Today</a>
        <p className="run-title">Baseline</p>
        <p className="run-clock" data-testid="baseline-left">{progress.positionsLeft} left</p>
      </header>
      <PuzzleStream
        pick={(exclude, i) => {
          const c = nextBaselineConcept(learner.statuses, last.current);
          if (!c) {
            setStopped(true);
            return null;
          }
          last.current = c.id;
          return conceptPicker(pool.puzzles, c, learner.level.level, `baseline|${DIAGNOSTIC.version}`)(exclude, i);
        }}
        context="diagnostic" conceptId={() => last.current} sessionId={null} allowHints={false} seen={learner.seen}
        heading="Baseline, no hints" onFinished={() => setStopped(true)}
      />
      <footer className="run-foot"><button className="quiet" data-testid="baseline-stop" onClick={() => setStopped(true)}>Stop for now</button></footer>
    </div>
  );
}
