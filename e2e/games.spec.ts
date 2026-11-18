import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { movesIn, openApp, playMove, solvePuzzle } from './helpers';

const archive = JSON.parse(readFileSync('src/games/fixtures/chesscom-archive.fixture.json', 'utf8'));
const API = 'https://api.chess.com/pub/player/fixture_learner';

// Every request of the page must be answerable by the test (see autosync.spec.ts).
test.use({ serviceWorkers: 'block' });

test('own games: fetched and analysed on the device, ratings and error metrics with their positions, drill a missed move', async ({ page }) => {
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } }, chess_blitz: { last: { rating: 431, date: 1793900000 } }, chess_daily: { last: { rating: 772, date: 1793800000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');

  // Before any game the dashboard says so and shows only the ratings that were typed in.
  await expect(page.getByTestId('card-ratings')).toContainText('No games are on this device yet');
  await expect(page.getByTestId('card-errors')).toHaveCount(0);
  await expect(page.getByTestId('games-count')).toHaveText('0 games on this device, 0 analysed.');
  // There is no file import: games come only from the public API.
  await expect(page.getByTestId('games-input')).toHaveCount(0);

  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  // Ratings are per time control and never blended.
  await expect(page.getByTestId('rating-rapid')).toHaveAttribute('data-current', '455');
  await expect(page.getByTestId('rating-blitz')).toHaveAttribute('data-current', '431');
  await expect(page.getByTestId('rating-daily')).toHaveAttribute('data-current', '772');
  await expect(page.getByTestId('rating-bullet')).toHaveCount(0);

  // Major errors: numerator, denominator, coverage, engine settings, and no causal claim.
  const errors = page.getByTestId('card-errors');
  await expect(errors).toContainText('3 in 27 decisions');
  await expect(errors).toContainText('provisional');
  await expect(errors).toContainText('6 of 6 imported games analysed');
  await expect(errors).toContainText('not an explanation of why they were played');
  await expect(page.getByTestId('errors-blitz')).toContainText('1/5');
  await expect(page.getByTestId('card-missed')).toContainText('2 of 5');
  await expect(page.getByTestId('clock-insufficient')).toContainText('at least 30 are needed in each group');

  // Drill-down reaches the actual position with what is and is not established.
  await page.getByTestId('view-errors').click();
  await expect(page.getByTestId('event-row')).toHaveCount(3);
  await page.getByTestId('event-row').filter({ hasText: 'Qxe5+' }).click();
  const ev = page.getByTestId('game-event');
  await expect(ev).toContainText('Qxf7#');
  await expect(ev).toContainText('loses material in a short line');
  await expect(ev).toContainText('Why the move was played. The app does not guess.');

  // The missed mate has one clearly best move, so it becomes a personal drill.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-own')).toContainText('1 position where one move was clearly best');
  await page.getByTestId('practice-own').click();
  const drill = page.getByTestId('own-drill');
  await expect(drill).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  // Another move is checked by the built-in engine before anything is recorded against it; this one loses the queen.
  await expect(page.getByTestId('own-verdict')).toContainText('Missed.', { timeout: 30_000 });
  // The result is three moves side by side (ADR-052): the one just tried, the one from the game
  // (here the same move, so one chip carries both names) and the best one. Nothing is said in
  // notation, and the result rests on the position that was asked, with an arrow for each move.
  const board = drill.locator('.board');
  const start = await board.getAttribute('data-fen');
  await expect(page.getByTestId('line-you')).toHaveAttribute('data-who', 'you game');
  await expect(page.getByTestId('line-you')).toContainText('You · Game');
  await expect(page.getByTestId('line-you')).toContainText('Qxe5+');
  await expect(page.getByTestId('line-best')).toContainText('Qxf7#');
  await expect(page.getByTestId('own-verdict')).not.toContainText(/points worse|In the game you played|Best:/);
  await expect(board).toHaveAttribute('data-arrows', 'you:h5e5 best:h5f7');
  // The bar under each move is how good the position is after it: fuller is better.
  const score = async (id: string) => Number(await page.getByTestId(id).locator('.line-bar').getAttribute('data-score'));
  expect(await score('line-you')).toBeLessThan(await score('line-best'));
  // His move plays itself on to where the line is decided, and each move of it can be gone back to.
  await page.getByTestId('line-you').click();
  const steps = page.getByTestId('line-steps');
  await expect(steps).toHaveAttribute('data-line', 'you');
  await expect(steps).toHaveAttribute('data-playing', 'false');
  expect(Number(await steps.getAttribute('data-step'))).toBeGreaterThanOrEqual(2);
  await expect(board).not.toHaveAttribute('data-fen', start!);
  await page.getByTestId('line-move').first().click();
  await expect(steps).toHaveAttribute('data-step', '1');
  await expect(board).toHaveAttribute('data-badge', /^\?\??@e5$/);
  // One step back from the first move is the position that was asked.
  await page.getByTestId('line-prev').click();
  await expect(board).toHaveAttribute('data-fen', start!);
  await expect(page.getByTestId('line-steps')).toHaveCount(0);
  // The best move is a chip like the others: tapped, it is played on the board.
  await page.getByTestId('line-best').click();
  await expect(page.getByTestId('lines')).toHaveAttribute('data-selected', 'best');
  await expect(page.getByTestId('line-consequence')).toHaveText('Checkmate.');
  // Chips, moves and the note all fit above the pinned button on a phone.
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // The best move has been shown, so it is played by hand before the run goes on (ADR-058):
  // the main button is "Try again" and there is no "Next". Asking to be shown the move
  // instead of playing it leaves the same debt, and so does playing the worse move again.
  await expect(page.getByTestId('own-next')).toHaveCount(0);
  await expect(page.getByTestId('own-retry')).toHaveText('Try again');
  await page.getByTestId('own-retry').click();
  await expect(page.getByTestId('own-retry-note')).toBeVisible();
  await page.getByRole('button', { name: 'Show the move' }).click();
  await expect(page.getByTestId('own-verdict')).toContainText('Shown.');
  await expect(page.getByTestId('own-next')).toHaveCount(0);
  await expect(page.getByTestId('own-retry')).toHaveText('Play it yourself');
  await page.getByTestId('own-retry').click();
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toContainText('Missed.', { timeout: 30_000 });
  await expect(page.getByTestId('own-next')).toHaveCount(0);
  // A second go at once is practice: it is not recorded (the review count below is still one).
  await page.getByTestId('own-retry').click();
  await expect(page.getByTestId('own-retry-note')).toBeVisible();
  await expect(drill).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5f7');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'true');
  await page.getByTestId('own-next').click();
  await expect(page.getByTestId('own-done')).toBeVisible();

  // It is now in the review queue, and it never counts as an unseen puzzle.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-review')).toContainText('1 in the queue');
  await page.goto('./#/progress');
  await expect(page.getByTestId('card-unseen').getByTestId('insufficient')).toBeVisible();

  // Asking Chess.com again changes nothing.
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('card-games-import')).toHaveAttribute('data-sync', 'ok');
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.');
  await expect(errors).toContainText('3 in 27 decisions');
});

