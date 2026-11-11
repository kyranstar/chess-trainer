import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, playMove, solvePuzzle } from './helpers';

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
  await expect(page.getByTestId('practice-own')).toContainText('1 position where one move was clearly best and you played another');
  await page.getByTestId('practice-own').click();
  const drill = page.getByTestId('own-drill');
  await expect(drill).toHaveAttribute('data-expected', 'h5f7');
  await playMove(page, 'h5e5');
  await expect(page.getByTestId('own-verdict')).toHaveAttribute('data-ok', 'false');
  // Another move is checked by the built-in engine before anything is recorded against it; this one loses the queen.
  await expect(page.getByTestId('own-verdict')).toContainText('rates Qxe5+ clearly lower', { timeout: 30_000 });
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
    // The same plain heading whatever the item is; no concept or exercise type is announced.
    await expect(mix.locator('.kicker').first()).toHaveText(turn === 0 ? 'Practice' : `Practice, ${turn} done`);
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
  await expect(drill).toContainText('White to move. Play your move.');
  // Move 10 of the game. Taking the pawn on e5 puts the knight where the d6 pawn takes it.
  await playMove(page, 'f3e5');
  await expect(drill).toHaveAttribute('data-phase', 'predict');
  await expect(drill).toContainText('Now play the reply you had to reckon with');
  await playMove(page, 'd6e5');
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('own-move-loose')).toContainText('Your knight on e5 can be taken by the pawn on d6, and nothing can take back at once.');
  await expect(page.getByTestId('own-move-verdict')).toContainText('You named it: dxe5.');
  // What the engine does about the piece that can be taken is said, so the fact and the rating cannot seem to disagree.
  await expect(page.getByTestId('own-move-loose-note')).toContainText(/The engine’s line (takes it|starts with a different move)/);
  await expect(page.getByTestId('own-move-verdict')).toContainText('In the game you played Nbd2.');
  // Judged plainly: giving a knight for a pawn is rated by the engine, with both numbers.
  expect(['mistake', 'blunder']).toContain(await drill.getAttribute('data-verdict'));
  await expect(page.getByTestId('own-move-rating')).toContainText('below its first choice');
  // The consequence can be played through on the board ...
  const afterMine = await drill.getAttribute('data-fen');
  await page.getByTestId('line-next').click();
  await expect(page.getByTestId('own-move-line')).toHaveAttribute('data-step', '1');
  await expect(drill.locator('.board')).not.toHaveAttribute('data-fen', afterMine!);
  await page.getByTestId('line-prev').click();
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

test('your move on the clock: running over never forces a move or changes its rating, lateness is noted beside it, and Progress counts timed moves apart', async ({ page }) => {
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
  await page.goto('./#/practice/run?mode=move&pace=2');
  const drill = page.getByTestId('own-move');
  await expect(page.getByTestId('own-move-clock')).toContainText('s for this move');
  await expect(page.getByTestId('own-move-clock')).toContainText('2 seconds are up', { timeout: 10_000 });
  // The position stays; the move is still played, and the facts are still given.
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('own-move-grade')).toContainText('made after the 2 seconds');
  // Late is beside the rating, not instead of it: the move still has one.
  await expect(page.getByTestId('own-move-grade')).toContainText(/Best|Good|inaccuracy|mistake|blunder/i);

  // Next position, in time this time (move 14 of the game: White to move).
  await page.getByTestId('own-move-next').click();
  await expect(drill).toHaveAttribute('data-phase', 'move');
  await playMove(page, 'a2a3');
  await page.getByTestId('own-move-no-reply').click();
  await expect(drill).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });

  await page.goto('./#/progress');
  const card = page.getByTestId('card-ownmove');
  await expect(card).toContainText('1 was made after the time ran out');
  await expect(page.getByTestId('ownmove-grades')).toContainText('Best');
  // Both were played on the clock; the untimed count stays empty and is shown beside it.
  await expect(page.getByTestId('ownmove-pace')).toContainText('seconds on the clock: ');
  await expect(page.getByTestId('ownmove-pace')).toContainText('With no clock: 0 of 0 first looks passed');
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

