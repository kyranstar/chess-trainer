import { type ReactNode, useState } from 'react';
import { go, href } from '../app/router';
import { type Learner, useDb, useOnline } from '../app/store';
import { CONCEPT_BY_ID, CONCEPTS, LESSON_BY_ID, LINK_PROVIDERS, SOURCE_BY_ID, THEMES } from '../content';
import type { Concept, LessonLink } from '../content/types';
import { recordLessonEvent } from '../db/db';
import { CHECK, type ConceptStatus, KPK_CHECK, needsRefresh, nextToLearn } from '../learn/curriculum';
import { formatPct } from '../metrics/metrics';
import { LessonPlayer } from './LessonPlayer';
import { CheckRunner } from './runners';
import { RunFrame } from './Stage';

const STAGE_LABEL: Record<ConceptStatus['stage'], string> = {
  new: 'Not started',
  started: 'Started',
  taught: 'Studied, not yet checked',
  demonstrated: 'Demonstrated',
};

export function stageText(s: ConceptStatus, now: number = Date.now()): string {
  if (needsRefresh(s, now)) return s.lastCheck?.passed ? 'Demonstrated, re-check due' : 'Demonstrated earlier, last re-check not passed';
  if (s.stage === 'demonstrated') return s.demonstratedVia === 'pretest' ? 'Demonstrated by pre-test' : 'Demonstrated';
  if (s.stage === 'taught' && !s.assessable) return 'Studied';
  if (s.stage === 'taught' && s.taughtVia === 'self-reported-link') return 'Marked done by you, not yet checked';
  return STAGE_LABEL[s.stage];
}

export function evidenceText(s: ConceptStatus): string {
  if (!s.assessable) return 'No independent check exists for this yet';
  if (s.evidence.n === 0) return 'Untested';
  const iv = s.evidence.interval!;
  const what = s.concept.assessment.kind === 'kpk-playout' ? 'endings played out correctly first time' : 'unseen solved first try';
  return `${s.evidence.successes} of ${s.evidence.n} ${what} (${formatPct(s.evidence.rate)}, plausible range ${formatPct(iv.lo)}–${formatPct(iv.hi)})${s.evidenceState === 'provisional' ? ', provisional' : ''}`;
}

