import { useRef, useState } from 'react';
import { type Learner, useDueReviews, useNow, usePool } from '../app/store';
import type { Concept } from '../content/types';
import type { ReviewState } from '../db/types';
import { type DrillPosition, drillPositions } from '../games/metrics';
import { pickSense, type SenseItem, type SenseKind } from '../games/sense';
import { type MixKind, nextMixKind, reviewOrder } from '../schedule/mix';
import { pickTestConcept } from '../schedule/session';
import { OwnGameDrill, useGames } from './Games';
import { conceptPicker, PuzzleStream, ReviewRunner } from './runners';
import { SenseDrill, senseItemsFrom } from './Sense';

interface Turn {
  n: number;
  kind: MixKind | null;
  review?: ReviewState;
  sense?: SenseItem;
  drill?: DrillPosition;
  concept?: Concept;
}

/**
 * One-button practice. The app chooses what comes next (see src/schedule/mix.ts) and does
 * not say what kind of thing it is: every item carries the same heading, so a position has
 * to be looked at for what it is. Each turn's item is chosen once and kept, whatever changes
 * underneath (games being analysed, attempts being recorded).
 */
export function MixRun({ learner, onFinished }: { learner: Learner; onFinished: () => void }) {
  const pool = usePool();
  const games = useGames();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const [n, setN] = useState(0);
  const turn = useRef<Turn | null>(null);
  const history = useRef<MixKind[]>([]);
  const shown = useRef(new Set<string>());
  const lastConcept = useRef<string | null>(null);
  const run = useRef(Math.random().toString(36).slice(2));
  if (!pool || !learner.ready || games === undefined) return <p className="muted">Loading</p>;

  if (turn.current?.n !== n) {
    const dueLeft = reviewOrder(due).filter((d) => !shown.current.has(d.itemId));
    const senseSeen = new Set([...learner.attempts.filter((a) => a.exerciseKind === 'sense').map((a) => a.exerciseId), ...shown.current]);
    const senseAll = senseItemsFrom(games);
    const kinds: SenseKind[] = Math.random() < 0.5 ? ['safe-or-not', 'chance-or-not'] : ['chance-or-not', 'safe-or-not'];
    const sense = pickSense(senseAll, kinds[0]!, senseSeen, 2, `mix|${run.current}|${n}`)[0] ?? pickSense(senseAll, kinds[1]!, senseSeen, 2, `mix|${run.current}|${n}`)[0];
    const tried = new Set(learner.attempts.filter((a) => a.exerciseKind === 'own-game').map((a) => a.exerciseId));
    const drill = drillPositions(games).find((d) => !tried.has(d.id) && !shown.current.has(d.id));
    const status = pickTestConcept(learner.statuses, lastConcept.current);
    const kind = nextMixKind({ review: dueLeft.length > 0, sense: !!sense, missed: !!drill, puzzle: !!status }, history.current, Math.random);
    const t: Turn = { n, kind };
    if (kind === 'review') t.review = dueLeft[0];
    if (kind === 'sense') t.sense = sense;
    if (kind === 'missed') t.drill = drill;
    if (kind === 'puzzle') t.concept = status!.concept;
    turn.current = t;
    if (kind) history.current.push(kind);
    const id = t.review?.itemId ?? t.sense?.id ?? t.drill?.id;
    if (id) shown.current.add(id);
    if (t.concept) lastConcept.current = t.concept.id;
  }
  const t = turn.current;
  const next = () => setN((x) => x + 1);
  const heading = n === 0 ? 'Practice' : `Practice, ${n} done`;

  if (!t.kind) {
    return (
      <div className="empty" data-testid="mix-empty">
        <p>{n === 0 ? 'There is nothing to practise on this device yet. Positions are installed the first time the app is opened with a connection.' : 'That is everything there is to practise right now.'}</p>
        <div className="actions"><button className="primary" onClick={onFinished}>Back</button></div>
      </div>
    );
  }
  return (
    <div data-testid="mix-run" data-turn={n} data-kind={t.kind}>
      {t.kind === 'review' && <ReviewRunner key={`mix-${n}`} due={[t.review!]} sessionId={null} heading={heading} single onFinished={next} />}
      {t.kind === 'sense' && <SenseDrill key={`mix-${n}`} item={t.sense!} sessionId={null} context="practice" heading={heading} onDone={next} />}
      {t.kind === 'missed' && <OwnGameDrill key={`mix-${n}`} drill={t.drill!} sessionId={null} heading={heading} onDone={next} />}
      {t.kind === 'puzzle' && (
        <PuzzleStream key={`mix-${n}`} limit={1} pick={conceptPicker(pool.puzzles, t.concept!, learner.level.level, `mix|${run.current}|${n}`)}
          context="practice" conceptId={t.concept!.id} sessionId={null} allowHints={false} seen={learner.seen} heading={heading} onFinished={next} />
      )}
    </div>
  );
}
