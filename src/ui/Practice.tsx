import { useMemo, useRef } from 'react';
import { go, href, type Route } from '../app/router';
import { type Learner, useDueReviews, useNow, usePack, usePool } from '../app/store';
import { CONCEPT_BY_ID, conceptOpenings, conceptThemes, THEMES } from '../content';
import { selectPuzzles } from '../puzzles/select';
import type { Puzzle } from '../puzzles/types';
import { OwnGameRun, useGames } from './Games';
import { KpkRun } from './Kpk';
import { OpeningRecallRun } from './Openings';
import { KPK_DRILLS } from '../endgames/kpk';
import { drillPositions } from '../games/metrics';
import { conceptPicker, PuzzleStream, ReviewRunner } from './runners';

const OPENING_NAMES: Record<string, string> = { Italian_Game: 'Italian Game', 'Caro-Kann_Defense': 'Caro-Kann Defence' };

export function PracticeHome({ learner }: { learner: Learner }) {
  const pool = usePool();
  const pack = usePack();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const games = useGames();
  const ownDrills = useMemo(() => (games ? drillPositions(games).length : 0), [games]);
  const kpkSeen = useMemo(() => new Set(learner.attempts.filter((a) => a.exerciseKind === 'endgame').map((a) => a.exerciseId)).size, [learner.attempts]);
  const remaining = useMemo(() => {
    const out = new Map<string, number>();
    if (!pool) return out;
    const puzzles = pool.puzzles;
    const count = (key: string, pred: (p: Puzzle) => boolean) =>
      out.set(key, puzzles.reduce((n, p) => n + (pred(p) && !learner.seen.has(p.id) ? 1 : 0), 0));
    for (const s of learner.statuses) {
      const th = conceptThemes(s.concept);
      const op = conceptOpenings(s.concept);
      if (th.length) count(s.concept.id, (p) => th.some((t) => p.themes.includes(t)));
      else if (op.length) count(s.concept.id, (p) => op.some((o) => p.opening?.includes(o)));
    }
    count('theme:long', (p) => p.themes.includes('long'));
    return out;
  }, [pool, learner.seen, learner.statuses]);

  const tactical = learner.statuses.filter((s) => conceptThemes(s.concept).length > 0 && !s.concept.area.includes('endgame') && !s.concept.area.includes('Endgame') && s.concept.id !== 'calc.candidate-moves');
  const endgames = learner.statuses.filter((s) => conceptThemes(s.concept).length > 0 && s.concept.area.toLowerCase().includes('endgame'));
  const openings = learner.statuses.filter((s) => conceptOpenings(s.concept).length > 0);
  const row = (id: string, title: string, meta: string, query: Record<string, string>) => (
    <li key={id}>
      <a href={href('practice/run', query)} data-testid={`practice-${id}`}>
        <span className="concept-name">{title}</span>
        <span className="concept-meta">{meta}</span>
      </a>
    </li>
  );
  const metaFor = (id: string, n: number, k: number) => `${remaining.get(id) ?? 0} unseen left; ${n === 0 ? 'untested' : `${k} of ${n} unseen solved first try`}`;

  return (
    <div className="page" data-testid="practice-home">
      <h1>Practice</h1>
      {pack?.state !== 'installed' && <p className="note">The practice positions are not installed on this device yet. Connect once to download them.</p>}
      <p className="lede">Extra practice outside today’s session. Everything here is recorded the same way: first tries on unseen positions count as evidence, repeats do not.</p>

      <section className="concept-group">
        <h2>Missed positions</h2>
        <ul className="concept-list">
          {row('review', 'Review what is due', `${due.length} due now, ${learner.reviews.length} in the queue`, { mode: 'review' })}
        </ul>
        <ul className="concept-list">
          {row('own', 'Positions from your own games', games && games.length > 0 ? `${ownDrills} position${ownDrills === 1 ? '' : 's'} where you missed a move the engine found clearly best` : 'Appears after analysed games are imported under Progress, Your data', { mode: 'own' })}
        </ul>
      </section>

      <section className="concept-group">
        <h2>Tactics by concept</h2>
        <ul className="concept-list">
          {tactical.map((s) => row(s.concept.id, s.concept.title, metaFor(s.concept.id, s.evidence.n, s.evidence.successes), { concept: s.concept.id }))}
        </ul>
      </section>

      <section className="concept-group">
        <h2>From your openings</h2>
        <ul className="concept-list">
          {openings.map((s) => row(s.concept.id, `Tactics from the ${OPENING_NAMES[conceptOpenings(s.concept)[0]!] ?? s.concept.title}`, metaFor(s.concept.id, s.evidence.n, s.evidence.successes), { concept: s.concept.id }))}
        </ul>
        <ul className="concept-list">
          <li>
            <a href={href('practice/openings')} data-testid="practice-openings">
              <span className="concept-name">Opening repertoire</span>
              <span className="concept-meta">Record the moves you play, most common positions first, and recall them on a schedule</span>
            </a>
          </li>
        </ul>
        <p className="muted small">The tactics above are positions from real games that began with your openings.</p>
      </section>

      <section className="concept-group">
        <h2>Endgames</h2>
        <ul className="concept-list">
          {endgames.map((s) => row(s.concept.id, s.concept.title, metaFor(s.concept.id, s.evidence.n, s.evidence.successes), { concept: s.concept.id }))}
        </ul>
        <ul className="concept-list">
          {row('kpk', 'King and pawn against king, exact', `${KPK_DRILLS.win.length + KPK_DRILLS.hold.length - kpkSeen} unseen starts; win it or hold it against perfect play, every move checked against the full table of the ending`, { mode: 'kpk' })}
        </ul>
        <p className="muted small">The first group is endgame positions from real games. Other theoretical endings (rook endings, basic mates) are not built yet.</p>
      </section>

      <section className="concept-group">
        <h2>Calculation</h2>
        <ul className="concept-list">
          {row('theme-long', 'Three-move solutions', `${remaining.get('theme:long') ?? 0} unseen left. ${THEMES.long?.description ?? ''}`, { theme: 'long' })}
        </ul>
      </section>
    </div>
  );
}

