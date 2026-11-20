/**
 * The deep dive (ADR-062): Openings, Tactics and Strategy, each a short page of cards behind
 * one section of the Progress overview. One filter row per page (rated rapid or all games;
 * on Openings also the colour), kept in the address so Back returns to the same view.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { go, href, type Route } from '../app/router';
import type { Learner } from '../app/store';
import { CONCEPT_BY_ID, CONCEPTS, THEMES } from '../content';
import { MOTIF_CONCEPT, MOTIF_NAME, type Motif } from '../games/motifs';
import type { GameRecord } from '../games/types';
import { evalText } from '../engine/uci';
import { loadOpeningNames, type OpeningNames, openingOf } from '../openings/names';
import {
  afterOpening, AHEAD, BEHIND, DEEP_AREAS, CASTLE_BY, castlingOf, clockCurves, type Cohort, cohortGames, gamesText, conversion, endings, LOSING, lossMap, mainLine, nodeAt, openingFamilies, openingTree, puzzleBands,
  puzzleThemes, resultsOf, ribbons, type Side, tacticsBothWays, thinkTime, topMotif, TREE_PLIES, turningMove, WINNING,
} from '../progress/deep';
import { BarList, Legend, RangeRows, shortDate } from './charts';
import {
  CastleDots, ClockLines, GameRibbons, lineText, LossBoard, OpeningIcicle, PieceCounts, RampLegend, RateColumns, Readout, resultsText, ScoreLegend, SideBars, StandingDots, TwoLineLegend, WdlBar, WdlLegend,
} from './deepCharts';
import { useGames } from './Games';
import { colourWord, pctText, rangeText, RESULT_WORD } from './Progress';
import { Seg } from './ProgressDetail';

const PROVISIONAL_N = 20;

export function useOpeningNames(): OpeningNames | null | undefined {
  const [names, setNames] = useState<OpeningNames | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadOpeningNames().then((n) => live && setNames(n));
    return () => {
      live = false;
    };
  }, []);
  return names;
}

const cohortOf = (q: URLSearchParams): Cohort => (q.get('c') === 'all' ? 'all' : 'rapid');
const sideOf = (q: URLSearchParams): Side => (q.get('side') === 'black' ? 'black' : 'white');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function DCard({ testid, title, value, sub, provisional, children }: { testid: string; title: string; value?: ReactNode; sub?: ReactNode; provisional?: boolean; children?: ReactNode }) {
  return (
    <section className="pcard is-static dcard" data-testid={testid}>
      <span className="pcard-title">{title}</span>
      {value && <span className="pcard-value">{value}</span>}
      {sub && <span className="pcard-sub">{sub}{provisional && <span className="tag">Provisional</span>}</span>}
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="metric-empty" data-testid="insufficient">{text}</p>;
}

/** A game as one row: result, colour, date, time control, opening. */
function DeepGameRow({ g, names }: { g: GameRecord; names: OpeningNames | null | undefined }) {
  const opening = names ? openingOf(g.moves, names) : null;
  return (
    <a href={href(`progress/game/${g.id}`)} className="grow" data-testid="deep-game-row">
      <span className={`result-mark is-${g.result ?? 'none'}`} aria-hidden>{g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : g.result === 'draw' ? 'D' : '·'}</span>
      <span className="grow-main">
        <span className="grow-title">{g.result ? RESULT_WORD[g.result] : 'No result'} as {colourWord(g.color)}<span className="muted"> · {shortDate(g.endDate)}</span></span>
        <span className="grow-meta">{g.timeClass}{g.rated === false ? ', unrated' : ''}{opening ? ` · ${opening.name}` : ''}</span>
      </span>
      <span className="grow-rating">{g.playerRating ?? '–'}</span>
    </a>
  );
}

// ---------------------------------------------------------------- overview section

