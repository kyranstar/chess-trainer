import { useEffect, useMemo, useRef, useState } from 'react';
import { go, href } from '../app/router';
import { type Learner, useDb, useDueReviews, useNow, useOnline, usePack, usePool, useTodaySession } from '../app/store';
import { CONCEPT_BY_ID } from '../content';
import type { Concept } from '../content/types';
import { newUuid, saveSession } from '../db/db';
import type { Attempt, BlockKind, SessionBlock, SessionRecord } from '../db/types';
import { awaitingCheck } from '../learn/curriculum';
import { activeBlockIndex, addAttempt, completeBlock, pickTestConcept, planSession, SESSION_LENGTHS, spend } from '../schedule/session';
import { ConceptStudy } from './Learn';
import { CheckRunner, conceptPicker, PuzzleStream, ReviewRunner } from './runners';

const BLOCK_NAME: Record<BlockKind, string> = { review: 'Review', learn: 'Learn', apply: 'Apply', test: 'Test' };
const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function blockSubject(b: SessionBlock): string {
  const c = b.conceptId ? CONCEPT_BY_ID.get(b.conceptId) : null;
  if (b.kind === 'review') return 'Positions you missed before';
  if (b.kind === 'learn') return c ? c.title : 'No new concept today';
  if (b.kind === 'apply') return c ? `New positions: ${c.title}` : 'Practice';
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
        <dd>{concept ? `${concept.concept.title}: ${concept.stage === 'demonstrated' ? 'demonstrated' : concept.stage === 'taught' ? 'studied, check still to pass' : 'started'}` : (learn?.notice ?? 'None today')}</dd>
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
        <a className="button" href={href('practice')}>Keep practising</a>
      </div>
    </section>
  );
}

