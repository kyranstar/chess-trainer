# Project state

Updated: 2026-11-10
Branch: `build/trainer` (`main` holds only the starter kit). Commit: see `git log -1`; this file is committed with the work it describes.
Status: **M0 done. M1 built and verified in automated browsers; its real-iPhone gate is not yet run.**

## What works today (user-visible)

- **Today**: a 30-minute plan (also 10/20/45/60) shown as four numbered blocks with the reason for each; one-tap start and resume; a clock per block; review hard-capped; new learning always reserved when a concept is ready; an honest notice when the next concept needs a connection; end-of-session summary built from recorded attempts.
- **Learn**: 29 concepts in prerequisite order with stage (not started / started / studied / demonstrated) and evidence (untested / k of n with range). One lesson stored on the device (Edward Lasker on the double attack, verbatim, 8 parts with interactive moves, resumable). Linked lessons on Lichess Practice, Chess.com and Chessreps with an explicit "I finished the lesson" step; opening a link never counts. "Check understanding" (5 unseen positions, no hints, 4 to pass) also works as a pre-test.
- **Practice**: review queue of missed positions (FSRS), unseen positions by concept, tactics from Italian Game and Caro-Kann games, endgame positions, three-move calculation. Hints allowed and recorded as assisted.
- **Progress**: unseen accuracy with n and 95% range, per-concept table with "untested", retention by gap, curriculum coverage, the starting ratings as entered, practice-difficulty estimate; every number drills down to its attempts and each attempt to its position. Backup download/share and restore; storage-protection status; installed pack details; sources and licences.
- **Offline**: after one online visit the app shell, the lesson and 8,219 puzzles are on the device; everything above works with no network except opening linked lessons.

## What does not exist yet (do not describe as done)

- No diagnostic first-run flow beyond the mixed test sampling untested concepts first (M2).
- No play-day/rapid-game session type (M2/M4). No opening repertoire trainer or move-frequency data (M3). No game import, engine analysis of own games, rating trend, or game-error metrics (M4). No tablebase endgames or conversion play-outs (M5). No sync (M6).
- Only 1 of 29 concepts has an offline human-written lesson; 2 have no lesson at all; 7 have no independent check. See `docs/CONTENT_INVENTORY.md` §2–3.
- Not run on a real iPhone: Home Screen install, airplane-mode cold start, backup export to Files, storage persistence. Only Playwright WebKit at iPhone 14 size and desktop Chromium (including offline) were used.
- No schema migration has happened yet, so there is no migration test against a previous schema; the v1 schema is frozen by a test so the first change must add one.

## Verification evidence (run 2026-11-10, Node 22.23.1, macOS)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 11 files, 90 tests passed (rules, puzzle run, shipped pack replay of all 8,219 puzzles, FSRS review, DB, backup/restore incl. 5 corruption cases, pack install, metrics, curriculum, selection, session planner, content) |
| `cd pipeline && uv run pytest -q` | 13 passed (Lichess CSV semantics, engine uniqueness, lesson verbatim/diagram/legality and tamper rejection) |
| `uv run python -m trainer_pipeline.lessons` | `ok lasker-double-attack`; Stockfish 19 agrees with all 6 lesson moves (`content/verification/lessons.json`) |
| `uv run python -m trainer_pipeline.build_puzzle_pack --version 2026.11.10` | 6,193,530 rows → 12,139 candidates → 11,670 passed engine gate → 8,219 shipped (2.18 MB), 1712 s |
| `npm run build` | built; service worker precaches 24 entries (2.9 MB) |
| `npm run e2e` | 12 passed (iPhone 14 WebKit ×5, desktop Chromium ×7); whole suite also passed 3 consecutive repeats |

The e2e tests cover: full daily session with a linked lesson (link opened ≠ done → mark done → apply → check passes → a deliberate miss → summary → dashboard → drill-down → restart); the local lesson played move by move and resumed after reload; hint ⇒ assisted; board fits an iPhone-size screen with 44 px tab targets; backup on one profile restored on a clean one, damaged file rejected with data untouched, second restore adds nothing; offline cold reload, offline practice and lesson, offline restart, no third-party requests; no non-GET or cross-origin request during use.

Bugs found by these tests and fixed: the check result screen disappeared on passing; the fixed tab bar covered the bottom of the board (tabs are now hidden while a board task is on screen).

## Open decisions for the owner

1. **Lasker text is US-only public domain** (author died 1981). If you are outside the US, say so and the lesson is removed (Capablanca is cleared more widely). ADR-009.
2. **Chess.com lesson links** were first collected by an automated audit; User Agreement §4(D) restricts automated/AI access for building "educational tools". Keep them, or re-collect by hand in a browser? ADR-014.
3. **Own games (M4)**: manual PGN download only (default), or also a serial PubAPI script? ADR-014.
4. **Lesson review**: the one local lesson is marked `ownerReview: pending` until you have read it.

## Known issues and risks

- `ReviewRunner` shows a "retired" card for a queued position that is no longer in the pack; the item stays due.
- Linked-lesson URLs for Lichess Practice use auto-generated slugs; `fallbackUrl` (study id) is stored but not yet offered in the UI.
- Practice-difficulty estimate moves fast on the first few positions by design (K=160 decaying).
- Time in a block is counted only while the page is visible; a lesson is never cut off by the clock.
- Bundle is one 520 kB script (159 kB gzip), deliberately not split so the whole app precaches.

## Next slice (M2, in order)

1. First-run diagnostic: a short self-paced sampler across the baseline concepts with a visible "untested → provisional" fill-in, and pre-test shortcuts; test that sparse evidence shows Untested.
2. More local lessons from the two cleared books (pin, discovered check, opposition with tablebase-checked lines, basic mates from Capablanca once diagrams are reconstructed), each through the validator.
3. Play-day session type (rapid game + review reflection) and weekly new-learning accounting.
4. Offer `fallbackUrl`, and a "this link is broken" control that records it.
5. First schema change with a migration test against a stored v1 database.

## Commands

```sh
nvm use                      # Node 22.23.1 (the machine default 21.x cannot run Vite 8)
npm install
npm run dev                  # http://localhost:5173
npm run check                # typecheck + unit + build + e2e
cd pipeline && uv sync && uv run pytest -q
uv run python -m trainer_pipeline.fetch_sources && uv run python -m trainer_pipeline.lessons
uv run python -m trainer_pipeline.build_puzzle_pack --version YYYY.MM.DD   # ~25 min, needs data/raw/lichess_db_puzzle.csv.zst
```