test('a question from your own games stays put while new games arrive and are analysed in the background', async ({ page }) => {
  // What the phone does all the time: a game is fetched and analysed while a question is on screen.
  let extraGame = false;
  const later = { ...archive.games[1], url: 'https://www.chess.com/game/live/900000099', end_time: archive.games[1].end_time + 3600 };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: extraGame ? { games: [...archive.games, later] } : archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  const start = new Date(2026, 10, 10, 9, 0, 0);
  await page.clock.install({ time: start });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  await page.goto('./#/practice/run?mode=sense');
  const drill = page.getByTestId('sense-drill');
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  const question = await drill.locator('h2').textContent();
  const fen = await drill.locator('.board').getAttribute('data-fen');

  // Hours later the app comes back online: it fetches by itself, finds a new game and analyses it.
  extraGame = true;
  await page.clock.setSystemTime(new Date(start.getTime() + 4 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const measured = () => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('games').objectStore('games').getAll();
      all.onsuccess = () => { open.result.close(); resolve((all.result as { measure?: unknown }[]).filter((g) => g.measure).length); };
    };
  }));
  await expect.poll(measured, { timeout: 90_000 }).toBe(7);

  // The same question is still on screen, still waiting for an answer.
  await expect(drill).toHaveAttribute('data-phase', 'ask');
  expect(await drill.locator('h2').textContent()).toBe(question);
  expect(await drill.locator('.board').getAttribute('data-fen')).toBe(fen);
  await page.getByTestId('sense-no').click();
  await expect(page.getByTestId('sense-verdict')).toBeVisible();
});

test('one button: "Just practise" mixes own-game questions, missed moves and new positions without saying which is coming', async ({ page }) => {
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: archive });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('6 games on this device, 6 analysed.', { timeout: 120_000 });

  await page.goto('./#/today');
  await page.getByTestId('start-mix').click();
  const mix = page.getByTestId('mix-run');
  const kinds: string[] = [];
  for (let turn = 0; turn < 9; turn++) {
    await expect(mix).toHaveAttribute('data-turn', String(turn));
    const kind = (await mix.getAttribute('data-kind'))!;
    kinds.push(kind);
    // Only a count in the bar, whatever the item is; no concept or exercise type is announced.
    await expect(page.getByTestId('mix-how')).toHaveText(`${turn} done`);
    await expect(mix.locator('.kicker')).toHaveCount(0);
    if (kind === 'puzzle') {
      await solvePuzzle(page);
      await page.getByTestId('next').click();
    } else if (kind === 'safe' || kind === 'chance') {
      await page.getByTestId('sense-no').click();
      await expect(page.getByTestId('sense-verdict')).toBeVisible();
      await page.getByTestId('sense-next').click();
    } else if (kind === 'missed') {
      const drill = page.getByTestId('own-drill');
      await playMove(page, (await drill.getAttribute('data-expected'))!);
      await page.getByTestId('own-next').click();
    } else {
      // Something answered wrongly earlier in this run can come back as a review only on a later day.
      throw new Error(`unexpected kind on a first day: ${kind}`);
    }
  }
  expect(new Set(kinds).size).toBeGreaterThanOrEqual(2);
  // At any point: how is it going? One plain count, then on with it.
  await page.getByTestId('mix-how').click();
  await expect(page.getByTestId('run-overall')).toContainText(/\d+ of \d+ passed/);
  await page.getByTestId('mix-resume').click();
  await expect(mix).toHaveAttribute('data-turn', '9');
  // Everything was recorded as ordinary practice.
  await page.goto('./#/progress');
  await expect(page.getByTestId('card-unseen')).toBeVisible();
});

