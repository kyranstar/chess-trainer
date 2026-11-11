/**
 * Audit of recent practice against a much deeper engine search than the phone can afford.
 *
 * Input: a backup file (the one the app writes, or the copy it sends to the owner's private
 * repository). For each recent answer it rebuilds the position, replays what the app decided
 * with the app's own code, searches the position with a native engine at a large node budget,
 * and reports where the two disagree: a move passed that loses, a move failed that is fine, a
 * question whose stored answer the deep search does not support, a puzzle move marked wrong
 * that is as good as the solution. It also sets the learner's move beside the engine's.
 *
 * It judges the app, not the learner. A deep search is still an engine line, not proof.
 */
import { applyUci, fenOf, positionFromFen, sameMove, sanOf } from '../../src/chess/rules';
import { consequenceOf } from '../../src/chess/line';
import type { BackupFile } from '../../src/db/backup';
import type { Attempt } from '../../src/db/types';
import { type UciEngine, winPercent } from '../../src/engine/uci';
import { lineSan } from '../../src/games/analyse';
import { describeFree, describeLoose, GRADE_BANDS, gradeMove, type MoveGrade, movePicture, outcomeOfGrade } from '../../src/games/ownmove';
import { chanceItems, safetyItems, type SenseItem } from '../../src/games/sense';
import type { GameRecord } from '../../src/games/types';
import { expectedMove, startRun } from '../../src/puzzles/run';
import type { Puzzle } from '../../src/puzzles/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface AuditOptions {
  /** How many of the most recent days with practice to look at. */
  days: number;
  /** Node budget of each deep search. */
  nodes: number;
}

interface Deep { wp: number; pv: string[]; mate: number | null }

export interface OwnMoveRow {
  kind: 'own-move';
  when: string;
  context: string;
  where: string;
  fen: string;
  my: string;
  /** What the app recorded on the phone. */
  app: { grade: string; outcome: string; late: boolean; interrupted: boolean; pace: number; named: string | null; sawIt: string };
  /** What a deep search says. */
  deep: { best: string; bestLine: string; bestWp: number; myWp: number; loss: number; grade: MoveGrade; reply: string | null; replyLine: string };
  facts: string[];
  /** Whether the first stated capture is really good for the opponent: points of expected score it gives up against the best reply. */
  captureCost: number | null;
  agreement: 'same' | 'same-result' | 'app-too-lenient' | 'app-too-harsh' | 'app-unrated';
  notes: string[];
}

export interface SenseRow {
  kind: 'sense';
  when: string;
  context: string;
  where: string;
  fen: string;
  question: string;
  /** The answer stored with the question, and the learner's response as the app scored it. */
  app: { truth: boolean; response: string; outcome: string };
  deep: { loss: number | null; consequence: string | null; line: string; truth: 'yes' | 'no' | 'unclear' };
  agreement: 'label-supported' | 'label-doubtful' | 'unclear';
  notes: string[];
}

export interface PuzzleRow {
  kind: 'puzzle';
  when: string;
  context: string;
  id: string;
  fen: string;
  my: string | null;
  solution: string;
  app: { outcome: string };
  deep: { best: string; myLoss: number | null; solutionLoss: number };
  agreement: 'ok' | 'sound-move-marked-wrong' | 'solution-not-best';
  notes: string[];
}

export interface AuditReport {
  generatedFrom: { exportTime: string; attempts: number; games: number };
  engine: { name: string; nodes: number };
  days: { date: string; minutes: number; byKind: Record<string, { n: number; success: number; fail: number; assisted: number; skipped: number }> }[];
  ownMoves: OwnMoveRow[];
  sense: SenseRow[];
  puzzles: PuzzleRow[];
  other: Record<string, number>;
  skipped: string[];
}

const localDate = (a: Attempt) => new Date(a.ts + (a.tzOffsetMin ?? 0) * 60_000).toISOString().slice(0, 10);
const localTime = (a: Attempt) => new Date(a.ts + (a.tzOffsetMin ?? 0) * 60_000).toISOString().slice(0, 16).replace('T', ' ');
const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

function fenAtPly(game: GameRecord, ply: number): string {
  let pos = positionFromFen(START);
  for (const uci of game.moves.slice(0, ply)) pos = applyUci(pos, uci);
  return fenOf(pos);
}

