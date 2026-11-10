# Project state

Updated: 2026-11-10 (second round: audits, outside review, automatic import)
Branch: `main` (same as `build/trainer`). Commit: see `git log -1`; this file is committed with the work it describes.
Status: **M0 done. M1–M4 built; M5 started. Published: source at https://github.com/kyranstar/chess-trainer (public, `main`), app at https://kyranstar.github.io/chess-trainer/ (`gh-pages`). This round: games and ratings now arrive by themselves and are analysed on the device; five audits (bugs, teaching, test coverage, iPhone UX, data validity) and two passes by an outside reviewer were worked through (ADR-026 to ADR-033). Not done: anything on the physical iPhone, which needs the owner's hands.** M6 (sync) not started and deferred by design.

## What works today (user-visible)

- **Today**: study/play suggestion with its reason; a 30-minute plan (also 10/20/45/60) as four numbered blocks with the reason for each; one-tap start and resume; a clock per block; review hard-capped; new learning always reserved when a concept is ready; summary built from recorded attempts. A session in use at midnight keeps running. Ending the day asks once. Games actually played (fetched from Chess.com) count as play days.
- **Games and ratings arrive by themselves** (ADR-026): with a Chess.com username set (the published build carries the owner's, so the phone needs no setup), the app reads the public ratings and game archives when it is opened or brought to the front (at most every three hours, or on "Check Chess.com now"), and analyses new games on the device with a built-in engine while the app is visible. Nothing is sent anywhere else. Offline, rate-limited, unknown-player and error states are shown; the last good data stays.
- **"Is it working?"** (top of Progress, ADR-027/032): rapid rating; the share of rated rapid games with an avoidable loss of material or allowed mate in the first 20 moves (last 20 games against the 20 before, with counts, range, all such moves per decision, the engine setting, and games still waiting to be measured); and results on questions from your own games.
- **Questions from your own games** (ADR-028/032): "is this move safe?" and "is there something here?", half of them controls where the honest answer is no, alternating with puzzles in the unannounced test block and available under Practice. Hits and false alarms are reported separately.
- **Baseline**: self-paced sampler; readings are only "untested", "provisional" or "pre-test to skip". The last position is always finished before the result screen appears.
- **Play days**: warm-up review, one 10+5 game on your own site, then a written reflection.
- **Learn**: 29 concepts in prerequisite order with stage and evidence. Five lessons on the device, verbatim from Edward Lasker, interactive and resumable. Linked lessons on Lichess Practice, Chess.com and Chessreps with an explicit "I finished the lesson" step. Checks (5 unseen, no hints, 4 to pass, not skippable) are given in a later day's session, do not name their theme while running, and are asked again after 21 days; a stale or failed re-check is labelled (ADR-029). The check on a concept's page can still be taken at any time. A 30-day projection, labelled as a projection.
- **Practice**: review queue (FSRS; due means due today) covering missed puzzles, lesson examples, repertoire moves, own-game positions and endgame starts; unseen positions by concept; own-game questions; tactics from Italian and Caro-Kann games; endgame positions; three-move calculation. After a wrong puzzle move the built-in engine's reply can be shown on request.
- **Exact endgames**: king and pawn against king against perfect play from 480 starts, judged by a complete table computed here. Underpromotion and a stalemating or hanging queen are scored as the draws they are.
- **Opening repertoire**: record the move you play in each position, most frequently reached first, weighted by real Lichess move frequencies in a chosen rating band; engine evidence per move; recall on the review schedule (a changed move starts as a new item).
- **Own games** (Progress): rating per time control (rated games only); major errors per 100 decisions with range and engine setting; missed chances led by those with one clearly best move, each counted once; errors when short of time, compared only on undecided positions; every number opens its positions; missed moves with one clearly best answer become drills. A deeper analysis from the Mac can still be imported for looking at games; it never changes the headline.
- **Progress**: unseen puzzle accuracy with n and range, per-concept table with "untested", retention by gap with the scheduler's forecast, exact endgame technique, curriculum coverage, opening preparedness, logged games, practice-difficulty estimate, backup/restore (now including preferences), storage-protection status, installed content and licences.
- **Offline**: after one online visit the app shell, lessons, 8,219 puzzles, the opening book and the engine are on the device; everything works with no network except linked lessons and fetching new games.

## What does not exist yet (do not describe as done)

- **Nothing has been tested on the physical iPhone**: Home Screen install, touch on the board, backup to Files, and the first real fetch and on-device analysis of the owner's games (about 90 games; expect well over half an hour of the app being open in total, resumable). On the iPhone: open https://kyranstar.github.io/chess-trainer/ in Safari, Share → Add to Home Screen, open it once online, then Progress → Your data → Check this device.
- **The headline comparison needs 40 measured rated rapid games** before it shows "last 20 against the 20 before"; until then it shows the overall share and how many games are waiting.
- **The reviewer's recommended next exercise is not built**: choose a move in an ordinary position, predict the reply, keep or revise. Own-game questions so far judge a move that is shown; they do not yet train checking one's own intended move. They also sit mainly in the 6-minute test block.
- The session split is still 7 / 9 / 8 / 6 minutes (an owner decision, see below). The curriculum order is unchanged although the owner's games argue for moving safety, counting and recaptures forward and pawn endings and Caro-Kann depth back.
- Exact endgames cover king and pawn against king only. No conversion play-outs from won positions. No Lichess-study import. No sync between phone and Mac (M6): each device has its own history; backups move it by hand.
- 5 of 29 concepts have an offline human-written lesson; 2 have no lesson at all; 7 have no independent check.
- Opening data is deep (14 plies) only after 1.e4 e5 and 1.e4 c6.
- The Mac pipeline's own analysis still has the faults listed in ADR-033; it feeds no trend any more.
- React components have no unit tests; they are covered only by the browser tests. "Old backup file" tests recompute checksums with current code rather than using frozen files.
- Not addressed from the UX audit: a confirm-before-judging option for moves (squares are 37 px in a Safari tab, 45 px installed), the long Progress page with backup at the bottom, the repertoire builder's scrolling, VoiceOver access to the board, small touch targets on back links and chips.

## Verification evidence (run 2026-11-10, Node 22.23.1, macOS)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 22 files, 230 tests passed. New this round: Chess.com conversion and sync against a fake transport; the shipped WebAssembly engine run in Node on fixture games (labels, facts, target events, and the same game analysed twice giving the same record); measurement record kept through a later import; headline and own-game question definitions including the cases the reviewer named (piece hung in a lost position, two winning captures, forced loss, unsettled line); delayed and repeated checks; due-by-day; repertoire identity and castling; session identity at midnight; atomic session writes; preferences in backups; king-and-pawn promotions |
| `cd pipeline && uv run pytest -q` | 43 passed |
| `npm run build` | built; service worker precaches 27 entries (7.3 MB, including the 1.9 MB engine) |
| `npm run e2e` | 38 passed, 2 skipped by design (iPhone 14 WebKit, desktop Chromium). New: automatic fetch and on-device analysis against a mocked Chess.com; a tap landing on the right square after the board moved without a scroll; cancelling a promotion; the check arriving in the next day's session unannounced; ending a session asks once; the engine's reply after a wrong move |
| `npm run check` (all of the above in one command) | exit 0 on the final run |
| Red-then-green | the tap-accuracy and promotion-cancel browser tests were run against a build with the two fixes removed and failed there |
| Live cross-origin check (earlier this round) | `api.chess.com` answered a browser request from the published origin with status 200 in WebKit and Chromium |
| Published site, fresh iPhone-size WebKit profile, no setup (`npx playwright test --config data/playwright.smoke.config.ts`, git-ignored) | new build served; 11 requests to Chess.com's public API, all 200; 87 games stored; current ratings shown (rapid 457, blitz 423, daily 772); on-device analysis started by itself and finished its first game within seconds; headline reports 41 rapid games waiting to be measured |

Not re-verified this round: the iOS simulator run and the Mac pipeline on the owner's real games (unchanged code paths apart from the engine-name fix). The full browser suite is no longer run against the published site: that build carries a default username, so every test would query Chess.com for real. Use the smoke config above for the live site and `npm run e2e` (mocked API) for everything else.

Bugs found by the audits and fixed this round: review of a lesson example could never be completed; a session running at midnight vanished and wrote an empty row; cancelling a promotion froze the board; a correct tap could be scored as a different, wrong move after the board moved on screen; the five check positions were re-drawn after every answer; "Show solution" during the reply animation crashed; the baseline cut off its last position; "Check Chess.com now" was ignored while a background round ran; a changed repertoire move kept the old move's schedule; knight and bishop promotions in the pawn ending were scored as wins.

## Open decisions for the owner

1. **Is 30 minutes a hard daily ceiling?** And may the 7 / 9 / 8 / 6 split change? Both reviews want more time on ordinary-position practice from your own games (for example 6 review / 8 learn / 10 own-game practice / 6 test).
2. **Curriculum order**: move safety, counting and recaptures forward, and pawn endings and Caro-Kann depth back, given your games (0 of 87 reached a pawn ending; the Caro-Kann appeared in 2 of 46 White games; a third of major errors were one-move piece-safety failures)? Add a small Black opening-principles concept?
3. **Keep the 30-day projection?** The outside reviewer would delete it; it was in the original brief.
4. **Confirm before a move is judged?** It would stop mis-taps being recorded as misses, at the cost of one more tap per move.
5. **Phone and Mac histories stay separate** until sync exists (M6); backups move them by hand. Acceptable for now?
6. **Lesson review**: the five local lessons are marked `ownerReview: pending` until you have read them.

Settled on 2026-11-10: US jurisdiction (ADR-022); public repository (ADR-025); zero manual steps for games and ratings (ADR-026).

## Known issues and risks

- A queued review item whose content is gone (retired puzzle, re-analysed game) shows a "no longer available" card and stays due.
- The first on-device measurement of a large backlog takes a long time on a phone and only runs while the app is visible.
- A sound sacrifice in a position that is already decided is counted as a target event (ADR-032).
- Chess.com's public data can lag by hours; "updates when opened" is subject to that.
- `SOUND_MARGIN` of 8 expected-score points is lenient near equality.
- Time in a block is counted only while the page is visible.
- The bundle is one script of about 600 kB (about 185 kB gzip), deliberately unsplit so the whole app precaches.

## Next slice

1. Owner: install on the iPhone, open it online once, run "Check this device", and leave it open for a while so games are fetched and measured. Answer the open decisions above.
2. Build the move-check exercise (choose, predict the reply, keep or revise) on ordinary positions from own games, moves 10 to 19 first, and give it real practice time in the session.
3. Port analysis v3 (facts, settled lines, cleared engine, rated flag from the JSON archive) to the Mac pipeline, or retire the Mac analysis.
4. Frozen backup fixtures; unit tests for the session runner; the remaining UX items.

## Commands

```sh
nvm use                      # Node 22.23.1 (the machine default 21.x cannot run Vite 8)
npm install
npm run dev                  # http://localhost:5173
npm run check                # typecheck + unit + build + e2e

cd pipeline && uv sync && uv run pytest -q
uv run python -m trainer_pipeline.fetch_sources && uv run python -m trainer_pipeline.lessons
uv run python lesson_specs/lasker_pin.py                                   # regenerate one lesson from its spec
uv run python -m trainer_pipeline.build_puzzle_pack --version YYYY.MM.DD   # ~30 min, needs data/raw/lichess_db_puzzle.csv.zst
uv run python -m trainer_pipeline.kpk                                      # exact K+P v K table, 12 s

# opening frequencies (streams ~1.5 GB, stores only counts), then engine evidence (~30 min)
curl -sL -r 0-1499999999 https://database.lichess.org/standard/lichess_db_standard_rated_2026-10.pgn.zst \
  | zstd -dc 2>/dev/null | uv run python -m trainer_pipeline.opening_stats --month 2026-10 --bytes 1500000000
uv run python -m trainer_pipeline.opening_evals --workers 5

# own games: the app fetches and analyses them itself. Optional deeper analysis on the Mac:
uv run python -m trainer_pipeline.fetch_chesscom --player YOUR_USERNAME
uv run python -m trainer_pipeline.games --player YOUR_USERNAME ../data/my-games/*.pgn
# and import data/analysis/my-games.json in the app under Progress -> Your games

# publish the built app to the gh-pages branch (GitHub Pages)
cd .. && scripts/deploy-pages.sh YOUR_GITHUB_LOGIN        # DRY_RUN=1 builds the bundle only
# optional, git-ignored: data/deploy.env with CHESSCOM_USERNAME=<handle> makes the published build fetch that player by default
```