test('your move: play your own move in a position from your game and see exactly what can be taken', async ({ page }) => {
  // A longer game than the fixtures, so there are positions at moves 10 to 19.
  const pgn = ['[Event "Live Chess"]', '[Site "Chess.com"]', '[Date "2026.11.08"]', '[White "fixture_learner"]', '[Black "opponent_long"]', '[Result "1-0"]', '[UTCDate "2026.11.08"]', '[UTCTime "10:00:00"]',
    '[WhiteElo "455"]', '[BlackElo "470"]', '[TimeControl "600"]', '[Termination "fixture_learner won by resignation"]', '[EndDate "2026.11.08"]', '[EndTime "10:20:00"]', '[Link "https://www.chess.com/game/live/900000777"]', '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7 9. h3 h6 10. Nbd2 Re8 11. Nf1 Be6 12. Bc2 d5 13. exd5 Bxd5 14. Ng3 Qd7 15. Nh4 Rad8 16. Nhf5 Kh8 17. Qf3 Ne7 18. Nxe7 Qxe7 1-0'].join('\n');
  const long = { url: 'https://www.chess.com/game/live/900000777', pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', end_time: 1794133200, white: { username: 'fixture_learner', rating: 455, result: 'win' }, black: { username: 'opponent_long', rating: 470, result: 'resigned' } };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: [long] } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('1 games on this device, 1 analysed.', { timeout: 120_000 });

  await page.goto('./#/practice');
  await page.getByTestId('practice-move').click();
  const drill = page.getByTestId('own-move');
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await expect(drill).toContainText('White to move');
  // Before the answer: whose move it is and nothing about what the position is or where it is from (ADR-054).
  await expect(drill).not.toContainText(/Your game|Play your own move|game,/);
  await expect(page.getByTestId('about')).toHaveCount(0);
  const asked = await drill.locator('.board').getAttribute('data-fen');
  // Move 10 of the game. Taking the pawn on e5 puts the knight where the d6 pawn takes it.
  await playMove(page, 'f3e5');
  await expect(drill).toHaveAttribute('data-phase', 'predict');
  await expect(drill).toContainText('Black’s reply to Nxe5?');
  await expect(drill).toContainText('Play the reply you had to reckon with');
  await playMove(page, 'd6e5');
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  const board = drill.locator('.board');
  const size = async () => { const b = (await board.boundingBox())!; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) }; };
  // The result (ADR-052): the rating in a word, and the three moves side by side on the board that
  // was asked about: his, the one from the game, the engine's. No sentences in notation.
  expect(['mistake', 'blunder']).toContain(await drill.getAttribute('data-verdict'));
  await expect(page.getByTestId('own-move-grade')).toHaveText(/^(Mistake|Blunder)\.$/);
  await expect(page.getByTestId('own-move-verdict')).not.toContainText(/Best was|points better|In the game you played|can be taken|Recorded as|Ratings are|built-in engine/);
  await expect(page.getByTestId('line-you')).toContainText('Nxe5');
  const inGame = page.locator('[data-testid^="line-"][data-who~="game"]');
  await expect(inGame).toContainText('Nbd2');
  await expect(page.getByTestId('line-best')).toBeVisible();
  await expect(board).toHaveAttribute('data-fen', asked!); // the position asked, not the one after his move
  await expect(board).toHaveAttribute('data-arrows', /^you:f3e5 .*b1d2/);
  const score = async (id: string) => Number(await page.getByTestId(id).locator('.line-bar').getAttribute('data-score'));
  expect(await score('line-you')).toBeLessThan(await score('line-best'));
  // At the end of each bar, the engine's evaluation in pawns from his side: plus is good for him.
  const evalOf = async (id: string) => (await page.getByTestId(id).getByTestId('line-eval').textContent())!;
  for (const id of ['line-you', 'line-best']) expect(await evalOf(id)).toMatch(/^([+−]\d+\.\d+|0\.00|[+−]M)$/);
  expect(Number((await evalOf('line-you')).replace('−', '-'))).toBeLessThan(Number((await evalOf('line-best')).replace('−', '-')));
  // The reply he named is the one fact still said, in a line.
  await expect(page.getByTestId('own-move-named')).toHaveText('You named the reply: dxe5.');
  // Where the position is from is said now, under the rating.
  await expect(page.getByTestId('about')).toHaveText(/^Your game, .+, move 10\.$/);
  // Under the three moves, the engine's other choices with their numbers (ADR-054): none of
  // them one of the three, best first, under a heading that says how they stand.
  const others = page.getByTestId('others');
  await expect(others).toHaveAttribute('data-state', 'shown', { timeout: 30_000 });
  await expect(others).toHaveAttribute('data-label', /^(About as good|Much worse|Others)$/);
  const other = page.getByTestId('other-move');
  expect(await other.count()).toBeGreaterThanOrEqual(1);
  expect(await other.count()).toBeLessThanOrEqual(3);
  const compared = await page.locator('[data-testid^="line-"][data-uci]').evaluateAll((els) => els.map((e) => e.getAttribute('data-uci')));
  const otherUcis = await other.evaluateAll((els) => els.map((e) => e.getAttribute('data-uci')));
  for (const u of otherUcis) expect(compared).not.toContain(u);
  const otherScores = await other.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-score'))));
  expect(otherScores).toEqual([...otherScores].sort((a, b) => b - a));
  for (const t of await other.getByTestId('line-eval').allTextContents()) expect(t).toMatch(/^([+−]\d+\.\d+|0\.00|[+−]M)$/);
  const rest = await size();
  // One of them, tapped: its line plays on the board in its own colour, and its moves take the row's place.
  await other.first().click();
  await expect(page.getByTestId('own-move-line')).toHaveAttribute('data-line', 'other');
  await expect(page.getByTestId('own-move-line')).toHaveAttribute('data-playing', 'false');
  await expect(board).not.toHaveAttribute('data-fen', asked!);
  await expect(others).toHaveCount(0);
  expect(await size()).toEqual(rest);
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // Back to the position asked: the other choices are there again.
  await page.getByTestId('line-move').first().click();
  await page.getByTestId('line-prev').click();
  await expect(board).toHaveAttribute('data-fen', asked!);
  await expect(others).toHaveAttribute('data-state', 'shown');
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // His own line, tapped: it plays itself and stops where it is decided, marks the square and says what went.
  await page.getByTestId('line-you').click();
  const stepper = page.getByTestId('own-move-line');
  await expect(stepper).toHaveAttribute('data-playing', 'false');
  const length = Number(await stepper.getAttribute('data-length'));
  await expect(stepper).toHaveAttribute('data-step', String(length));
  await expect(page.getByTestId('line-next')).toBeDisabled();
  // What it says there depends on the engine's whole line: the knight's loss is named only when
  // nothing later in the line gives it back (ADR-053). Either way nothing else is claimed.
  const note = page.getByTestId('line-consequence');
  if (await note.count()) await expect(note).toHaveText(/^Knight taken on e5\. You end \d+ points? behind\.$/);
  // Nothing has moved and nothing needs scrolling: board, chips, moves and the note fit above the button.
  expect(await size()).toEqual(rest);
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // On his move itself the piece that can now be taken is ringed, and the move carries its mark.
  await page.getByTestId('line-move').first().click();
  await expect(stepper).toHaveAttribute('data-step', '1');
  await expect(drill).toHaveAttribute('data-loose', 'e5');
  await expect(board).toHaveAttribute('data-rings', 'e5');
  await expect(board).toHaveAttribute('data-badge', /^\?\??@e5$/);
  await expect(page.getByTestId('line-consequence')).toHaveCount(0);
  // One step back from the first move is the position that was asked, with the arrows again.
  await page.getByTestId('line-prev').click();
  await expect(page.getByTestId('own-move-line')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-arrows', /you:f3e5/);
  // The board is live once the answer is in (ADR-055). A move of his own that is nowhere on the
  // screen is a line of its own: a fourth chip, "Try", with a bar and a number like the others,
  // and the engine's answer to it played on the board at once.
  await expect(board).toHaveAttribute('data-movable', 'white');
  const onScreen = await page.locator('[data-uci]').evaluateAll((els) => els.map((e) => e.getAttribute('data-uci')));
  const mine = movesIn(asked!).find((m) => !onScreen.includes(m.uci))!;
  await playMove(page, mine.uci);
  const tried = page.getByTestId('line-try');
  await expect(tried).toHaveAttribute('data-uci', mine.uci);
  await expect(tried).toHaveAttribute('aria-pressed', 'true');
  await expect(tried).toContainText(mine.san);
  await expect(tried.locator('.line-who')).toHaveText('Try');
  await expect(tried.getByTestId('line-eval')).toHaveText(/^([+−]\d+\.\d+|0\.00|[+−]M)$/, { timeout: 30_000 });
  await expect(stepper).toHaveAttribute('data-line', 'other');
  await expect(stepper).toHaveAttribute('data-playing', 'false');
  expect(Number(await stepper.getAttribute('data-step'))).toBeGreaterThanOrEqual(2); // answered on the board
  await expect(page.getByTestId('line-move').first()).toHaveAttribute('data-hand', 'true');
  await expect(page.getByTestId('line-move').first()).toContainText(mine.san);
  await expect(page.getByTestId('line-move').nth(1)).not.toHaveAttribute('data-hand', 'true');
  // The other three chips are as they were, and nothing has moved or needs scrolling.
  await expect(page.getByTestId('line-you')).toContainText('Nxe5');
  expect(await size()).toEqual(rest);
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // "What if they did this instead": on his tried move it is Black's turn, and another reply
  // than the engine's can be made for Black. The try is now that move, named with its number.
  const engineReply = (await page.getByTestId('line-move').nth(1).textContent())!;
  await page.getByTestId('line-move').first().click();
  await expect(stepper).toHaveAttribute('data-step', '1');
  await expect(board).toHaveAttribute('data-movable', 'black');
  const afterMine = (await board.getAttribute('data-fen'))!;
  const theirs = movesIn(afterMine).find((m) => m.san !== engineReply)!;
  await playMove(page, theirs.uci);
  await expect(tried).toHaveAttribute('data-uci', theirs.uci);
  await expect(tried.locator('.line-who')).toHaveText('Try 10…');
  await expect(tried).toContainText(theirs.san);
  await expect(tried.getByTestId('line-eval')).toHaveText(/^([+−]\d+\.\d+|0\.00|[+−]M)$/, { timeout: 30_000 });
  await expect(stepper).toHaveAttribute('data-playing', 'false');
  expect(Number(await stepper.getAttribute('data-step'))).toBeGreaterThanOrEqual(3);
  // Both moves made by hand are marked as his; the engine's answer is not.
  await expect(page.getByTestId('line-move').nth(1)).toHaveAttribute('data-hand', 'true');
  await expect(page.getByTestId('line-move').nth(2)).not.toHaveAttribute('data-hand', 'true');
  expect(await size()).toEqual(rest);
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // The move the line goes on with, made by hand, is one step on and not another try.
  await page.getByTestId('line-move').first().click();
  await playMove(page, theirs.uci);
  await expect(stepper).toHaveAttribute('data-step', '2');
  await expect(tried).toHaveAttribute('data-uci', theirs.uci);
  // Tapping the chip returns to the position asked; the try stays to be compared and opened again.
  await tried.click();
  await expect(page.getByTestId('own-move-line')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-fen', asked!);
  await expect(tried).toHaveAttribute('aria-pressed', 'false');
  await expect(others).toHaveAttribute('data-state', 'shown');
  if (page.viewportSize()!.width < 500) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // The game's move made by hand is the game's line, not a try: its chip opens as if tapped.
  // It was not an error, so its line is asked for when it is opened.
  await playMove(page, 'b1d2');
  await expect(inGame).toHaveAttribute('aria-pressed', 'true');
  await expect(tried).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('own-move-line')).toHaveAttribute('data-step', /[1-9]/);
  await expect(page.getByTestId('line-move').nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(board).not.toHaveAttribute('data-fen', asked!);
  // ... and the move taken back for another try, which is not recorded.
  await page.getByTestId('own-move-retry').click();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await expect(page.getByTestId('own-move-retry-note')).toBeVisible();
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });

  // The next position: a quiet move, and no reply named.
  await page.getByTestId('own-move-next').click();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  const fen = (await drill.getAttribute('data-fen'))!;
  expect(fen).not.toContain('2np1n1p'); // a different position from the first
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('own-move-verdict')).toBeVisible();
});