export function PracticeRun({ route, learner }: { route: Route; learner: Learner }) {
  const pool = usePool();
  const now = useNow();
  const due = useDueReviews(learner.reviews, now);
  const dueAtStart = useRef<typeof due | null>(null);
  const mode = route.query.get('mode');
  const conceptId = route.query.get('concept');
  const theme = route.query.get('theme');
  const concept = conceptId ? CONCEPT_BY_ID.get(conceptId) : undefined;
  const seed = `practice|${new Date(now).toDateString()}`;
  if (!pool || !learner.ready) return <div className="page"><p className="muted">Loading positions</p></div>;
  if (mode === 'review' && dueAtStart.current === null) dueAtStart.current = due;

  return (
    <div className="page run" data-testid="practice-run">
      <header className="run-bar">
        <a className="back" href={href('practice')}>Practice</a>
        <p className="run-title">{mode === 'review' ? 'Review' : mode === 'openings' ? 'Repertoire recall' : mode === 'own' ? 'Your games' : mode === 'kpk' ? 'Endgame' : concept?.title ?? (theme ? THEMES[theme]?.name : 'Practice')}</p>
        <span />
      </header>
      {mode === 'kpk' && <KpkRun learner={learner} onFinished={() => go('practice')} />}
      {mode === 'own' && <OwnGameRun learner={learner} onFinished={() => go('practice')} />}
      {mode === 'openings' && <OpeningRecallRun learner={learner} side={route.query.get('side') === 'black' ? 'black' : 'white'} onFinished={() => go('practice/openings')} />}
      {mode === 'review' && dueAtStart.current && <ReviewRunner due={dueAtStart.current} sessionId={null} onFinished={() => go('practice')} />}
      {concept && (
        <PuzzleStream key={concept.id} pick={conceptPicker(pool.puzzles, concept, learner.level.level - 100, seed)} context="practice" conceptId={concept.id}
          sessionId={null} allowHints seen={learner.seen} onFinished={() => go('practice')} />
      )}
      {!concept && theme && (
        <PuzzleStream key={theme} context="practice" conceptId={null} sessionId={null} allowHints seen={learner.seen}
          pick={(exclude, i) => selectPuzzles(pool.puzzles, { themes: [theme], target: learner.level.level - 100, count: 1, exclude, seed: `${seed}|${i}` })[0] ?? null}
          onFinished={() => go('practice')} />
      )}
    </div>
  );
}
