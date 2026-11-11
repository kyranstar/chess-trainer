# Project state

Updated: 2026-11-10 (fifth round: one-button practice, outside reviewer's third pass)
Branch: `main` (same as `build/trainer`). Commit: see `git log -1`; this file is committed with the work it describes.
Status: **M0 done. M1–M4 built; M5 started. Published: source at https://github.com/kyranstar/chess-trainer (public, `main`), app at https://kyranstar.github.io/chess-trainer/ (`gh-pages`). Second round: games and ratings arrive by themselves and are analysed on the device; five audits and two passes by an outside reviewer were worked through (ADR-026 to ADR-033). Third round (ADR-034, owner decisions): the product is phone only, must work offline on the subway, the session is 5 / 8 / 11 / 6 with practice from the owner's own games, the curriculum is reordered around piece safety, the Mac game route and the 30-day projection are gone. Fourth round (ADR-036): the owner found a question that changed before he could answer; four independent reviews of everything written since the audits followed and their findings were fixed (sync losing games at month end, wrong grading of own-game answers in decided games, double taps acting on the next screen, a check lost on reload, lessons contradicting their book, and more). Not done: anything on the physical iPhone, which needs the owner's hands.** M6 (sync) is dropped.

## What works today (user-visible)

- **Today**: study/play suggestion with its reason; a 30-minute plan (also 10/20/45/60) as four numbered blocks (review 5, learn 8, practice 11, test 6) with the reason for each; one-tap start and resume; a clock per block; review hard-capped; new learning always reserved when a concept is ready; summary built from recorded attempts. A session in use at midnight keeps running. Ending the day asks once. Games actually played (fetched from Chess.com) count as play days.
- **Games and ratings arrive by themselves** (ADR-026): with a Chess.com username set (the published build carries the owner's, so the phone needs no setup), the app reads the public ratings and game archives when it is opened or brought to the front (at most every three hours, or on "Check Chess.com now"), and analyses new games on the device with a built-in engine while the app is visible. Nothing is sent anywhere else. Offline, rate-limited, unknown-player and error states are shown; the last good data stays.
- **"Is it working?"** (top of Progress, ADR-027/032): rapid rating; the share of rated rapid games with an avoidable loss of material or allowed mate in the first 20 moves (last 20 games against the 20 before, with counts, range, all such moves per decision, the engine setting, and games still waiting to be measured); and results on questions from your own games.
- **Questions from your own games** (ADR-028/032): "is this move safe?" and "is there something here?", half of them controls where the honest answer is no. In the practice block they alternate with new positions on the day's concept and each answer is followed by the engine's line; in the test block they alternate with mixed puzzles and nothing is announced; they are also under Practice. Hits and false alarms are reported separately.
- **Just practise** (Today, and the top of Practice; ADR-037): one button, no plan. The app mixes what is due again, questions from your own games, your own missed moves and unseen positions on the least-tested concept, without saying which is coming, for as long as you like.
- **Baseline**: self-paced sampler; readings are only "untested", "provisional" or "pre-test to skip". The last position is always finished before the result screen appears.
- **Play days**: warm-up review, one 10+5 game on your own site, then a written reflection.
- **Learn**: 29 concepts in prerequisite order with stage and evidence. Sixteen lessons on the device, verbatim from Edward Lasker (1918) and Capablanca (1921), interactive and resumable, re-cut after a review that read them as a learner; the first seven concepts all have one, and lessons stored on the phone are taught before concepts that only have links, online or not. In a lesson example a sound move that is not the text's is not faulted and never recorded as a miss, and the text's move is still asked (ADR-036). Linked lessons on Lichess Practice, Chess.com and Chessreps with an explicit "I finished the lesson" step. Checks (5 unseen, no hints, 4 to pass, not skippable) are given in a later day's session, do not name their theme while running, and are asked again after 21 days; a stale or failed re-check is labelled (ADR-029). The check on a concept's page can still be taken at any time. Order (revision 4): piece safety, counting, threat scan, mate in one, opening principles, double attack, pin, defence first; pawn and rook endings and the Caro-Kann later.
- **Practice**: review queue (FSRS; due means due today) covering missed puzzles, lesson examples, repertoire moves, own-game positions and endgame starts; unseen positions by concept; own-game questions; tactics from Italian and Caro-Kann games; endgame positions; three-move calculation. After a wrong puzzle move the built-in engine's reply can be shown on request.
- **Exact endgames**: king and pawn against king against perfect play from 480 starts, judged by a complete table computed here. Underpromotion and a stalemating or hanging queen are scored as the draws they are.
- **Opening repertoire**: record the move you play in each position, most frequently reached first, weighted by real Lichess move frequencies in a chosen rating band; engine evidence per move; recall on the review schedule (a changed move starts as a new item).
- **Own games** (Progress): rating per time control (rated games only); major errors per 100 decisions with range and engine setting; missed chances led by those with one clearly best move, each counted once; errors when short of time, compared only on undecided positions; every number opens its positions; missed moves with one clearly best answer become drills.
- **Progress**: unseen puzzle accuracy with n and range, per-concept table with "untested", retention by gap with the scheduler's forecast, exact endgame technique, curriculum coverage, opening preparedness, logged games, practice-difficulty estimate, backup/restore (now including preferences), storage-protection status, installed content and licences.
- **Offline (the subway case)**: after one online visit the app shell, lessons, 8,219 puzzles, the opening book and the engine are on the device. With no network a whole session works: stored games and their numbers, on-device lessons, own-game questions with feedback, puzzles, the engine's reply to a wrong move, review, backup. Only two things need a connection: fetching new games (asking for a refresh says plainly that it is offline) and opening a linked lesson.

## What does not exist yet (do not describe as done)

- **Nothing has been tested on the physical iPhone**: Home Screen install, touch on the board, backup to Files, and the first real fetch and on-device analysis of the owner's games (about 90 games; expect well over half an hour of the app being open in total, resumable). On the iPhone: open https://kyranstar.github.io/chess-trainer/ in Safari, Share → Add to Home Screen, open it once online, then Progress → Your data → Check this device.
- **The headline comparison needs 40 measured rated rapid games** before it shows "last 20 against the 20 before"; until then it shows the overall share and how many games are waiting.
- **The exercise the outside reviewer calls the biggest missing piece is not built**: choose a move in an ordinary position, name a reply you must reckon with, optionally revise. Own-game questions so far judge a move that is shown; they do not yet train checking one's own intended move. Nor are checks that test the operation itself (which piece can be captured, the net of an exchange) built (ADR-038, last bullet).
- Exact endgames cover king and pawn against king only. No conversion play-outs from won positions. No Lichess-study import. No sync (dropped, ADR-034); a backup file is the only copy outside the phone.
- 13 of 29 concepts have an on-device lesson (two of the lessons, on the passed pawn and on exchanging when ahead, now only show the book's line and ask nothing); the rest only have links, which cannot be opened underground (the plan says so and teaches the next on-device lesson instead); 2 have no lesson at all; 7 have no independent check. The Capablanca lessons are in descriptive notation as printed.
- Opening data is deep (14 plies) only after 1.e4 e5 and 1.e4 c6.
- React components have no unit tests; they are covered only by the browser tests. "Old backup file" tests recompute checksums with current code rather than using frozen files.
- Not addressed from the UX audit: a confirm-before-judging option for moves (squares are 37 px in a Safari tab, 45 px installed), the long Progress page with backup at the bottom, the repertoire builder's scrolling, VoiceOver access to the board, small touch targets on back links and chips.

## Verification evidence (run 2026-11-10, Node 22.23.1, macOS)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 24 files, 267 tests passed. This round added the outside reviewer's counterexamples (unsettled lines, promotion awaiting capture, material won while being mated, sacrifices in decided games, a control proved wrong, coin toss against the turn schedule), fixed comparison groups, stale-month sync, review admission and graduation, and the one-button policy |
| `cd pipeline && uv run pytest -q tests` | 78 passed |
| `uv run python -m trainer_pipeline.lessons` | all 16 lessons `ok` (run by the lessons reviewer after the re-cut); 50 asked moves, 12 with recorded sound alternatives |
| `npm run build` | built; service worker precaches 27 entries (7.3 MB, including the 1.9 MB engine) |
| `npm run e2e` | 47 passed, 2 skipped by design on the final run |
| `npm run e2e:churn` | 24 passed (iPhone 14 WebKit, about 4 to 7 minutes): the reviewer's harness, every flow driven while games are fetched and analysed, block clocks run out and midnight passes |
| `npm run check` (all of the above in one command) | exit 0 on the final run |
| Red-then-green | the tap-accuracy and promotion-cancel browser tests were run against a build with the two fixes removed and failed there |
| Live cross-origin check (earlier this round) | `api.chess.com` answered a browser request from the published origin with status 200 in WebKit and Chromium |
| New lessons at iPhone size (screenshots of three lessons, looked at by the agent, not by the owner) | text, boards and prompts render; Capablanca's notation is shown as printed |
| Published site, fresh iPhone-size WebKit profile, no setup (`npx playwright test --config data/playwright.smoke.config.ts`, git-ignored) | new build served; 11 requests to Chess.com's public API, all 200; 87 games stored; current ratings shown (rapid 457, blitz 423, daily 772); on-device analysis started by itself and finished its first game within seconds; headline reports 41 rapid games waiting to be measured |

Not re-verified since the first round: the iOS simulator run. Offline behaviour is tested in Chromium only (Playwright cannot drive WebKit's service worker); real Mobile Safari offline was last checked in the simulator in the first round. The full browser suite is no longer run against the published site: that build carries a default username, so every test would query Chess.com for real. Use the smoke config above for the live site and `npm run e2e` (mocked API) for everything else.

Bugs found by the audits and fixed this round: review of a lesson example could never be completed; a session running at midnight vanished and wrote an empty row; cancelling a promotion froze the board; a correct tap could be scored as a different, wrong move after the board moved on screen; the five check positions were re-drawn after every answer; "Show solution" during the reply animation crashed; the baseline cut off its last position; "Check Chess.com now" was ignored while a background round ran; a changed repertoire move kept the old move's schedule; knight and bishop promotions in the pawn ending were scored as wins.

## Open decisions for the owner

1. **Lesson review**: the 16 on-device lessons are marked `ownerReview: pending` until you have read them. A reviewer agent read all of them step by step and they were re-cut from its findings; no person has.
2. **The outside reviewer's third pass is waiting**: ChatGPT reported the account out of Work usage until 6:38 PM on 2026-11-10. The question (a review of the pushed code, the grading rules for the next exercise, and what to do when no on-device lesson exists) is already in that chat; it needs either the limit to reset or your "Reset usage".

Settled on 2026-11-10: US jurisdiction (ADR-022); public repository (ADR-025); zero manual steps for games and ratings (ADR-026); phone only, offline on the subway, 30 minutes not a hard ceiling, split and curriculum order free to change, no confirm step, no 30-day projection (ADR-034).

## Known issues and risks

- The first phone open after this update measures all games again (analysis v4) and rebuilds the review queue under the new policy; both happen by themselves.
- Left open from the fourth-round reviews (ADR-036, last bullet): a reload in the practice block shows a different question; only the first lesson of a concept is offered by the session; the king-and-pawn check does not survive a reload; most concept checks measure general puzzle strength more than the lesson; a lesson's text and its diagram are on separate screens.
- Reports of the four reviews are not in the repository (they were written to a scratch folder); their reproductions that matter are now tests.

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
3. On-device lessons for the 16 concepts that still only have links (defence, back rank, skewer, forcing moves, discovered attack and later). Lasker and Capablanca are largely used up for what can be verified mechanically; this needs another cleared source or Capablanca's diagrams from a scan.
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

# own games: the app fetches and analyses them itself; there is nothing to run here

# publish the built app to the gh-pages branch (GitHub Pages)
cd .. && scripts/deploy-pages.sh YOUR_GITHUB_LOGIN        # DRY_RUN=1 builds the bundle only
# optional, git-ignored: data/deploy.env with CHESSCOM_USERNAME=<handle> makes the published build fetch that player by default
```