test('a "Your move" position missed today is asked again in tomorrow\'s review; what is gone from the device is passed over without a word and is not due again', async ({ page }) => {
  // The owner, 2026-11-17: "it keeps saying 'This review position is no longer in the installed
  // content pack...' ... Why does it happen everyday?" Review could not find the positions the
  // session asks from, announced them as gone and left them due.
  const pgn = ['[Event "Live Chess"]', '[Site "Chess.com"]', '[Date "2026.11.08"]', '[White "fixture_learner"]', '[Black "opponent_long"]', '[Result "1-0"]', '[UTCDate "2026.11.08"]', '[UTCTime "10:00:00"]',
    '[WhiteElo "455"]', '[BlackElo "470"]', '[TimeControl "600"]', '[Termination "fixture_learner won by resignation"]', '[EndDate "2026.11.08"]', '[EndTime "10:20:00"]', '[Link "https://www.chess.com/game/live/900000777"]', '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7 9. h3 h6 10. Nbd2 Re8 11. Nf1 Be6 12. Bc2 d5 13. exd5 Bxd5 14. Ng3 Qd7 15. Nh4 Rad8 16. Nhf5 Kh8 17. Qf3 Ne7 18. Nxe7 Qxe7 1-0'].join('\n');
  const long = { url: 'https://www.chess.com/game/live/900000777', pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', end_time: 1794133200, white: { username: 'fixture_learner', rating: 455, result: 'win' }, black: { username: 'opponent_long', rating: 470, result: 'resigned' } };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: [long] } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  const start = new Date(2026, 10, 10, 9, 0, 0);
  await page.clock.install({ time: start });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('1 games on this device, 1 analysed.', { timeout: 120_000 });

  // Today: move 10 of the game, as the session asks it, and a knight given away.
  await page.goto('./#/practice/run?mode=move&pace=0');
  const drill = page.getByTestId('own-move');
  await expect(drill).toHaveAttribute('data-phase', 'move');
  const asked = await drill.locator('.board').getAttribute('data-fen');
  await playMove(page, 'f3e5');
  await expect(drill).toHaveAttribute('data-phase', 'predict');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  expect(['mistake', 'blunder']).toContain(await drill.getAttribute('data-verdict'));

  const states = () => page.evaluate(() => new Promise<{ itemId: string; ask?: string; retired?: string }[]>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('reviewStates').objectStore('reviewStates').getAll();
      all.onsuccess = () => { open.result.close(); resolve(all.result); };
    };
  }));
  await expect.poll(async () => (await states()).map((r) => r.ask)).toEqual([expect.stringMatching(/^move:[^:]+:18$/)]);
  // And something that really is gone: a puzzle due for review that the installed pack does not hold.
  await page.evaluate((due) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('reviewStates', 'readwrite');
      const store = tx.objectStore('reviewStates');
      store.getAll().onsuccess = (e) => {
        const algo = ((e.target as IDBRequest<{ algo: string }[]>).result[0]!).algo;
        store.put({ itemId: 'lichess:notInThePack', algo, due, lastAttemptUuid: 'none', card: { due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: due - 86_400_000 } });
      };
      tx.oncomplete = () => { open.result.close(); resolve(); };
    };
  }), start.getTime());

  // Tomorrow: both are due. The position from his game comes first and is the one he was asked.
  await page.clock.setSystemTime(new Date(start.getTime() + 26 * 3_600_000));
  await page.goto('./#/practice');
  // The app is opened afresh, as on a new day: the row written behind its back is read then.
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('practice-review')).toContainText('2 due now');
  await page.getByTestId('practice-review').click();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await expect(drill.locator('.board')).toHaveAttribute('data-fen', asked!);
  await expect(page.getByTestId('practice-run')).not.toContainText('no longer in the installed content pack');
  await playMove(page, 'b1d2');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  // On from it: the puzzle that is gone is not announced; the queue is simply done.
  await page.getByTestId('own-move-next').click();
  await expect(page.getByTestId('review-empty')).toBeVisible();
  await expect(page.getByTestId('practice-run')).not.toContainText('no longer in the installed content pack');
  expect((await states()).find((r) => r.itemId === 'lichess:notInThePack')?.retired).toBe('gone');
  // It does not count as due any more, today or the day after.
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-review')).toContainText('0 due now');
  await page.clock.setSystemTime(new Date(start.getTime() + 50 * 3_600_000));
  await page.goto('./#/today');
  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-review')).toContainText(/^Review what is due[01] due now/);
  await page.getByTestId('practice-review').click();
  await expect(page.getByTestId('practice-run')).not.toContainText('no longer in the installed content pack');
});

