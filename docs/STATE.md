# Project state

Updated: 2026-11-10
Branch: `build/trainer` (`main` holds only the starter kit). Commit: see `git log -1`; this file is committed with the work it describes.
Status: **M0 done. M1–M4 built and verified in automated browsers and on fixtures. Not yet verified: a real iPhone, and the owner's real games.** M5 (tablebase endgames, calculation depth, scheduler evaluation) and M6 (sync) not started.

## What works today (user-visible)

- **Today**: study/play suggestion with its reason; a 30-minute plan (also 10/20/45/60) as four numbered blocks with the reason for each; one-tap start and resume; a clock per block; review hard-capped; new learning always reserved when a concept is ready; an honest notice when the next concept needs a connection; summary built from recorded attempts.
- **Baseline**: self-paced sampler (2 unseen positions for each of 15 early concepts, no hints); derived from attempts so it resumes anywhere; readings are only "untested", "provisional" or "pre-test to skip".
- **Play days**: warm-up review, one 10+5 game on your own site, then a written reflection; logged games appear on Progress and in backups.
- **Learn**: 29 concepts in prerequisite order with stage and evidence. Five lessons on the device, verbatim from Edward Lasker (double attack, pin, opposition, extra passed pawn, exchanging when ahead), interactive and resumable. Linked lessons on Lichess Practice, Chess.com and Chessreps with an explicit "I finished the lesson" step. "Check understanding" (5 unseen, no hints, 4 to pass) doubles as a pre-test. A 30-day projection, labelled as a projection.
- **Practice**: review queue (FSRS) covering missed puzzles, lesson examples, repertoire moves and own-game positions; unseen positions by concept; tactics from Italian and Caro-Kann games; endgame positions; three-move calculation.
- **Opening repertoire** (Practice): record the move you play in each position, always the most frequently reached unanswered position first, weighted by what players in a chosen Lichess rating band actually play; engine evidence for each chosen move (sound / weaker with numbers / unknown); recall on the review schedule in a disclosed recall mode; import and export of your own PGN; coverage table by move number.
- **Own games** (Progress → Your data): import the file produced by the Mac pipeline from PGNs you downloaded. Rating after each game per time control with sparkline; major errors per 100 decisions with range, per game, per time control and by concrete label; missed tactical chances out of chances available; errors when short of time (only with 30 decisions per group); every number opens its positions; missed moves with one clearly best answer become drills.
- **Progress**: also unseen puzzle accuracy with n and range, per-concept table with "untested", retention by gap, curriculum coverage, opening preparedness, logged games, practice-difficulty estimate, backup/restore, storage-protection status, installed content and licences.
- **Offline**: after one online visit the app shell, lessons, 8,219 puzzles and the opening book are on the device; everything works with no network except opening linked lessons.

## What does not exist yet (do not describe as done)

- **Your real games have not been analysed.** The game features were built and tested on a five-game fixture written in Chess.com's export format. Your username and PGN files are needed (commands below).
- **Not run on a real iPhone**: Home Screen install, airplane-mode cold start, backup export to Files, storage persistence. Only Playwright WebKit at iPhone 14 size and desktop Chromium (including offline) were used.
- No tablebase-verified endgames, conversion play-outs or deeper calculation training (M5). No training-to-game transfer metric. No Lichess-study import. No sync (M6).
- 5 of 29 concepts have an offline human-written lesson; 2 have no lesson at all; 7 have no independent check.
- Opening data is deep (14 plies) only after 1.e4 e5 and 1.e4 c6 and 4 plies elsewhere; it is the start of October 2026, not a random sample; bands are Lichess ratings, not Chess.com ratings. At the lowest bands 1...d5 is more common than 1...c6, so extending the data to the Scandinavian is the obvious next pipeline run.
- Concept evidence uses Lichess theme tags as a proxy; a position counts for every concept whose tag it carries, and some proxies are loose (any pawn endgame counts toward "the opposition").