export function Today({ learner }: { learner: Learner }) {
  const db = useDb();
  const online = useOnline();
  const pack = usePack();
  const now = useNow();
  const session = useTodaySession();
  const due = useDueReviews(learner.reviews, now);
  const [length, setLength] = useState<number>(30);

  const preview = useMemo(
    () => planSession({ id: 'preview', now, budgetMin: length, statuses: learner.statuses, dueCount: due.length, online }),
    [now, length, learner.statuses, due.length, online],
  );

  if (session === undefined || !learner.ready) return <div className="page"><p className="muted">Loading</p></div>;

  async function start() {
    const s = planSession({ id: newUuid(), now: Date.now(), budgetMin: length, statuses: learner.statuses, dueCount: due.length, online });
    await saveSession(db, s);
    go('today/run');
  }

  const packReady = pack?.state === 'installed';
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (!session) {
    return (
      <div className="page" data-testid="today" data-state="unplanned">
        <p className="kicker">{dateLabel}</p>
        <h1>Today</h1>
        <div className="actions">
          <button className="primary big" data-testid="start-session" disabled={!packReady} onClick={() => void start()}>Start {length}-minute session</button>
        </div>
        <div className="length-picker" role="group" aria-label="Session length">
          {SESSION_LENGTHS.map((m) => (
            <button key={m} className={m === length ? 'chip is-on' : 'chip'} aria-pressed={m === length} onClick={() => setLength(m)}>{m} min</button>
          ))}
        </div>
        {!packReady && <p className="note" data-testid="pack-missing">The practice positions are not installed on this device yet. Connect once to download them.</p>}
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
        <Summary session={session} learner={learner} />
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
function useBlockClock(session: SessionRecord, index: number, running: boolean) {
  const db = useDb();
  const [spent, setSpent] = useState(session.blocks[index]?.spentSec ?? 0);
  const pending = useRef(0);
  const latest = useRef(session);
  latest.current = session;
  useEffect(() => {
    setSpent(session.blocks[index]?.spentSec ?? 0);
    pending.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, index]);
  useEffect(() => {
    if (!running) return;
    const flush = () => {
      if (pending.current === 0) return;
      const add = pending.current;
      pending.current = 0;
      void saveSession(db, spend(latest.current, index, add, Date.now()));
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
  }, [db, index, running]);
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
  const spent = useBlockClock(session ?? ({ id: '', blocks: [] } as unknown as SessionRecord), Math.max(idx, 0), !!block);
  const [testPhase, setTestPhase] = useState<'check' | 'mixed'>('check');
  const lastTestConcept = useRef<string | null>(null);
  const checkConcept = useRef<Concept | null>(null);
  const latest = useRef<SessionRecord | null>(null);
  latest.current = session ?? null;
  // Review items due when the block started; kept stable for the whole block.
  const dueAtStart = useRef<typeof dueNow | null>(null);
  if (block?.kind === 'review' && dueAtStart.current === null && learner.ready) dueAtStart.current = dueNow;
  if (block?.kind !== 'review') dueAtStart.current = null;

  useEffect(() => {
    if (session && (session.status === 'done' || idx < 0)) go('today');
  }, [session, idx]);

  if (session === undefined || !learner.ready) return <div className="page"><p className="muted">Loading</p></div>;
  if (!session || !block) return <div className="page"><p>No session is running. <a href={href('today')}>Go to Today</a></p></div>;

  const left = Math.max(0, block.budgetSec - spent);
  const timeUp = left === 0;
  const finish = (how: 'done' | 'skipped' = 'done') => saveSession(db, completeBlock(latest.current!, idx, Date.now(), how));
  const onAttempt = (a: Attempt) => void saveSession(db, addAttempt(latest.current!, idx, a.uuid, Date.now()));
  const concept = block.conceptId ? CONCEPT_BY_ID.get(block.conceptId) ?? null : null;
  const seed = `${session.date}|${session.id}|${block.kind}`;
  const waiting = awaitingCheck(learner.statuses);
  const checkTarget = waiting[waiting.length - 1]?.concept ?? null;
  // One check per concept per session. The concept is latched when the check starts: passing
  // it removes the concept from the awaiting list, and the result screen must still be shown.
  const checkedThisSession = !!checkTarget && learner.events.some(
    (e) => e.conceptId === checkTarget.id && (e.type === 'check-passed' || e.type === 'check-failed') && e.ts >= session.createdAt,
  );
  if (block.kind === 'test' && testPhase === 'check' && !checkConcept.current && checkTarget && !checkedThisSession) checkConcept.current = checkTarget;
  const activeCheck = block.kind === 'test' && testPhase === 'check' ? checkConcept.current : null;
  const learnStatus = block.kind === 'learn' && concept ? learner.statuses.find((s) => s.concept.id === concept.id) : null;

  return (
    <div className="page run" data-testid="session-run" data-block={block.kind}>
      <header className="run-bar">
        <a className="back" href={href('today')}>Today</a>
        <p className="run-title">{idx + 1}. {BLOCK_NAME[block.kind]}</p>
        <p className={`run-clock${timeUp ? ' is-up' : ''}`} data-testid="block-clock" aria-label="Time left in this block">{timeUp ? 'time is up' : mins(left)}</p>
      </header>
      {timeUp && <p className="note" data-testid="time-up">This block’s minutes are used. Finish what is on screen, then move on.</p>}

      {block.kind === 'review' && dueAtStart.current && (
        <ReviewRunner due={dueAtStart.current} sessionId={session.id} stop={timeUp} onAttempt={onAttempt} onFinished={() => void finish()} />
      )}

      {block.kind === 'learn' && concept && (
        <>
          {block.notice && <p className="note">{block.notice}</p>}
          {learnStatus && (learnStatus.stage === 'taught' || learnStatus.stage === 'demonstrated') && (
            <div className="return-card" data-testid="learn-complete">
              <p><strong>{learnStatus.stage === 'demonstrated' ? 'Already demonstrated.' : 'Lesson recorded as studied.'}</strong> Next: new positions on this concept.</p>
              <div className="actions"><button className="primary" data-testid="learn-continue" onClick={() => void finish()}>Continue to Apply</button></div>
            </div>
          )}
          <ConceptStudy concept={concept} learner={learner} sessionId={session.id} embedded />
        </>
      )}

      {block.kind === 'apply' && concept && pool && (
        <PuzzleStream
          key={`apply-${concept.id}`}
          pick={conceptPicker(pool.puzzles, concept, learner.level.level - 100, seed)}
          context="apply" conceptId={concept.id} sessionId={session.id} allowHints seen={learner.seen} stop={timeUp}
          heading={`Apply: ${concept.title}`} onAttempt={onAttempt} onFinished={() => void finish()}
        />
      )}
      {block.kind === 'apply' && !concept && <div className="empty"><p>{block.reason}</p></div>}

      {block.kind === 'test' && pool && activeCheck && (
        <CheckRunner key={`check-${activeCheck.id}`} concept={activeCheck} learner={learner} sessionId={session.id} onDone={() => { checkConcept.current = null; setTestPhase('mixed'); }} />
      )}
      {block.kind === 'test' && pool && !activeCheck && (
        <PuzzleStream
          key="mixed"
          pick={(exclude, i) => {
            const s = pickTestConcept(learner.statuses, lastTestConcept.current);
            if (!s) return null;
            lastTestConcept.current = s.concept.id;
            return conceptPicker(pool.puzzles, s.concept, learner.level.level, seed)(exclude, i);
          }}
          context="test" conceptId={() => lastTestConcept.current}
          sessionId={session.id} allowHints={false} seen={learner.seen} stop={timeUp} heading="Mixed test, no hints"
          onAttempt={onAttempt} onFinished={() => void finish()}
        />
      )}

      <footer className="run-foot">
        <button className="quiet" data-testid="end-block" onClick={() => void finish(block.spentSec > 0 || spent > 0 ? 'done' : 'skipped')}>
          {idx === session.blocks.length - 1 ? 'End session' : `End ${BLOCK_NAME[block.kind].toLowerCase()} and move on`}
        </button>
      </footer>
    </div>
  );
}