test('your move on the clock: it is announced over a covered board and starts when the board appears; running over never forces a move or changes its rating; the flag ends the streak; Progress counts timed moves apart', async ({ page }) => {
  // Black has a bishop that can already be taken, and a knight he can take for nothing.
  const pgn = ['[Event "Live Chess"]', '[Site "Chess.com"]', '[Date "2026.11.08"]', '[White "fixture_learner"]', '[Black "opponent_long"]', '[Result "1-0"]', '[UTCDate "2026.11.08"]', '[UTCTime "10:00:00"]',
    '[WhiteElo "455"]', '[BlackElo "470"]', '[TimeControl "600"]', '[Termination "fixture_learner won by resignation"]', '[EndDate "2026.11.08"]', '[EndTime "10:20:00"]', '[Link "https://www.chess.com/game/live/900000778"]', '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7 9. h3 h6 10. Nbd2 Re8 11. Nf1 Be6 12. Bc2 d5 13. exd5 Bxd5 14. Ng3 Qd7 15. Nh4 Rad8 16. Nhf5 Kh8 17. Qf3 Ne7 18. Nxe7 Qxe7 1-0'].join('\n');
  const long = { url: 'https://www.chess.com/game/live/900000778', pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', end_time: 1794133200, white: { username: 'fixture_learner', rating: 455, result: 'win' }, black: { username: 'opponent_long', rating: 470, result: 'resigned' } };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: [long] } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await expect(page.getByTestId('card-ownmove')).toContainText('No “Your move” positions played yet');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('1 games on this device, 1 analysed.', { timeout: 120_000 });

  // A two-second clock on every position, chosen by hand here; normally one position in three gets 30 seconds.
  // The announcement lasts a little over a second and the red part of two seconds less than
  // one: too short to catch by asking, so everything the exercise shows is noted as it changes.
  type Seen = { phase: string; splash: string | null; covers: boolean; movable: string; clock: string | null; state: string | null; board: string };
  await page.evaluate(() => {
    const seen: Seen[] = ((window as unknown as { __seen: Seen[] }).__seen = []);
    const note = () => {
      const drill = document.querySelector('[data-testid=own-move]');
      const board = drill?.querySelector('.board');
      if (!drill || !board) return;
      const splash = drill.querySelector('[data-testid=own-move-splash]');
      const clock = drill.querySelector('[data-testid=own-move-clock]');
      const b = board.getBoundingClientRect();
      const c = splash?.getBoundingClientRect();
      const now: Seen = {
        phase: drill.getAttribute('data-phase')!, splash: splash?.textContent ?? null, covers: !!c && Math.abs(c.left - b.left) < 1 && Math.abs(c.top - b.top) < 1 && Math.abs(c.width - b.width) < 1 && Math.abs(c.height - b.height) < 1,
        movable: board.getAttribute('data-movable')!, clock: clock ? `${clock.textContent} ${clock.getAttribute('data-left')}` : null, state: clock?.getAttribute('data-state') ?? null, board: [b.left, b.top, b.width, b.height].join(' '),
      };
      if (JSON.stringify(seen[seen.length - 1]) !== JSON.stringify(now)) seen.push(now);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.goto('./#/practice/run?mode=move&pace=2');
  const drill = page.getByTestId('own-move');
  const clock = page.getByTestId('own-move-clock');
  await expect(clock).toHaveAttribute('data-state', 'up', { timeout: 20_000 });
  await expect(clock).toHaveText('0:00');
  await expect(page.getByTestId('own-move-flag')).toHaveText('Flag fell. Take your time: the move is still rated.');
  const seen = await page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);
  // Announced first (ADR-057): the board is covered and cannot be moved on, and there is no clock yet.
  const announced = seen.filter((x) => x.phase === 'ready');
  expect(announced.length).toBeGreaterThan(0);
  for (const x of announced) {
    expect(x.splash).toContain('On the clock0:02');
    expect(x).toMatchObject({ covers: true, movable: 'none', clock: null });
  }
  // The board appears, and only then does the clock start: from the whole allowance.
  const choosing = seen.filter((x) => x.phase === 'move');
  expect(seen.map((x) => x.phase).join(' ')).toMatch(/^(ready )+(move ?)+$/);
  expect(choosing[0]).toMatchObject({ splash: null, movable: 'white', clock: '0:02 2', state: 'running' });
  // Red for the last part of the allowance, and when it is gone the flag has fallen.
  expect(choosing.map((x) => x.state).filter((x, i, all) => x !== all[i - 1])).toEqual(['running', 'low', 'up']);
  expect(choosing[choosing.length - 1]).toMatchObject({ clock: '0:00 0', movable: 'white' });
  // The announcement and the clock take no room: the board never moved.
  expect(new Set(seen.map((x) => x.board)).size).toBe(1);
  // The position stays; the move is still played, and the facts are still given.
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('own-move-grade')).toContainText('Flag fell at 2 s.');
  // The fallen flag is beside the rating, not instead of it: the move still has one.
  await expect(page.getByTestId('own-move-grade')).toContainText(/Best|Good|inaccuracy|mistake|blunder/i);
  // Nothing was running, so nothing is said to have ended.
  await expect(page.getByTestId('own-move-run')).toHaveCount(0);

  // Next position, in time this time (move 14 of the game: White to move).
  await page.getByTestId('own-move-next').click();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('own-move-grade')).not.toContainText('Flag fell');
  // A sound move in time starts the streak; anything else says nothing of one.
  const sound = ['best', 'good', 'inaccuracy'].includes((await drill.getAttribute('data-verdict'))!);
  if (sound) await expect(page.getByTestId('own-move-run')).toHaveText(' Streak 1.');
  else await expect(page.getByTestId('own-move-run')).toHaveCount(0);
  // Both answers belong to the series of the announced clock.
  expect(await page.evaluate(() => new Promise<string[][]>((resolve, reject) => {
    const open = indexedDB.open('chess-trainer');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('attempts').objectStore('attempts').getAll();
      all.onsuccess = () => { open.result.close(); resolve((all.result as { exerciseKind: string; ts: number; themes: string[] }[]).filter((a) => a.exerciseKind === 'own-move').sort((x, y) => x.ts - y.ts).map((a) => a.themes.filter((t) => t === 'clock:2' || t === 'late' || t.startsWith('pace:')))); };
    };
  }))).toEqual([['pace:2', 'clock:2', 'late'], ['pace:2', 'clock:2']]);

  await page.goto('./#/progress');
  const card = page.getByTestId('card-ownmove');
  await expect(card).toContainText('1 was made after the time ran out');
  await expect(page.getByTestId('ownmove-grades')).toContainText('Best');
  // Both were played on the clock; the untimed count stays empty and is shown beside it.
  await expect(page.getByTestId('ownmove-pace')).toContainText('seconds on the clock: ');
  await expect(page.getByTestId('ownmove-pace')).toContainText('With no clock: 0 of 0 first looks passed');
  await expect(page.getByTestId('ownmove-pace')).toContainText('Counted from 17 November, when the clock began to be announced');
  await expect(page.getByTestId('ownmove-pace-before')).toHaveCount(0);
  // This game was fetched without move clocks, so nothing is said about time in real games.
  await expect(page.getByTestId('ownmove-time')).toHaveCount(0);
});