export function LearnHome({ learner }: { learner: Learner }) {
  const online = useOnline();
  const areas = [...new Set(CONCEPTS.map((c) => c.area))];
  const counts = {
    demonstrated: learner.statuses.filter((s) => s.stage === 'demonstrated').length,
    taught: learner.statuses.filter((s) => s.stage === 'taught').length,
    offline: learner.statuses.filter((s) => s.offlineLesson).length,
  };
  // Where the curriculum stands: the first concept, in its order, that is open and not yet studied.
  // The same choice the daily session makes, so "next" means one thing in the app.
  const next = nextToLearn(learner.statuses, { online }).pick;
  return (
    <div className="page" data-testid="learn-home">
      <h1>Learn</h1>
      <p className="muted small" data-testid="learn-counts">
        {counts.demonstrated} of {CONCEPTS.length} demonstrated, {counts.taught} studied and awaiting a check. {counts.offline} have a lesson on this device; the rest need a connection{online ? '' : ' (you are offline now)'}.
      </p>
      {next && (
        <a className="button primary big" data-testid="learn-next" href={href(`learn/${next.concept.id}`)}>Next: {next.concept.title}</a>
      )}
      {areas.map((area) => (
        <section key={area} className="concept-group">
          <h2>{area}</h2>
          <ul className="concept-list">
            {learner.statuses.filter((s) => s.concept.area === area).map((s) => (
              <li key={s.concept.id}>
                <a href={href(`learn/${s.concept.id}`)} data-testid={`concept-${s.concept.id}`} data-stage={s.stage}>
                  <span className={`stage-mark stage-${s.stage}`} aria-hidden />
                  <span className="concept-name">{s.concept.title}</span>
                  <span className="concept-meta">
                    {/* The dot already says "not started"; the words are for what it cannot say. */}
                    {[
                      s.stage === 'new' ? '' : stageText(s),
                      !s.prereqsMet && s.stage === 'new' ? `After ${s.unmetPrereqs.map((p) => CONCEPT_BY_ID.get(p)?.title).join(', ')}` : '',
                      s.offlineLesson ? 'Lesson on device' : s.hasAnyLesson ? 'Online lesson' : 'No lesson yet',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function providerName(l: LessonLink): string {
  return LINK_PROVIDERS[l.sourceId]?.name ?? l.sourceId;
}

/** Everything about one concept: definition, lessons (local and linked), and the check. */
export function ConceptStudy({ concept, learner, sessionId, onTaught, embedded }: {
  concept: Concept; learner: Learner; sessionId: string | null; onTaught?: () => void; embedded?: boolean;
}) {
  const db = useDb();
  const online = useOnline();
  const status = learner.statuses.find((s) => s.concept.id === concept.id)!;
  // In a session the lesson stored on the device opens at once: the learner tapped "start
  // training", not "choose how to study". Leaving the lesson shows the other ways.
  const [mode, setMode] = useState<{ kind: 'overview' } | { kind: 'lesson'; id: string } | { kind: 'check' }>(() =>
    embedded && concept.localLessons.length > 0 && status.stage !== 'taught' && status.stage !== 'demonstrated' ? { kind: 'lesson', id: concept.localLessons[0]! } : { kind: 'overview' });
  const [opened, setOpened] = useState<string | null>(null);
  const openedBefore = learner.events.some((e) => e.conceptId === concept.id && e.type === 'link-opened');
  const def = concept.descriptionTheme ? THEMES[concept.descriptionTheme] : undefined;

  // On the concept's own page a lesson or a check gets the same frame as any other run: the
  // way back in the bar, the count beside it, the buttons pinned to the bottom.
  const overview = () => setMode({ kind: 'overview' });
  const framed = (title: string, inner: ReactNode) => (embedded ? inner : (
    <RunFrame testid="concept-run" back={{ href: href(`learn/${concept.id}`), label: 'Concept', onClick: overview }} title={title}>{inner}</RunFrame>
  ));
  if (mode.kind === 'lesson') {
    const lesson = LESSON_BY_ID.get(mode.id)!;
    return framed('Lesson', <LessonPlayer lesson={lesson} sessionId={sessionId} showExit={!!embedded} onFinished={() => { overview(); onTaught?.(); }} onExit={overview} />);
  }
  if (mode.kind === 'check') {
    return framed('', <CheckRunner concept={concept} learner={learner} sessionId={sessionId} onDone={overview} />);
  }

  async function open(l: LessonLink) {
    await recordLessonEvent(db, { conceptId: concept.id, lessonId: null, url: l.url, type: 'link-opened', ts: Date.now() });
    setOpened(l.url);
  }
  async function markDone() {
    await recordLessonEvent(db, { conceptId: concept.id, lessonId: null, url: opened, type: 'link-marked-done', ts: Date.now() });
    setOpened(null);
    onTaught?.();
  }

  const page = (inner: ReactNode) => (embedded ? inner : <div className="page"><a className="back" href={href('learn')}>All concepts</a>{inner}</div>);
  return page(
    <div className="concept" data-testid="concept" data-concept={concept.id} data-stage={status.stage}>
      {!embedded && <p className="kicker">{concept.area}</p>}
      <h1>{concept.title}</h1>
      {def && (
        <p className="definition">
          {def.description}
        </p>
      )}
      <dl className="facts">
        <dt>Status</dt>
        <dd data-testid="concept-stage">{stageText(status)}</dd>
        <dt>Evidence</dt>
        <dd data-testid="concept-evidence">{evidenceText(status)}</dd>
        {concept.prereqs.length > 0 && (
          <>
            <dt>Comes after</dt>
            <dd>
              {concept.prereqs.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <a href={href(`learn/${p}`)}>{CONCEPT_BY_ID.get(p)?.title}</a>
                  {status.unmetPrereqs.includes(p) ? ' (not yet demonstrated)' : ''}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {concept.localLessons.length > 0 && (
        <section>
          <h2>Lesson on this device</h2>
          {concept.localLessons.map((id) => {
            const l = LESSON_BY_ID.get(id)!;
            const src = SOURCE_BY_ID.get(l.sourceId)!;
            return (
              <div className="resource" key={id}>
                <p className="resource-title">{l.title}</p>
                <p className="muted">{src.author}, <cite>{src.title}</cite>. About {l.estMinutes} minutes.</p>
                <button className="primary" data-testid="start-lesson" onClick={() => setMode({ kind: 'lesson', id })}>
                  {status.taughtVia === 'local-lesson' ? 'Read again' : 'Start lesson'}
                </button>
              </div>
            );
          })}
        </section>
      )}

      {concept.links.length > 0 && (
        <section>
          <h2>Lessons elsewhere</h2>
          <p className="muted small">These open on another site. Mark a lesson finished yourself when you come back.</p>
          {!online && <p className="note" data-testid="offline-links">You are offline. These lessons need a connection.</p>}
          {concept.links.map((l) => (
            <div className="resource" key={l.url}>
              <p className="resource-title">{l.title}</p>
              <p className="muted">
                {providerName(l)}{l.author ? `, ${l.author}` : ''}{l.level ? `, level ${l.level}` : ''}. {l.access[0]!.toUpperCase()}{l.access.slice(1)}.{l.note ? ` ${l.note}` : ''}
              </p>
              <a className="button" href={l.url} target="_blank" rel="noreferrer" data-testid="open-link" onClick={() => void open(l)}>Open on {providerName(l)}</a>
              {l.fallbackUrl && l.fallbackUrl !== l.url && (
                <p className="definition-small">If the link fails: <a href={l.fallbackUrl} target="_blank" rel="noreferrer" onClick={() => void open(l)}>the {l.sourceId === 'lichess-practice' ? 'study' : 'course page'}</a>.</p>
              )}
            </div>
          ))}
          {(opened || openedBefore) && status.stage !== 'taught' && status.stage !== 'demonstrated' && (
            <div className="return-card" data-testid="return-card">
              <p><strong>Back from the lesson?</strong> Opening a link is not counted as studying.</p>
              <div className="actions">
                <button className="primary" data-testid="mark-done" onClick={() => void markDone()}>I finished the lesson</button>
              </div>
            </div>
          )}
        </section>
      )}
      {!status.hasAnyLesson && <p className="note">No suitable human-written lesson was found for this concept in the source audit. It can still be practised.</p>}

      <section>
        <h2>Check understanding</h2>
        {status.assessable ? (
          <>
            <p className="muted">
              {concept.assessment.kind === 'kpk-playout'
                ? `${KPK_CHECK.size} unseen endings against perfect play, no help. ${KPK_CHECK.pass} correct pass.`
                : `${CHECK.size} unseen positions, no hints. ${CHECK.pass} first-try solves pass.`}
            </p>
            {status.lastCheck && <p data-testid="last-check">Last check: {status.lastCheck.passed ? 'passed' : 'not passed'}{status.lastCheck.total ? ` (${status.lastCheck.correct} of ${status.lastCheck.total})` : ''}.</p>}
            <div className="actions">
              <button className={status.stage === 'taught' ? 'primary' : ''} data-testid="start-check" onClick={() => setMode({ kind: 'check' })}>
                {status.stage === 'demonstrated' ? 'Take another check' : status.stage === 'taught' ? 'Check understanding' : 'Pre-test this concept'}
              </button>
              {concept.themes.length > 0 && <button onClick={() => go('practice/run', { concept: concept.id })}>Practise with hints</button>}
              {concept.assessment.kind === 'kpk-playout' && <button onClick={() => go('practice/run', { mode: 'kpk' })}>Practise this ending</button>}
            </div>
          </>
        ) : (
          <p className="note">No check exists for this concept yet, so it is never reported as demonstrated.</p>
        )}
      </section>
    </div>,
  );
}

export function ConceptPage({ id, learner }: { id: string; learner: Learner }) {
  const concept = CONCEPT_BY_ID.get(id);
  if (!concept) return <div className="page"><h1>Concept not found</h1><a href={href('learn')}>Back to Learn</a></div>;
  return <ConceptStudy concept={concept} learner={learner} sessionId={null} />;
}