export function DeepSection() {
  const games = useGames();
  const names = useOpeningNames();
  const rapid = useMemo(() => (games ? cohortGames(games, 'rapid') : []), [games]);
  const tactics = useMemo(() => tacticsBothWays(rapid), [rapid]);
  const rs = useMemo(() => ribbons(rapid, 20), [rapid]);
  if (!games || rapid.length === 0) return null;
  const side: Side = rapid.filter((g) => g.color === 'white').length >= rapid.filter((g) => g.color === 'black').length ? 'white' : 'black';
  const tree = openingTree(rapid, side, names ?? null, 2);
  const fams = names ? openingFamilies(rapid, side, names) : [];
  const top = topMotif(tactics.rows);
  const turn = turningMove(rs);
  const mini = tactics.rows.filter((r) => r.motif !== 'other' && r.against.length + r.taken.length + r.missed.length > 0).sort((a, b) => b.against.length + b.taken.length + b.missed.length - (a.against.length + a.taken.length + a.missed.length)).slice(0, 3);
  return (
    <div className="deep-tiles" data-testid="deep-dive">
      <a className="pcard deep-tile" href={href('progress/deep/openings', { side })} data-testid="deep-tile-openings">
        <span className="pcard-head"><span className="pcard-title">Openings</span><span className="chev" aria-hidden>›</span></span>
        <span className="deep-hook">{fams[0] && fams[0].family !== 'Other openings' ? <>Most played as {colourWord(side)}: <strong>{fams[0].family}</strong></> : `Your first moves as ${colourWord(side)}`}</span>
        <OpeningIcicle root={tree} plies={2} rowH={18} title={`Your first move and the reply as ${colourWord(side)}, by how often and how they went.`} />
      </a>
      <a className="pcard deep-tile" href={href('progress/deep/tactics')} data-testid="deep-tile-tactics">
        <span className="pcard-head"><span className="pcard-title">Tactics</span><span className="chev" aria-hidden>›</span></span>
        <span className="deep-hook">{top && top.motif !== 'other' ? <><strong>{MOTIF_NAME[top.motif]}</strong>: {top.against.length} against you, {top.taken.length} of {top.taken.length + top.missed.length} chances taken</> : 'No named tactic in your games yet'}</span>
        {mini.length > 0 && <SideBars compact rows={mini.map((r) => ({ key: r.motif, label: MOTIF_NAME[r.motif], left: r.against.length, right: r.taken.length, rightHollow: r.missed.length }))} headLeft="Against you" headRight="Chances" title="The tactics that came up most in your games, against you and for you." />}
      </a>
      <a className="pcard deep-tile" href={href('progress/deep/strategy')} data-testid="deep-tile-strategy">
        <span className="pcard-head"><span className="pcard-title">Strategy</span><span className="chev" aria-hidden>›</span></span>
        <span className="deep-hook">{turn.move !== null ? <>Your games turn around <strong>move {turn.move}</strong></> : 'How your games go, move by move'}</span>
        {rs.length > 0 && <GameRibbons compact rows={rs.slice(0, 6)} rowH={7} title="Your last six rated rapid games, move by move: blue where you stood better, red where worse." />}
      </a>
    </div>
  );
}

// ---------------------------------------------------------------- pages

export function DeepPage({ area, route, learner }: { area: string; route: Route; learner: Learner }) {
  const games = useGames();
  const names = useOpeningNames();
  const cohort = cohortOf(route.query);
  const side = sideOf(route.query);
  const set = (q: { c?: Cohort; side?: Side }) => go(`progress/deep/${area}`, { c: q.c ?? cohort, ...(area === 'openings' ? { side: q.side ?? side } : {}) });
  const gs = useMemo(() => (games ? cohortGames(games, cohort) : []), [games, cohort]);
  const meta = DEEP_AREAS.find((a) => a.key === area);
  if (!meta) return <div className="page"><a className="back" href={href('progress')}>Progress</a><p>Not found.</p></div>;
  return (
    <div className="page progress deep" data-testid={`deep-${area}`}>
      <a className="back" href={href('progress')}>Progress</a>
      <h1>{meta.title}</h1>
      <div className="deep-filters">
        <Seg value={cohort} options={[{ key: 'rapid', label: 'Rated rapid' }, { key: 'all', label: 'All games' }]} onChange={(c) => set({ c })} label="Games" />
        {area === 'openings' && <Seg value={side} options={[{ key: 'white', label: 'As White' }, { key: 'black', label: 'As Black' }]} onChange={(s) => set({ side: s })} label="Colour" />}
      </div>
      {!games ? <p className="muted">Loading</p> : gs.length === 0 ? <Empty text={cohort === 'rapid' ? 'No rated rapid games on this device yet.' : 'No games on this device yet.'} /> : (
        <>
          {area === 'openings' && <OpeningsPage games={gs} side={side} cohort={cohort} names={names} />}
          {area === 'tactics' && <TacticsPage games={gs} cohort={cohort} learner={learner} />}
          {area === 'strategy' && <StrategyPage games={gs} cohort={cohort} />}
        </>
      )}
    </div>
  );
}

function About({ items }: { items: [string, string][] }) {
  return (
    <section className="about" data-testid="about">
      <h2>About these numbers</h2>
      <dl className="about-list">
        {items.map(([t, d]) => (
          <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
        ))}
      </dl>
    </section>
  );
}

const gamesLink = (cohort: Cohort, set: string, back: string) => href('progress/deep-games', { c: cohort, set, back });