function bandOf(loss: number): string {
  return loss < GRADE_BANDS.good ? 'good' : loss < GRADE_BANDS.inaccuracy ? 'inaccuracy' : loss < GRADE_BANDS.mistake ? 'mistake' : 'blunder';
}

/** What the audit needs of an engine: the app's own client fits, and so does a scripted one in tests. */
export type AuditEngine = Pick<UciEngine, 'name' | 'analyse'>;

export async function auditBackup(backup: BackupFile, puzzles: Map<string, Puzzle>, engine: AuditEngine, opts: AuditOptions, log: (s: string) => void = () => {}): Promise<AuditReport> {
  const attempts = (backup.data.attempts ?? []).slice().sort((a, b) => a.ts - b.ts);
  const games = new Map(((backup.data.games ?? []) as GameRecord[]).map((g) => [g.id, g]));
  const dates = [...new Set(attempts.map(localDate))].sort().slice(-opts.days);
  const recent = attempts.filter((a) => dates.includes(localDate(a)));

  const cache = new Map<string, Deep | null>();
  async function deep(fen: string): Promise<Deep | null> {
    if (cache.has(fen)) return cache.get(fen)!;
    const pos = positionFromFen(fen);
    let out: Deep | null = null;
    if (!pos.isEnd()) {
      const line = (await engine.analyse(fen, opts.nodes, 1))[0];
      if (line) out = { wp: winPercent(line.score), pv: line.pv, mate: 'mate' in line.score ? line.score.mate : null };
    }
    cache.set(fen, out);
    return out;
  }
  /** Expected score for the side that just moved into `fen`. */
  async function wpForMover(fen: string): Promise<number | null> {
    const pos = positionFromFen(fen);
    if (pos.isCheckmate()) return 100;
    if (pos.isEnd()) return 50;
    const d = await deep(fen);
    return d ? 100 - d.wp : null;
  }

  const report: AuditReport = {
    generatedFrom: { exportTime: backup.manifest.exportTime, attempts: attempts.length, games: games.size },
    engine: { name: engine.name, nodes: opts.nodes },
    days: [], ownMoves: [], sense: [], puzzles: [], other: {}, skipped: [],
  };

  for (const date of dates) {
    const rows = recent.filter((a) => localDate(a) === date);
    const byKind: AuditReport['days'][number]['byKind'] = {};
    for (const a of rows) {
      const k = (byKind[a.exerciseKind] ??= { n: 0, success: 0, fail: 0, assisted: 0, skipped: 0 });
      k.n++;
      k[a.outcome]++;
    }
    report.days.push({ date, minutes: Math.round(rows.reduce((t, a) => t + Math.min(a.elapsedMs ?? 0, 600_000), 0) / 60_000), byKind });
  }

  const senseItems = new Map<string, SenseItem>();
  const allGames = [...games.values()];
  for (const it of [...safetyItems(allGames), ...chanceItems(allGames)]) senseItems.set(it.id, it);

  let done = 0;
  for (const a of recent) {
    done++;
    if (done % 10 === 0) log(`${done} of ${recent.length} answers`);
    try {
      if (a.exerciseKind === 'own-move') {
        if (a.themes.includes('left') || !a.firstMove) continue;
        const at = a.exerciseId.lastIndexOf(':');
        const game = games.get(a.exerciseId.slice('move:'.length, at));
        const ply = Number(a.exerciseId.slice(at + 1));
        if (!game || !Number.isFinite(ply)) {
          report.skipped.push(`${a.exerciseId}: its game is not in the backup`);
          continue;
        }
        const fen = fenAtPly(game, ply);
        const pos = positionFromFen(fen);
        const my = a.firstMove;
        const facts = movePicture(fen, my);
        const best = await deep(fen);
        const myWp = await wpForMover(facts.afterFen);
        if (!best || myWp === null) {
          report.skipped.push(`${a.exerciseId}: no engine answer`);
          continue;
        }
        const isBest = sameMove(pos, my, best.pv[0]!);
        const loss = isBest ? 0 : Math.max(0, best.wp - myWp);
        const deepGrade = gradeMove(facts, { loss, isBest }, my);
        const after = await deep(facts.afterFen);
        const appGrade = a.themes[1] ?? 'unknown';
        const appPass = a.outcome === 'success';
        const deepPass = outcomeOfGrade(deepGrade) === 'success';
        const agreement: OwnMoveRow['agreement'] = a.outcome === 'skipped' ? 'app-unrated' : appGrade === deepGrade ? 'same' : appPass === deepPass ? 'same-result' : appPass ? 'app-too-lenient' : 'app-too-harsh';
        const factLines = [
          ...facts.loose.map((l) => describeLoose(l)),
          ...(facts.mateInOne ? [`Allows mate in one: ${facts.mateInOne.san}`] : []),
          ...(!facts.tookFree ? facts.freeBefore.slice(0, 2).map((l) => describeFree(l)) : []),
          ...(facts.threatsBefore.length ? [`Before the move ${facts.threatsBefore.length} of his pieces could be taken; ${facts.dealtWith.length} dealt with`] : []),
        ];
        // Is the piece the app says "can be taken" really worth taking?
        let captureCost: number | null = null;
        const capture = facts.captures[0];
        if (capture && after && !facts.mateInOne) {
          try {
            const afterCapture = fenOf(applyUci(positionFromFen(facts.afterFen), capture));
            const oppWp = await wpForMover(afterCapture);
            if (oppWp !== null) captureCost = Math.round(after.wp - oppWp);
          } catch {
            // a capture that needs a promotion piece: not checked
          }
        }
        const notes: string[] = [];
        const named = a.played[1] ?? null;
        if (facts.loose.length && deepPass && captureCost !== null && captureCost >= 10) notes.push(`The screen says a piece "can be taken", but taking it costs the opponent ${captureCost} points: it is not really en prise.`);
        if (facts.loose.length && deepPass && captureCost !== null && captureCost < 10) notes.push('A piece is stated as takeable and the move still rates as a pass on the deep search: the capture exists but does not lose much.');
        if (!facts.loose.length && !facts.mateInOne && !deepPass) notes.push('The exact checks found nothing to take and no mate in one, yet the move loses on the deep search: the reason is beyond the one-move checks, and the screen could only point to the engine line.');
        if (named && after?.pv[0] && !sameMove(positionFromFen(facts.afterFen), named, after.pv[0])) notes.push(`He named ${sanOf(positionFromFen(facts.afterFen), named)} as the reply; the deep search plays ${sanOf(positionFromFen(facts.afterFen), after.pv[0])}.`);
        if (a.themes.includes('late')) notes.push('Made after the clock ran out.');
        report.ownMoves.push({
          kind: 'own-move', when: localTime(a), context: a.context, where: `game ${game.date}, move ${moveNo(ply)} as ${game.color}`, fen, my: sanOf(pos, my),
          app: { grade: appGrade, outcome: a.outcome, late: a.themes.includes('late') || a.themes.includes('timeout'), interrupted: a.themes.includes('interrupted'), pace: Number((a.themes.find((t) => t.startsWith('pace:')) ?? 'pace:0').slice(5)), named: named ? sanOf(positionFromFen(facts.afterFen), named) : null, sawIt: a.themes[3] ?? '' },
          deep: { best: sanOf(pos, best.pv[0]!), bestLine: lineSan(fen, best.pv), bestWp: Math.round(best.wp), myWp: Math.round(myWp), loss: Math.round(loss), grade: deepGrade, reply: after?.pv[0] ? sanOf(positionFromFen(facts.afterFen), after.pv[0]) : null, replyLine: after ? lineSan(facts.afterFen, after.pv) : '' },
          facts: factLines, captureCost, agreement, notes,
        });
      } else if (a.exerciseKind === 'sense') {
        const item = senseItems.get(a.exerciseId);
        if (!item) {
          report.skipped.push(`${a.exerciseId}: the question can no longer be rebuilt from the games in the backup`);
          continue;
        }
        if (a.themes.includes('left')) continue;
        const safety = item.kind === 'safe-or-not';
        let loss: number | null = null;
        let consequence: string | null = null;
        let line = '';
        let truth: SenseRow['deep']['truth'] = 'unclear';
        if (safety) {
          const before = await deep(item.fen);
          const afterFen = item.afterFen ?? fenOf(applyUci(positionFromFen(item.fen), item.proposed!));
          const myWp = await wpForMover(afterFen);
          const d = await deep(afterFen);
          if (before && myWp !== null) loss = Math.round(Math.max(0, before.wp - myWp));
          const c = d ? consequenceOf(afterFen, d.pv, item.color, item.fen) : null;
          consequence = c?.text ?? null;
          line = d ? lineSan(afterFen, d.pv) : '';
          const behind = !!c && (c.kind === 'mate' ? positionFromFen(afterFen).turn !== item.color : c.text.includes('behind'));
          truth = behind || (loss !== null && loss >= 15) ? 'yes' : loss !== null && loss < 5 && !behind ? 'no' : 'unclear';
        } else {
          const d = await deep(item.fen);
          const c = d ? consequenceOf(item.fen, d.pv, item.color) : null;
          consequence = c?.text ?? null;
          line = d ? lineSan(item.fen, d.pv) : '';
          const ahead = !!c && (c.kind === 'mate' || c.text.includes('ahead'));
          truth = ahead ? 'yes' : c ? 'unclear' : 'no';
        }
        const supported = truth === 'unclear' ? 'unclear' : (truth === 'yes') === item.truth ? 'label-supported' : 'label-doubtful';
        const notes: string[] = [];
        if (supported === 'label-doubtful') {
          const saidYes = ['hit', 'wrong-reply', 'unverified-reply', 'false-alarm'].includes(a.themes[2] ?? '');
          notes.push(`The question holds that there ${item.truth ? 'IS' : 'is NOT'} something; the deep search says the opposite. He answered "${saidYes ? 'there is' : 'there is not'}" and was scored ${a.outcome}.`);
        }
        report.sense.push({
          kind: 'sense', when: localTime(a), context: a.context, where: `game ${item.date}, move ${moveNo(item.ply)} as ${item.color}`, fen: item.fen,
          question: safety ? `Is ${item.proposedSan} safe to play?` : 'Is there something to win here?',
          app: { truth: item.truth, response: a.themes[2] ?? '', outcome: a.outcome },
          deep: { loss, consequence, line, truth }, agreement: supported, notes,
        });
      } else if (a.exerciseKind === 'puzzle') {
        if (a.outcome === 'success' || a.outcome === 'skipped') continue; // a solved puzzle needs no second opinion
        const puzzle = puzzles.get(a.exerciseId.replace(/^lichess:/, ''));
        if (!puzzle) {
          report.skipped.push(`${a.exerciseId}: not in the installed puzzle pack`);
          continue;
        }
        const run = startRun(puzzle);
        const pos = positionFromFen(run.fen);
        const solution = expectedMove(run);
        const best = await deep(run.fen);
        if (!best) continue;
        const lossOf = async (uci: string) => {
          if (sameMove(pos, uci, best.pv[0]!)) return 0;
          const wp = await wpForMover(fenOf(applyUci(pos, uci)));
          return wp === null ? null : Math.round(Math.max(0, best.wp - wp));
        };
        const solutionLoss = (await lossOf(solution)) ?? 0;
        const wrongFirst = a.firstMove && !sameMove(pos, a.firstMove, solution) ? a.firstMove : null;
        const myLoss = wrongFirst ? await lossOf(wrongFirst) : null;
        const agreement: PuzzleRow['agreement'] = solutionLoss >= 10 ? 'solution-not-best' : wrongFirst && myLoss !== null && myLoss < 5 ? 'sound-move-marked-wrong' : 'ok';
        const notes: string[] = [];
        if (agreement === 'sound-move-marked-wrong') notes.push(`His move loses only ${myLoss} points against the deep search's best move, and was recorded as ${a.outcome}.`);
        if (agreement === 'solution-not-best') notes.push(`The stored solution is ${solutionLoss} points below the deep search's best move.`);
        if (!wrongFirst && a.firstMove) notes.push('First move right; missed later in the line, or a hint was used.');
        report.puzzles.push({
          kind: 'puzzle', when: localTime(a), context: a.context, id: puzzle.id, fen: run.fen, my: wrongFirst ? sanOf(pos, wrongFirst) : a.firstMove ? sanOf(pos, a.firstMove) : null, solution: sanOf(pos, solution),
          app: { outcome: a.outcome }, deep: { best: sanOf(pos, best.pv[0]!), myLoss, solutionLoss }, agreement, notes,
        });
      } else {
        report.other[a.exerciseKind] = (report.other[a.exerciseKind] ?? 0) + 1;
      }
    } catch (e) {
      report.skipped.push(`${a.exerciseId}: ${(e as Error).message}`);
    }
  }
  report.engine.name = engine.name; // known only once the engine has answered
  return report;
}