test('your move: a position left by a reload never comes back as a first look, and an answer given after the app left the screen is kept out of the timed comparison', async ({ page }) => {
  const pgn = ['[Event "Live Chess"]', '[Site "Chess.com"]', '[Date "2026.11.08"]', '[White "fixture_learner"]', '[Black "opponent_long"]', '[Result "1-0"]', '[UTCDate "2026.11.08"]', '[UTCTime "10:00:00"]',
    '[WhiteElo "455"]', '[BlackElo "470"]', '[TimeControl "600"]', '[Termination "fixture_learner won by resignation"]', '[EndDate "2026.11.08"]', '[EndTime "10:20:00"]', '[Link "https://www.chess.com/game/live/900000779"]', '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7 9. h3 h6 10. Nbd2 Re8 11. Nf1 Be6 12. Bc2 d5 13. exd5 Bxd5 14. Ng3 Qd7 15. Nh4 Rad8 16. Nhf5 Kh8 17. Qf3 Ne7 18. Nxe7 Qxe7 1-0'].join('\n');
  const long = { url: 'https://www.chess.com/game/live/900000779', pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', end_time: 1794133200, white: { username: 'fixture_learner', rating: 455, result: 'win' }, black: { username: 'opponent_long', rating: 470, result: 'resigned' } };
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: [long] } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toHaveText('1 games on this device, 1 analysed.', { timeout: 120_000 });

  await page.goto('./#/practice/run?mode=move&pace=30');
  const drill = page.getByTestId('own-move');
  await expect(drill).toHaveAttribute('data-phase', 'move');
  const first = await drill.getAttribute('data-fen');
  // Long enough on screen to count as shown; then the page is reloaded without an answer.
  await page.waitForTimeout(1600);
  await page.reload();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  expect(await drill.getAttribute('data-fen')).not.toBe(first);

  // The app goes to the background and comes back while the move is being chosen.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });

  await page.goto('./#/progress');
  const pace = page.getByTestId('ownmove-pace');
  // One answer in all: rated, but in neither condition. The position that was only shown is not an answer.
  await expect(pace).toContainText('seconds on the clock: 0 of 0 first looks passed');
  await expect(pace).toContainText('With no clock: 0 of 0 first looks passed');
  await expect(pace).toContainText('1 answer is left out of this comparison');
  await expect(page.getByTestId('ownmove-clean')).toContainText(/of 1/);
});