// ---------------------------------------------------------------- openings

function OpeningsPage({ games, side, cohort, names }: { games: GameRecord[]; side: Side; cohort: Cohort; names: OpeningNames | null | undefined }) {
  const [pick, setPick] = useState<{ path: string[]; others?: number } | null>(null);
  const [dot, setDot] = useState<{ label: string; i: number } | null>(null);
  const tree = useMemo(() => openingTree(games, side, names ?? null, TREE_PLIES), [games, side, names]);
  const fams = useMemo(() => (names ? openingFamilies(games, side, names) : []), [games, side, names]);
  const after = useMemo(() => afterOpening(games, side, names ?? null), [games, side, names]);
  const scope = `${cohort === 'rapid' ? 'rated rapid games' : 'games'} as ${colourWord(side)}`;
  if (tree.games.length === 0) return <Empty text={`No ${scope} yet.`} />;
  const main = mainLine(tree);
  const deep = main.filter((n) => n.games.length >= Math.max(2, Math.ceil(tree.games.length / 5)));
  const head = deep[deep.length - 1] ?? main[0]!;
  const picked = pick && !pick.others ? nodeAt(tree, pick.path) : null;
  const folded = pick?.others ? nodeAt(tree, pick.path.slice(0, -1)) : null;
  const foldedGames = folded ? folded.children.slice(folded.children.length - pick!.others!).reduce((t, c) => t + c.games.length, 0) : 0;
  const back = `progress/deep/openings?c=${cohort}&side=${side}`;
  const standRows = [...after.families, after.all];
  const dotRow = dot ? standRows.find((r) => r.label === dot.label) : null;
  const dotPoint = dotRow ? dotRow.points[dot!.i] : null;
  return (
    <>
      <DCard testid="deep-tree" title="Your opening tree"
        value={<><strong className="pcard-mid">{lineText(head.path)}</strong><span className="pcard-unit">{head.games.length} of {tree.games.length} games</span></>}
        sub={<>Each band is the next move, as wide as how often it came · {gamesText(tree.games.length, cohort)} as {colourWord(side)}</>}>
        <OpeningIcicle root={tree} plies={TREE_PLIES} interactive onPick={(c) => setPick({ path: c.node.path, others: c.others })} picked={pick?.path ?? null} title={`Your first three moves each as ${colourWord(side)}, by how often they came and how the games went.`} />
        <ScoreLegend />
        <Readout>
          {picked ? (
            <>
              <strong>{lineText(picked.path)}</strong>{picked.name && <> · {picked.name}</>}<br />
              {resultsText(picked.results)} · <a href={gamesLink(cohort, `tree:${side}:${picked.path.join(',')}`, back)} data-testid="tree-games">See {picked.games.length === 1 ? 'the game' : `the ${picked.games.length} games`}</a>
            </>
          ) : folded ? (
            <>{pick!.others} other moves after {folded.path.length ? lineText(folded.path) : 'the start'}, {plural(foldedGames, 'game')} between them</>
          ) : 'Tap a move for its games.'}
        </Readout>
      </DCard>

      <DCard testid="deep-families" title="Openings you play"
        value={fams[0] ? <><strong className="pcard-mid">{fams[0].family}</strong><span className="pcard-unit">{plural(fams[0].games.length, 'game')}</span></> : undefined}
        sub={names === null ? 'Opening names are not on this device yet.' : <>By name, most played first · score counts a draw as half</>}>
        {fams.length > 0 && (
          <ul className="famlist">
            {fams.map((f) => (
              <li key={f.family}>
                <a href={gamesLink(cohort, `family:${side}:${f.family}`, back)} data-testid="family-row">
                  <span className="fam-top"><span className="fam-name">{f.family}</span><span className="fam-n">{f.games.length}</span><span className="fam-score">{pctText(f.results.score)}</span></span>
                  <WdlBar r={f.results} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {fams.length > 0 && <WdlLegend />}
      </DCard>

      <DCard testid="deep-after" title="After the opening"
        value={after.all.points.length ? <><strong>{after.all.ahead} of {after.all.points.length}</strong><span className="pcard-unit">ahead after move 10</span></> : undefined}
        sub={after.all.points.length ? <>Behind in {after.all.behind} · one dot per game, your standing before move 11</> : 'No game of these reached move 11 yet.'}
        provisional={after.all.points.length > 0 && after.all.points.length < PROVISIONAL_N}>
        {after.all.points.length > 0 && (
          <>
            <StandingDots rows={standRows} onPick={setDot} picked={dot} title={`Your standing after move 10 as ${colourWord(side)}: ahead in ${after.all.ahead}, behind in ${after.all.behind} of ${after.all.points.length} games.`} />
            <Readout>
              {dotPoint ? (
                <>
                  {RESULT_WORD[dotPoint.game.result ?? 'draw']} · {shortDate(dotPoint.game.endDate)} · {evalText(dotPoint.wp)} for you after move 10 · <a href={href(`progress/game/${dotPoint.game.id}`)}>Open the game</a>
                </>
              ) : 'Tap a dot for its game.'}
            </Readout>
          </>
        )}
      </DCard>

      <ul className="rowlist">
        <li><a href={href('progress/more/openings')}>Your repertoire and recall<span className="chev" aria-hidden>›</span></a></li>
      </ul>

      <About items={[
        ['Tree', 'Your games with this colour by their first three moves each. Blue: you scored 60% or more from them; red: 40% or less; gray between; an outline under three games.'],
        ['Names', 'A game is named by the deepest named position it reached in its first 20 moves, from the Lichess opening names (CC0), so a transposition gets its name too. Names only: nothing about the openings is claimed.'],
        ['After the opening', `Your expected score before your 11th move with best play, from the engine's measurement of the game. Ahead: ${AHEAD} or more (about a pawn better); behind: ${BEHIND} or less.`],
      ]} />
    </>
  );
}

// ---------------------------------------------------------------- tactics

function TacticsPage({ games, cohort, learner }: { games: GameRecord[]; cohort: Cohort; learner: Learner }) {
  const [pick, setPick] = useState<Motif | null>(null);
  const [sq, setSq] = useState<string | null>(null);
  const t = useMemo(() => tacticsBothWays(games), [games]);
  const map = useMemo(() => lossMap(t.events), [t]);
  const themes = useMemo(() => puzzleThemes(learner.attempts, THEMES), [learner.attempts]);
  const bands = useMemo(() => puzzleBands(learner.attempts), [learner.attempts]);
  const [band, setBand] = useState<number | null>(null);
  const [allThemes, setAllThemes] = useState(false);
  const top = topMotif(t.rows);
  const rows = t.rows.filter((r) => r.against.length + r.taken.length + r.missed.length > 0);
  const against = t.events.filter((e) => e.side === 'against').length;
  const chances = t.events.filter((e) => e.side === 'for').length;
  const p = pick ? t.rows.find((r) => r.motif === pick) : null;
  const back = `progress/deep/tactics?c=${cohort}`;
  const ev = (k: string) => href('progress/game-events', { kind: k, c: cohort, back });
  const topPiece = (['queen', 'rook', 'bishop', 'knight', 'pawn'] as const).reduce((a, b) => (map.pieces[b] > map.pieces[a] ? b : a), 'queen');
  const atSq = sq ? map.events.filter((e) => (e.game.color === 'black' ? `${e.lost!.square[0]}${9 - Number(e.lost!.square[1])}` : e.lost!.square) === sq) : [];
  const fresh = bands.reduce((s, b) => s + b.rate.n, 0);
  const solved = bands.reduce((s, b) => s + b.rate.k, 0);
  const hardest = themes[0];
  const conceptFor = (theme: string) => CONCEPTS.find((c) => c.themes.includes(theme));
  return (
    <>
      <DCard testid="deep-motifs" title="Tactics, both ways"
        value={top && top.motif !== 'other' ? <><strong className="pcard-mid">{MOTIF_NAME[top.motif]}</strong><span className="pcard-unit">came up most</span></> : undefined}
        sub={top ? <>{plural(against, 'big mistake')} against you · {plural(chances, 'clear chance')} for you · {gamesText(games.length, cohort)}</> : 'No big mistake lost material and no clear chance came up in these games.'}
        provisional={against + chances > 0 && against + chances < PROVISIONAL_N}>
        {rows.length > 0 && (
          <>
            <SideBars rows={rows.map((r) => ({ key: r.motif, label: MOTIF_NAME[r.motif], left: r.against.length, right: r.taken.length, rightHollow: r.missed.length }))} headLeft="Against you" headRight="Your chances" onPick={(k) => setPick(k as Motif)} picked={pick} title={`Tactics in your games: against you ${against}, chances for you ${chances}.`} />
            <Legend items={[{ swatch: 'sb-sw-left', text: 'Used against you' }, { swatch: 'sb-sw-right', text: 'Chance taken' }, { swatch: 'sb-sw-hollow', text: 'Chance missed' }]} />
            <Readout>
              {p ? (
                <span className="readout-links" data-testid="motif-readout">
                  <strong>{MOTIF_NAME[p.motif]}</strong>
                  {p.against.length > 0 && <a href={ev(`motif:against:${p.motif}`)}>{plural(p.against.length, 'time')} against you</a>}
                  {p.missed.length > 0 && <a href={ev(`motif:missed:${p.motif}`)}>{p.missed.length} missed</a>}
                  {p.taken.length > 0 && <a href={ev(`motif:taken:${p.motif}`)}>{p.taken.length} taken</a>}
                  {MOTIF_CONCEPT[p.motif] && <a href={href(`learn/${MOTIF_CONCEPT[p.motif]}`)}>Learn: {CONCEPT_BY_ID.get(MOTIF_CONCEPT[p.motif]!)?.title}</a>}
                </span>
              ) : 'Tap a tactic for its positions.'}
            </Readout>
          </>
        )}
      </DCard>

      <DCard testid="deep-board" title="Where your pieces fall"
        value={map.total ? <><strong>{map.pieces[topPiece]}</strong><span className="pcard-unit">{topPiece === 'knight' ? 'knights' : `${topPiece}s`} lost, the most of any piece</span></> : undefined}
        sub={map.total ? <>{plural(map.total, 'piece')} lost in big mistakes · your side at the bottom</> : 'No piece was lost in a big mistake in these games.'}
        provisional={map.total > 0 && map.total < PROVISIONAL_N}>
        {map.total > 0 && (
          <>
            <LossBoard squares={map.squares} onPick={setSq} picked={sq} title={`Squares where your pieces were taken in big mistakes, your side at the bottom: ${map.total} pieces.`} />
            <PieceCounts pieces={map.pieces} />
            <Readout>
              {sq ? (atSq.length ? <>{sq}: {atSq.map((e) => `${e.lost!.role} (${shortDate(e.game.endDate)}, move ${Math.floor(e.event.ply / 2) + 1})`).join(', ')}</> : `${sq}: nothing lost here.`) : 'Tap a square for what was lost there.'}
            </Readout>
          </>
        )}
      </DCard>

      <h2 className="psec-title deep-sub">In puzzles<span className="psec-meta">First looks only</span></h2>

      <DCard testid="deep-themes" title="Puzzle tactics"
        value={hardest ? <><strong className="pcard-mid">{THEMES[hardest.theme]?.name ?? hardest.theme}</strong><span className="pcard-unit">{hardest.rate.k} of {hardest.rate.n} solved, your lowest</span></> : undefined}
        sub={themes.length ? 'By Lichess theme, seen five times or more · lowest share solved first' : 'Fewer than five first-look puzzles of any tactic yet.'}>
        {themes.length > 0 && <BarList testid="theme-rows" max={100} format={(v) => `${Math.round(v)}%`} rows={(allThemes ? themes : themes.slice(0, 5)).map((r) => ({ key: r.theme, label: THEMES[r.theme]?.name ?? r.theme, meta: ` ${r.rate.k} of ${r.rate.n}`, value: 100 * r.rate.rate!, lo: 100 * r.rate.lo, hi: 100 * r.rate.hi, ...(conceptFor(r.theme) ? { href: href(`learn/${conceptFor(r.theme)!.id}`) } : {}) }))} />}
        {themes.length > 5 && <button className="link" onClick={() => setAllThemes((x) => !x)} data-testid="themes-all">{allThemes ? 'Show the five lowest' : `Show all ${themes.length}`}</button>}
      </DCard>

      <DCard testid="deep-bands" title="Puzzle difficulty"
        value={fresh ? <><strong>{pctText(solved / fresh)}</strong><span className="pcard-unit">solved</span></> : undefined}
        sub={fresh ? <>{fresh} first-look puzzles by Lichess rating · a point and its 95% range per 200 points</> : 'No first-look puzzles yet.'}>
        {bands.length > 0 && (
          <>
            <RateColumns cols={bands.map((b) => ({ key: b.label, label: b.label, rate: b.rate }))} onPick={setBand} picked={band} title={`Share of first-look puzzles solved by puzzle rating, ${bands.length} bands.`} />
            <Readout>{band !== null && bands[band] ? `${bands[band]!.lo}–${bands[band]!.hi}: ${bands[band]!.rate.k} of ${bands[band]!.rate.n} solved${bands[band]!.rate.n > 1 ? `, ${rangeText(bands[band]!.rate)}` : ''}` : 'Tap a band.'}</Readout>
          </>
        )}
      </DCard>

      <About items={[
        ['Against you', 'Each big mistake (20 expected-score points or more) that lost material or allowed mate, named by the opponent\'s reply that punished it.'],
        ['Your chances', 'Each clear chance (one move better than every other by 20 points or more, counted once), named by the engine\'s best line; taken if you played it.'],
        ['The names', 'Worked out on the board: a hanging piece could be taken for nothing within three moves; a fork attacks two pieces worth attacking; a pin or skewer holds a piece in front of a more valuable one; a discovered attack opens a line. Anything else is "Other".'],
        ['The board', 'Where the piece fell: the hanging piece taken, or what was lost after the exchanges. Black\'s games are turned so your side is at the bottom.'],
        ['Puzzles', 'Lichess puzzles seen for the first time, solved with no wrong move and no hint.'],
      ]} />
    </>
  );
}

// ---------------------------------------------------------------- strategy

function StrategyPage({ games, cohort }: { games: GameRecord[]; cohort: Cohort }) {
  const [row, setRow] = useState<number | null>(null);
  const [move, setMove] = useState<number | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const rs = useMemo(() => ribbons(games, 20), [games]);
  const turn = turningMove(rs);
  const conv = useMemo(() => conversion(games), [games]);
  const castles = useMemo(() => castlingOf(games), [games]);
  const clock = useMemo(() => clockCurves(games), [games]);
  const think = useMemo(() => thinkTime(games), [games]);
  const ends = useMemo(() => endings(games), [games]);
  const back = `progress/deep/strategy?c=${cohort}`;
  const scope = cohort === 'rapid' ? 'rated rapid games' : 'games of every kind';
  const early = castles.filter((c) => c.move !== null && c.move <= CASTLE_BY);
  const rest = castles.filter((c) => c.move === null || c.move > CASTLE_BY);
  const r = row !== null ? rs[row] : null;
  const at20 = (ps: { move: number; median: number }[]) => ps.find((p) => p.move === 20) ?? ps[ps.length - 1];
  const y20 = at20(clock.you);
  const t20 = at20(clock.them);
  const cp = move !== null ? { you: clock.you.find((p) => p.move === move), them: clock.them.find((p) => p.move === move) } : null;
  const onTime = ends.rows.find((x) => x.key === 'time');
  const mates = ends.rows.find((x) => x.key === 'mate');
  const er = end ? ends.rows.find((x) => x.key === end) : null;
  const hi = (x: { rate: number; lo: number; hi: number; se: number | null } | null) => (x ? 100 * (x.se !== null ? x.hi : x.rate) : 0);
  return (
    <>
      <DCard testid="deep-ribbons" title="Your games, move by move"
        value={turn.move !== null ? <><strong>Move {turn.move}</strong><span className="pcard-unit">where your games turn</span></> : undefined}
        sub={rs.length ? <>Last {rs.length} {scope}, newest on top · {turn.move !== null ? `the middle move of the biggest mistake in ${turn.games} of them` : 'no big mistake in them'}</> : 'No measured games yet.'}>
        {rs.length > 0 && (
          <>
            <GameRibbons rows={rs} onPick={setRow} picked={row} title={`Your last ${rs.length} games, one row each, one cell per move of yours: blue where you stood better, red where worse; a dot on each big mistake.`} />
            <RampLegend />
            <Readout>
              {r ? (
                <>
                  {RESULT_WORD[r.game.result ?? 'draw']} as {colourWord(r.game.color)} · {shortDate(r.game.endDate)}{r.turn ? ` · biggest mistake on move ${r.turn.move}` : ' · no big mistake'} · <a href={href(`progress/game/${r.game.id}`)} data-testid="ribbon-game">Open the game</a>
                </>
              ) : 'Tap a game.'}
            </Readout>
          </>
        )}
      </DCard>

      <DCard testid="deep-conversion" title="Winning and saving"
        value={conv.winning.games.length ? <><strong>{conv.winning.won.length} of {conv.winning.games.length}</strong><span className="pcard-unit">winning positions won</span></> : undefined}
        sub={<>{conv.losing.saved.length} of {conv.losing.games.length} lost positions saved · {scope}</>}
        provisional={conv.winning.games.length < PROVISIONAL_N || conv.losing.games.length < PROVISIONAL_N}>
        {conv.winning.games.length + conv.losing.games.length > 0 && <RangeRows rows={[{ label: 'Won from winning', rate: conv.winning.rate }, { label: 'Saved from lost', rate: conv.losing.rate }]} title={`Winning positions won: ${conv.winning.won.length} of ${conv.winning.games.length}; lost positions saved: ${conv.losing.saved.length} of ${conv.losing.games.length}.`} />}
        <div className="detail-links">
          {conv.winning.games.length > conv.winning.won.length && <a href={gamesLink(cohort, 'conv:thrown', back)} data-testid="conv-thrown">The {conv.winning.games.length - conv.winning.won.length} winning positions not won</a>}
          {conv.losing.saved.length > 0 && <a href={gamesLink(cohort, 'conv:saved', back)}>The {conv.losing.saved.length} saved</a>}
        </div>
      </DCard>

      <DCard testid="deep-castling" title="King safety"
        value={<><strong>{early.length} of {castles.length}</strong><span className="pcard-unit">castled by move {CASTLE_BY}</span></>}
        sub={<>Never castled in {castles.filter((c) => c.move === null).length} · one dot per game at the move you castled</>}>
        <CastleDots castles={castles} title={`The move you castled on in each of ${castles.length} games: by move ${CASTLE_BY} in ${early.length}, never in ${castles.filter((c) => c.move === null).length}.`} />
        <Legend items={[{ swatch: 'cd-sw', text: 'Kingside' }, { swatch: 'cd-sw is-queen', text: 'Queenside' }, { swatch: 'cd-sw is-never', text: 'Never' }]} />
        <ul className="famlist is-static">
          {[{ label: `By move ${CASTLE_BY}`, gs: early.map((c) => c.game), set: 'castle:early' }, { label: 'Later or never', gs: rest.map((c) => c.game), set: 'castle:late' }].map((x) => {
            const res = resultsOf(x.gs);
            return (
              <li key={x.label}>
                <a href={gamesLink(cohort, x.set, back)}>
                  <span className="fam-top"><span className="fam-name">{x.label}</span><span className="fam-n">{x.gs.length}</span><span className="fam-score">{pctText(res.score)}</span></span>
                  <WdlBar r={res} />
                </a>
              </li>
            );
          })}
        </ul>
      </DCard>

      <DCard testid="deep-clock" title="Time left"
        value={y20 && t20 ? <><strong>{pctText(y20.median)}</strong><span className="pcard-unit">of your time at move {y20.move} · opponents {pctText(t20.median)}</span></> : undefined}
        sub={clock.you.length ? <>Middle game of {plural(clock.games, 'game')} with a clock · the band holds the middle half of yours</> : 'Not enough games with a clock yet.'}>
        {clock.you.length > 1 && (
          <>
            <ClockLines you={clock.you} them={clock.them} onPick={setMove} picked={move} title={`Share of the starting time left after each move: you ${y20 ? pctText(y20.median) : ''} and your opponents ${t20 ? pctText(t20.median) : ''} at move ${y20?.move}.`} />
            <TwoLineLegend a="You" b="Your opponents" />
            <Readout>{cp?.you ? `Move ${move}: you ${pctText(cp.you.median)}${cp.them ? `, opponents ${pctText(cp.them.median)}` : ''} (${cp.you.n} games)` : 'Tap a move.'}</Readout>
          </>
        )}
      </DCard>

      <DCard testid="deep-think" title="Thinking time"
        value={think.median !== null ? <><strong>{Math.round(think.median)} s</strong><span className="pcard-unit">per move (median)</span></> : undefined}
        sub={think.moves ? <>Big mistakes per 100 moves by the time the move took · {think.moves} moves from move 11, undecided positions</> : 'Not enough measured moves with a clock yet.'}
        provisional={think.moves > 0 && think.rows.some((x) => x.decisions > 0 && x.decisions < 30)}>
        {think.moves > 0 && <BarList testid="think-rows" max={Math.max(1, ...think.rows.map((x) => hi(x.ratio)))} format={(v) => v.toFixed(1)} rows={think.rows.map((x) => ({ key: x.key, label: x.label, meta: ` ${x.errors} in ${x.decisions}`, value: x.ratio ? 100 * x.ratio.rate : null, bad: true, ...(x.ratio && x.ratio.se !== null ? { lo: 100 * x.ratio.lo, hi: 100 * x.ratio.hi } : {}) }))} />}
      </DCard>

      <DCard testid="deep-endings" title="How games end"
        value={onTime && onTime.losses.length > 0 ? <><strong>{onTime.losses.length} of {ends.losses}</strong><span className="pcard-unit">losses on time</span></> : mates ? <><strong>{mates.wins.length} of {ends.wins}</strong><span className="pcard-unit">wins by checkmate</span></> : undefined}
        sub={<>{ends.wins} won, {ends.losses} lost, {ends.draws.length} drawn · {scope}</>}>
        <SideBars rows={ends.rows.map((x) => ({ key: x.key, label: x.label, left: x.losses.length, right: x.wins.length }))} headLeft="Lost" headRight="Won" onPick={setEnd} picked={end} title={`How your games ended: ${ends.wins} won, ${ends.losses} lost, ${ends.draws.length} drawn.`} />
        <Legend items={[{ swatch: 'sb-sw-left', text: 'Lost' }, { swatch: 'sb-sw-right', text: 'Won' }]} />
        <Readout>
          {er ? (
            <span className="readout-links">
              <strong>{er.label}</strong>
              {er.losses.length > 0 && <a href={gamesLink(cohort, `end:loss:${er.key}`, back)}>{plural(er.losses.length, 'loss', 'losses')}</a>}
              {er.wins.length > 0 && <a href={gamesLink(cohort, `end:win:${er.key}`, back)}>{plural(er.wins.length, 'win')}</a>}
            </span>
          ) : 'Tap a row for its games.'}
        </Readout>
      </DCard>

      <About items={[
        ['Move by move', 'Your expected score before each of your moves with best play, from the engine\'s measurement of the game: seven shades from lost (red) through level (gray) to won (blue). A dot marks a big mistake (20 points or more).'],
        ['Winning and saving', `Winning: your expected score was ${WINNING} or more before one of your moves (about three pawns up); lost: ${LOSING} or less. Saved: not lost.`],
        ['King safety', 'The move you castled on, read from the moves. Results beside it are what happened, not what castling did.'],
        ['Time left', 'The clock after each move as a share of the starting time, the middle value over games that reached that move, while at least ten did. Daily games are left out.'],
        ['Thinking time', 'The clock before the move less the clock after it, plus the increment. Moves 1 to 10 and positions already decided (expected score under 10 or over 90) are left out, as in the clock rule.'],
        ['How games end', 'Chess.com\'s own words for how each game ended.'],
      ]} />
    </>
  );
}

// ---------------------------------------------------------------- the games behind a number

/** The games a deep-dive set names: "tree:white:e4,e5", "family:black:Italian Game", "conv:thrown", "castle:early", "end:loss:time". */
export function deepGamesOf(games: GameRecord[], set: string, names: OpeningNames | null): { title: string; games: GameRecord[] } {
  const [kind = '', a = '', ...rest] = set.split(':');
  const b = rest.join(':');
  if (kind === 'tree') {
    const node = nodeAt(openingTree(games, a as Side, names, TREE_PLIES), b ? b.split(',') : []);
    return { title: node ? lineText(node.path) : 'Games', games: node?.games ?? [] };
  }
  if (kind === 'family' && names) {
    const fams = openingFamilies(games, a as Side, names);
    const f = fams.find((x) => x.family === b);
    return { title: `${b} as ${colourWord(a as Side)}`, games: f?.games ?? [] };
  }
  if (kind === 'conv') {
    const c = conversion(games);
    if (a === 'thrown') return { title: 'Winning positions not won', games: c.winning.games.filter((g) => g.result !== 'win') };
    if (a === 'saved') return { title: 'Lost positions saved', games: c.losing.saved };
  }
  if (kind === 'castle') {
    const cs = castlingOf(games);
    return a === 'early'
      ? { title: `Castled by move ${CASTLE_BY}`, games: cs.filter((c) => c.move !== null && c.move <= CASTLE_BY).map((c) => c.game) }
      : { title: `Castled later or never`, games: cs.filter((c) => c.move === null || c.move > CASTLE_BY).map((c) => c.game) };
  }
  if (kind === 'end') {
    const row = endings(games).rows.find((x) => x.key === b);
    return { title: `${a === 'win' ? 'Won' : 'Lost'}: ${row?.label.toLowerCase() ?? ''}`, games: row ? (a === 'win' ? row.wins : row.losses) : [] };
  }
  return { title: 'Games', games: [] };
}

export function DeepGamesList({ route }: { route: Route }) {
  const games = useGames();
  const names = useOpeningNames();
  const cohort = cohortOf(route.query);
  const back = route.query.get('back') ?? 'progress';
  const [path, qs = ''] = back.split('?');
  const backHref = href(path!, Object.fromEntries(new URLSearchParams(qs)));
  const backLabel = DEEP_AREAS.find((a) => path === `progress/deep/${a.key}`)?.title ?? 'Progress';
  if (!games || names === undefined) return <div className="page"><p className="muted">Loading</p></div>;
  const { title, games: list } = deepGamesOf(cohortGames(games, cohort), route.query.get('set') ?? '', names);
  return (
    <div className="page progress" data-testid="deep-games">
      <a className="back" href={backHref}>{backLabel}</a>
      <h1>{title}</h1>
      <p className="muted">{gamesText(list.length, cohort)}, newest first.</p>
      <div className="pcard is-list">{list.slice().reverse().map((g) => <DeepGameRow key={g.id} g={g} names={names} />)}</div>
    </div>
  );
}