/** The report as text a person can read top to bottom. */
export function renderReport(r: AuditReport): string {
  const out: string[] = [];
  out.push(`Practice audit. Backup written ${r.generatedFrom.exportTime}: ${r.generatedFrom.attempts} answers, ${r.generatedFrom.games} games. Deep search: ${r.engine.name}, ${r.engine.nodes.toLocaleString()} nodes a position.`);
  out.push('');
  for (const d of r.days) {
    out.push(`${d.date}: about ${d.minutes} min on answers. ` + Object.entries(d.byKind).map(([k, v]) => `${k} ${v.success}/${v.n} passed${v.fail ? `, ${v.fail} missed` : ''}${v.assisted ? `, ${v.assisted} assisted` : ''}${v.skipped ? `, ${v.skipped} not scored` : ''}`).join('; '));
  }
  const count = <T extends { agreement: string }>(rows: T[]) => rows.reduce<Record<string, number>>((m, x) => ((m[x.agreement] = (m[x.agreement] ?? 0) + 1), m), {});
  out.push('');
  out.push(`YOUR MOVE: ${r.ownMoves.length} answers. ${JSON.stringify(count(r.ownMoves))}`);
  const appPass = r.ownMoves.filter((x) => x.app.outcome === 'success').length;
  const deepPass = r.ownMoves.filter((x) => outcomeOfGrade(x.deep.grade) === 'success').length;
  out.push(`  The app passed ${appPass} of ${r.ownMoves.length}; on the deep search ${deepPass} of ${r.ownMoves.length} pass.`);
  for (const x of r.ownMoves) {
    out.push(`  [${x.agreement}] ${x.when} ${x.where}${x.app.pace ? ` (clock ${x.app.pace}s${x.app.late ? ', late' : ''})` : ''}`);
    out.push(`      he played ${x.my}; app: ${x.app.grade} (${x.app.outcome}); deep: ${x.deep.grade}, ${x.deep.loss} points below ${x.deep.best} (${x.deep.myWp} against ${x.deep.bestWp}); band on loss alone: ${bandOf(x.deep.loss)}`);
    out.push(`      best line ${x.deep.bestLine} | after his move ${x.deep.replyLine}`);
    for (const f of x.facts) out.push(`      fact: ${f}`);
    for (const n of x.notes) out.push(`      note: ${n}`);
    out.push(`      ${x.fen}`);
  }
  out.push('');
  out.push(`OWN-GAME QUESTIONS: ${r.sense.length} answers. ${JSON.stringify(count(r.sense))}`);
  for (const x of r.sense) {
    out.push(`  [${x.agreement}] ${x.when} ${x.where}: ${x.question} stored answer ${x.app.truth ? 'yes, there is something' : 'no, nothing'}; he: ${x.app.response} (${x.app.outcome}); deep: ${x.deep.truth}${x.deep.loss !== null ? `, costs ${x.deep.loss}` : ''}${x.deep.consequence ? `, ${x.deep.consequence}` : ''}`);
    if (x.agreement !== 'label-supported') out.push(`      line ${x.deep.line} | ${x.fen}`);
    for (const n of x.notes) out.push(`      note: ${n}`);
  }
  out.push('');
  out.push(`PUZZLES not solved first try: ${r.puzzles.length}. ${JSON.stringify(count(r.puzzles))}`);
  for (const x of r.puzzles) {
    out.push(`  [${x.agreement}] ${x.when} ${x.id}: he ${x.my ?? 'gave no move'}; solution ${x.solution}; deep best ${x.deep.best}${x.deep.myLoss !== null ? `; his move costs ${x.deep.myLoss}` : ''} (${x.app.outcome})`);
    for (const n of x.notes) out.push(`      note: ${n}`);
  }
  out.push('');
  out.push(`OTHER answers not audited (exact or recall exercises): ${JSON.stringify(r.other)}`);
  if (r.skipped.length) out.push(`COULD NOT BE CHECKED (${r.skipped.length}): ${r.skipped.slice(0, 12).join(' | ')}`);
  return out.join('\n');
}