test('repertoire: read from your own games; your courses decide inside their openings; suggestions only elsewhere; games that left it point back to the course', async ({ page }) => {
  // Two games as White with the same first moves (a habit), and a newer one that differs on move 4.
  // Nothing is read from any course.
  const game = (id: number, day: string, moves: string) => {
    const pgn = ['[Event "Live Chess"]', '[Site "Chess.com"]', `[Date "2026.11.${day}"]`, '[White "fixture_learner"]', '[Black "opponent_rep"]', '[Result "1-0"]', `[UTCDate "2026.11.${day}"]`, '[UTCTime "10:00:00"]',
      '[WhiteElo "455"]', '[BlackElo "470"]', '[TimeControl "600"]', '[Termination "fixture_learner won by resignation"]', `[EndDate "2026.11.${day}"]`, '[EndTime "10:20:00"]', `[Link "https://www.chess.com/game/live/${id}"]`, '',
      `${moves} 1-0`].join('\n');
    return { url: `https://www.chess.com/game/live/${id}`, pgn, time_control: '600', time_class: 'rapid', rated: true, rules: 'chess', end_time: 1794133200 + id % 1000, white: { username: 'fixture_learner', rating: 455, result: 'win' }, black: { username: 'opponent_rep', rating: 470, result: 'resigned' } };
  };
  const usual = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O';
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url === `${API}/stats`) return route.fulfill({ headers, json: { chess_rapid: { last: { rating: 455, date: 1794000000 } } } });
    if (url === `${API}/games/archives`) return route.fulfill({ headers, json: { archives: [`${API}/games/2026/11`] } });
    if (url === `${API}/games/2026/11`) return route.fulfill({ headers, json: { games: [game(900000801, '06', usual), game(900000802, '07', usual), game(900000803, '08', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6')] } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await openApp(page, '#/progress');
  await page.getByTestId('chesscom-username').fill('fixture_learner');
  await page.getByTestId('save-username').click();
  await expect(page.getByTestId('games-count')).toContainText('3 games on this device', { timeout: 120_000 });

  await page.goto('./#/practice/openings');
  // The courses, the coverage table and the list of moves are folded under the two things to do there.
  await expect(page.getByTestId('courses-card')).toBeHidden();
  await page.getByTestId('openings-more').locator('summary').click();
  await expect(page.getByTestId('courses-card')).toContainText('The Italian Game');
  await expect(page.getByTestId('course-note')).toContainText('the app does not know them');
  const sources = page.getByTestId('repertoire-sources');
  await expect(sources).toContainText('from your games', { timeout: 30_000 });
  const rows = page.getByTestId('repertoire-row');
  // His first move and the move into the Italian are his own habits.
  const row = (line: RegExp) => rows.filter({ has: page.locator('.concept-name', { hasText: line }) });
  await expect(row(/^1\.e4$/).filter({ hasText: 'from your games: played in 3 of 3' })).toHaveCount(1);
  await expect(row(/^1\.e4 e5 2\.Nf3 Nc6 3\.Bc4$/).filter({ hasText: 'from your games: played in 3 of 3' })).toHaveCount(1);
  // Inside the Italian his course decides: the habit is listed, but waits for his confirmation ...
  await expect(row(/^1\.e4 e5 2\.Nf3 Nc6 3\.Bc4 Bc5 4\.c3$/).filter({ hasText: 'from your games: played in 2 of 3; not yet confirmed against your course' })).toHaveCount(1);
  // ... and the app suggests nothing of its own there or in the Caro-Kann. Elsewhere it does.
  const suggested = rows.filter({ hasText: 'suggested: the sound move most played at your level' });
  expect(await suggested.count()).toBeGreaterThan(0);
  await expect(suggested.filter({ has: page.locator('.concept-name', { hasText: /^1\.e4 c6 |2\.Nf3 Nc6 3\.Bc4 / }) })).toHaveCount(0);
  await expect(page.getByTestId('left-card')).toHaveCount(0);

  // Recall: a move inside a course's opening is asked about, not tested. Outside, a suggestion is
  // asked like any move, and a different sound move can be made his own with one tap.
  await page.getByTestId('start-recall').click();
  const drill = page.getByTestId('opening-drill');
  const confirm = page.getByTestId('opening-confirm');
  const done = page.getByTestId('recall-done');
  const book = JSON.parse(readFileSync('public/packs/openings-lichess.json', 'utf8')) as { positions: Record<string, { bestWp?: number; moves: { uci: string; wp?: number }[] }> };
  let adopted = false;
  let confirmed = false;
  for (let i = 0; i < 80; i++) {
    await expect(drill.or(confirm).or(done).first()).toBeVisible();
    if (await done.isVisible()) break;
    if (await confirm.isVisible()) {
      await expect(confirm).toContainText('your course The Italian Game');
      await expect(page.getByTestId('confirm-course')).toHaveAttribute('href', /chessreps\.com/);
      const inferred = await confirm.getAttribute('data-inferred');
      if (inferred === 'c2c3') {
        await page.getByTestId('confirm-yes').click();
        confirmed = true;
      } else await page.getByTestId('confirm-later').click();
      await expect(page.locator(`[data-testid=opening-confirm][data-inferred="${inferred}"]`)).toHaveCount(0);
      continue;
    }
    await expect(drill).toHaveAttribute('data-done', 'false');
    const expected = (await drill.getAttribute('data-expected'))!;
    const isSuggestion = (await drill.locator('.ask-meta').first().textContent())!.includes('suggested');
    const fen = (await drill.locator('.board').getAttribute('data-fen'))!;
    const data = book.positions[fen.split(' ').slice(0, 4).join(' ')];
    // Another move that the data rates as sound in this position, if there is one.
    const other = !adopted && isSuggestion && data?.bestWp !== undefined ? data.moves.find((m) => m.uci !== expected && m.wp !== undefined && data.bestWp! - m.wp <= 8) : undefined;
    if (!other) {
      await playMove(page, expected);
      await page.getByTestId('drill-next').click();
      continue;
    }
    await playMove(page, other.uci);
    await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-alt', 'sound');
    await page.getByTestId('drill-adopt').click();
    await expect(page.getByTestId('drill-adopted')).toContainText('is now your move here');
    adopted = true;
    await page.getByTestId('drill-next').click();
  }
  expect(adopted).toBe(true);
  expect(confirmed).toBe(true);

  // The confirmed move is now his, and the newer game that played something else is listed with the way back to the course.
  await page.goto('./#/practice/openings');
  await expect(row(/^1\.e4 e5 2\.Nf3 Nc6 3\.Bc4 Bc5 4\.c3$/).filter({ hasText: 'recorded by you' })).toHaveCount(1);
  const left = page.getByTestId('left-row');
  await expect(left).toHaveCount(1);
  await expect(left).toContainText('2026-11-08: after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 you played d3; your move is c3.');
  await expect(left.getByRole('link')).toHaveText('Review it in The Italian Game');

  // Removing a suggestion leaves the position to him: it does not come back.
  await page.getByTestId('openings-moves').locator('summary').click();
  await expect(suggested.first()).toBeVisible();
  const gone = (await suggested.first().locator('.concept-name').textContent())!;
  await suggested.first().getByRole('button').click();
  await expect(rows.filter({ hasText: gone })).toHaveCount(0);
  await page.reload();
  await expect(sources).toContainText('from your games', { timeout: 30_000 });
  await expect(rows.filter({ hasText: gone })).toHaveCount(0);
});