## Verification evidence (run 2026-11-10, Node 22.23.1, macOS)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 16 files, 140 tests passed: rules; puzzle run; replay of all 8,219 shipped puzzles; FSRS review; DB; backup/restore incl. corruption cases; upgrades from frozen schema-1, -2 and -3 databases and backup files; pack install; practice metrics; curriculum; baseline and projection; selection; study and play planners; content; repertoire walk, evidence and PGN round trip; game import and game metrics |
| `cd pipeline && uv run pytest -q` | 31 passed: Lichess CSV semantics; engine uniqueness gate; 5 lessons verbatim/diagram/legal and tamper rejection; opening-frequency extraction and transposition merge; engine evidence; game import (time class, clocks, idempotence) and analysis labels |
| `uv run python -m trainer_pipeline.lessons` | all 5 lessons `ok`; evidence in `content/verification/lessons.json`. The gate demoted one example (Lasker's 1.P-d4 in Diagram 32) from asked to shown. |
| `uv run python -m trainer_pipeline.build_puzzle_pack --version 2026.11.10` | 6,193,530 rows → 12,139 candidates → 11,670 passed the engine gate → 8,219 shipped (2.18 MB), 1712 s |
| opening book (`opening_stats` then `opening_evals`) | 4,588,118 games read from the first 1.5 GB of the October 2026 dump, 2,875,117 used; 4,729 positions and 24,294 moves kept (≥150 games per position, ≥15 per move); every move evaluated by Stockfish 19 at 80k nodes in 1834 s; 2.16 MB |
| `trainer_pipeline.games` on the fixture PGN | 5 games, 20 decisions, 3 major errors, 3 opportunities of which 2 missed, 1 drill |
| `npm run build` | built; service worker precaches 25 entries (5.1 MB) |
| `npm run e2e` | 25 passed, 1 skipped by design (iPhone 14 WebKit 11, desktop Chromium 14); the suite also passed twice in a row |

End-to-end coverage: a full study session with a linked lesson through to dashboard drill-down and restart; a local lesson played move by move and resumed; hint ⇒ assisted; iPhone-size layout; backup on one profile restored on another, damaged file rejected; offline cold start, practice, lesson, repertoire and restart with no third-party requests; baseline pause/resume; a play day through to Progress and backup; the 30-day projection; repertoire record → evidence → coverage → recall → backup; own-PGN import with conflicts and export; analysed-games import, metrics, drill-down and a drill from an own game.

Bugs found by these tests and fixed: check result vanished on passing; tab bar covered the board (tabs now hide during board tasks); repertoire screen crashed after saving a move (stale choice applied to the next position). A screen-level error boundary now shows the error instead of a blank page.

## Open decisions for the owner

1. **Lasker text is US-only public domain** (author died 1981). If you are outside the US, say so and those five lessons are removed (Capablanca is cleared more widely but has no lessons built yet). ADR-009.
2. **Chess.com lesson links** were first collected by an automated audit; the User Agreement §4(D) restricts automated/AI access for building "educational tools". Keep them, or re-collect by hand in a browser? ADR-014.
3. **Own games**: manual PGN download only (built), or also a serial PubAPI script? ADR-014. Either way I need your Chess.com username to run the analysis.
4. **Lesson review**: the five local lessons are marked `ownerReview: pending` until you have read them.
5. **Opponent rating band** for opening frequencies defaults to Lichess 800–999; change it on the repertoire screen. There is no verified mapping from Chess.com rapid 457 to a Lichess band.

## Known issues and risks

- A queued review item whose content is gone (retired puzzle, deleted repertoire move, re-analysed game) shows a "no longer available" card and stays due.
- `SOUND_MARGIN` of 8 expected-score points is lenient near equality (2.Qh5 after 1.e4 e5 scores 46 against 53 and is called sound, with both numbers shown).
- The opening book is 2.2 MB of JSON parsed on first use of the repertoire or Progress screens.
- Exported repertoire PGN writes one game per recorded move; a recorded path that disagrees with the current repertoire re-imports as a reported conflict.
- Time in a block is counted only while the page is visible; lessons and the game block are never cut off by the clock.
- The bundle is one 560 kB script (about 170 kB gzip), deliberately unsplit so the whole app precaches.

## Next slice

1. Owner actions: run on the iPhone (install, airplane-mode restart, backup to Files) and record the result here; answer the open decisions; put PGN files in `data/my-games/` and run the games pipeline with the real username.
2. M5: tablebase-verified king-and-pawn and basic-mate drills with play-out against best defence (replaces the loose pawn-endgame proxy for "the opposition"); exchange-counting drills generated and checked by engine; training-to-game transfer metric once real games exist on both sides of a drill date.
3. Extend the opening book to 1.e4 d5 and the owner's eventual Black repertoire (`ROOTS` in `opening_stats.py`), then rerun `opening_stats` and `opening_evals`.
4. More offline lessons from the two cleared books; a "this link is broken" control.

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

# opening frequencies (streams ~1.5 GB, stores only counts), then engine evidence (~30 min)
curl -sL -r 0-1499999999 https://database.lichess.org/standard/lichess_db_standard_rated_2026-10.pgn.zst \
  | zstd -dc 2>/dev/null | uv run python -m trainer_pipeline.opening_stats --month 2026-10 --bytes 1500000000
uv run python -m trainer_pipeline.opening_evals --workers 5

# own games: download PGNs from Chess.com by hand into data/my-games/, then
uv run python -m trainer_pipeline.games --player YOUR_USERNAME ../data/my-games/*.pgn
# and import data/analysis/my-games.json in the app under Progress -> Your data
```
