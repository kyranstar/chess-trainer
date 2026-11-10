# Decision log

## ADR-001 Course-first, not AI-first — accepted 2026-11-10
Use established human-written courses as the primary means of teaching new concepts. There is no generative LLM required or trusted as a correctness/education authority. Engine analysis supports concrete evaluations only.

## ADR-002 Protected-course link strategy — accepted 2026-11-10
Chess.com and Chessreps memberships provide access within the providers' interfaces. Without permission or authorized exports, link out and track completion/independent checks; do not scrape or mirror copyrighted courses. The cost is weaker integrated/offline lessons; mitigate with rights-cleared materials and explicit UX.

## ADR-003 Offline-first data, delayed sync — accepted 2026-11-10
Installable iPhone PWA with IndexedDB local progress; Mac native batch engine. Optional static hosting may deliver app shell and rights-cleared packs but cannot receive personal progress in phase 1. Explicit backup/restore is non-negotiable.

## ADR-004 Measurable performance — accepted 2026-11-10
Display separate ratings, unseen practice, reproducible game error metrics, concept mastery and cross-context transfer with denominators and source drill-down. Don't combine them into an arbitrary skill number.

## ADR-005 Deterministic scheduler first — accepted 2026-11-10
Use prerequisites, transparent priorities and memory scheduler; only introduce statistical personalization when sufficient real evidence exists, preserving unknown/uncertain states.

## ADR-006 Scope limited to one learner — accepted 2026-11-10
No login required initially, no payment system, no multiplayer/community, no shared cloud infrastructure. Private, simple, maintainable code wins over extensibility theater.

## ADR-007 Lichess board and rules libraries; project licensed GPL-3.0-or-later — accepted 2026-11-10
`@lichess-org/chessground` 10.5.0 (touch board; the unscoped `chessground` package is deprecated) and `chessops` 0.15.1 (single authoritative rules library: legality, FEN, SAN, castling, en passant, promotion, mate). Both are GPL-3.0-or-later, so this repository is GPL-3.0-or-later and any public hosting must offer the source. Alternative considered: `react-chessboard` + `chess.js` (MIT/BSD), rejected because chessground's touch handling and chessops' Lichess-compatible semantics matter more to a single-user app than licence permissiveness.

## ADR-008 Toolchain pins — accepted 2026-11-10
Node 22.23.1 (`.nvmrc`; the machine default 21.x cannot run Vite 8), React 19.3.1, Vite 8.3.7, TypeScript 7.0.2, Vitest 5.1.0, Playwright 1.65.0, Dexie 4.4.7, vite-plugin-pwa 2.0.0. `ts-fsrs` is pinned at 5.4.2, not 6.0.0, because 6.x requires Node 24 for tests; 5.4.2 already implements FSRS-6. Python 3.13 via `uv`, python-chess 1.11.2, native Stockfish 19.

## ADR-009 Local lessons are verbatim public-domain excerpts, proven mechanically — accepted 2026-11-10
Offline lessons use only text that is public domain (Edward Lasker 1918, US only; Capablanca 1921) or otherwise cleared. The app stores unaltered excerpts; `pipeline/trainer_pipeline/lessons.py` fails the build unless each paragraph is a substring of the checksummed source file, each diagram matches the book, and each move is legal and within 5 expected-score points of Stockfish's first choice. Interface prompts around a lesson are limited to facts the rules library can state ("White to move"). Cost: 1918 prose and notation, and thin coverage (see `docs/CONTENT_INVENTORY.md` §2). Excerpt selection was done by the build agent, so every lesson carries `ownerReview: pending` and the UI says so until the owner approves it. The Lasker text is cleared for the US only; a non-US owner must remove it.

## ADR-010 Puzzle answer policy and pack gate — accepted 2026-11-10
A puzzle answer is correct if it is the source move or any move that delivers checkmate (Lichess's documented rule). Everything else is scored as a miss. To make that safe, a puzzle is only shipped if Stockfish 19 (150k nodes, MultiPV 2, 1 thread) agrees at every solver move that the source move is the first choice and at least 20 expected-score points better than the second. Puzzles failing the gate are dropped, not shipped as "ambiguous". The UI therefore says "not the move" rather than "bad move", and cites the engine check.

## ADR-011 Evidence model: unseen first tries only — accepted 2026-11-10
An attempt's outcome is decided once, at the first of: wrong move (fail), hint or revealed solution (assisted), clean solve (success), or leaving before moving (skipped). `fresh` (first-ever showing) and `scheduledReview` are stamped at write time. Unseen accuracy counts fresh puzzle attempts only; assisted counts as not solved; skips are excluded and reported. Rates are shown as k of n with a 95% Wilson interval and are "provisional" below n=20. Concepts with no observations are "untested". The practice-difficulty estimate is an Elo-style number on the Lichess puzzle scale used only for selection.

## ADR-012 Concept stages and the check rubric — accepted 2026-11-10
`new → started → taught → demonstrated`, derived from lesson events. "Taught" is a finished local lesson or a self-reported linked lesson; opening a link is recorded but proves nothing. "Demonstrated" requires check-v1: 5 never-seen puzzles on the concept, Lichess rating 900–1299, no hints, 4 solved first try. Passing without a lesson is a pre-test skip. Prerequisites are advisory in the UI (nothing is locked) but the planner follows them. A fixed band, not the learner's own level, keeps "demonstrated" meaning the same thing over time.

## ADR-013 Review scheduling — accepted 2026-11-10
FSRS via ts-fsrs with fuzz off, short-term steps off, retention target 0.9 and a 365-day cap. Missed puzzles and all lesson examples enter the queue; success is Good, a miss or hint is Again. Review state is a pure fold over the immutable attempt log (`rebuildReviewStates`) and carries the scheduler version, so a scheduler change never rewrites history.

## ADR-014 Chess.com access posture — accepted 2026-11-10, two items awaiting the owner
The app never requests `www.chess.com`. Linked lessons are stored as title, author, level and URL only. Own-game import (M4) defaults to manually downloaded PGN. Open for the owner: (a) whether to keep the lesson links first collected by the automated audit or re-collect them by hand, given User Agreement §4(D); (b) whether to add a serial PubAPI fetch script for own games.

## ADR-015 Baseline is a sampler, not a score — accepted 2026-11-10
The first-run diagnostic shows two unseen positions for each of the 15 early concepts that can be assessed with positions (prerequisites ignored), choosing the least-sampled concept next. Its progress is derived from the attempt log (any unseen attempt counts), so it has no state of its own and resumes anywhere. It can only produce "untested", "provisional" or "pre-test to skip"; the 5-position check decides demonstration. A position counts for every concept whose theme tag it carries.

## ADR-016 Play days and the game journal (schema 2) — accepted 2026-11-10
A play day replaces the four study blocks with warm-up review, one 10+5 game on the learner's own site, and a written reflection. Suggestion rule v1: play after two study sessions since the last play day, never more than two play days in seven; always overridable. The game is logged by hand in `gameJournal` (schema 2: result, colour, own-words notes, optional rating and link; the link is stored and never fetched). Backups are schema 2 and still restore schema-1 files. The app writes no chess advice on the play screen. The projection in Learn assumes Wednesdays and Saturdays; real suggestions follow the rule above.

## ADR-017 An engine disagreement demotes a lesson example from "asked" to "shown" — accepted 2026-11-10
When the validator finds the author's move more than 5 expected-score points below the engine's first choice, the learner is not asked to find it; the position and the author's explanation are still shown verbatim. The text is never edited to agree with the engine, and the engine's preference is not presented as instruction.

## ADR-018 Opening repertoire: the learner's own moves, ordered by real frequency (schema 3) — accepted 2026-11-10
Chessreps has no export and its lines may not be copied, so the repertoire trainer stores only what the learner enters: for a position where it is their move, the move they have chosen (`repertoire` table, keyed by side + `positionKey`, so transpositions are one decision). The app contributes evidence, not choices:
- **Frequency**: `public/packs/openings-lichess.json`, built by `pipeline/trainer_pipeline/opening_stats.py` from the first 1.5 GB of the Lichess October 2026 rated-games dump (CC0; the explorer API needs a token). Rated blitz/rapid/classical only, each move banded by the mover's rating, full tree to 4 plies and to 14 plies under 1.e4 e5 and 1.e4 c6. The learner picks the opponent rating band; the next position to record is always the unanswered one reached most often.
- **Engine**: `opening_evals.py` stores Stockfish's expected score after each listed move and for its own first choice. A chosen move within 8 points is "sound", further is "weaker" (shown with both numbers and the first choice's name; the learner may keep it), and a move without data is "unknown", never "bad".
- **Recall** is a disclosed recall mode on FSRS: only the chosen move counts as recalled; a different move is recorded with `altVerdict` (sound / weaker / unknown) and reported separately on Progress, not as a blunder.
- **Preparedness metric**: share of games (in the chosen band) with a recorded answer at the learner's k-th move, with the shares that have no answer or fall outside the data shown beside it. It measures what is recorded, not board performance.
Limits: the sample is the start of one month, not a random sample; data is deep only under two first-move families; Lichess rating bands are not Chess.com ratings.

## ADR-019 Own games: manual PGN in, Mac analysis, file import; conservative labels (schema 4) — accepted 2026-11-10
- **Import path**: the owner downloads PGN from Chess.com by hand; `pipeline/trainer_pipeline/games.py` parses it (side, result, ratings, time class from `TimeControl` using Chess.com's own boundaries, `%clk` clocks) and never contacts a chess site. Games are identified by a hash of the site's game link, so re-imports are idempotent. A PubAPI fetcher is not built (owner decision pending, ADR-014).
- **Analysis**: Stockfish 19, 200k nodes, MultiPV 2, one thread, only at the learner's own moves. Expected score is the Lichess win% sigmoid from the learner's side. Rules, all recorded in the file manifest: major error = loss >= 20 points; label "allows mate" (mate in <= 3 for the opponent) or "loses material" (>= 2 points within 5 half-moves of the engine's reply line), otherwise "unclassified"; tactical opportunity = the engine's best line mates or wins >= 2 points within 5 half-moves; missed when the move played gave up >= 10 points; a position becomes a personal drill only when the best move beats the second best by >= 20 points. No label states why a move was played.
- **Transfer to the phone**: one JSON file (`data/analysis/my-games.json`, git-ignored) imported under Progress, Your data. Private game data is never published to static hosting.
- **App**: `games` table (schema 4, in backups). Re-analysis with different engine settings replaces the stored analysis and is labelled by `analysisKey`; mixed settings are called out on the card. Metrics: rating after each game per time control; major errors per 100 analysed decisions with Wilson range, per game and per time control; missed chances out of chances available; errors under 10% of starting time versus otherwise, shown only with 30 decisions in each group. Unanalysed games are excluded from denominators, never counted as clean.
- **Drills**: own-game positions are recalled through the same FSRS queue (`exerciseKind: 'own-game'`); they are never counted as unseen puzzles.
Not built: training-to-game transfer metric (needs dated drill history against later games), PubAPI fetch, analysis of opponents' moves.

## ADR-020 Exact king-and-pawn endings from a table computed here — accepted 2026-11-10
`pipeline/trainer_pipeline/kpk.py` computes, by level-synchronous retrograde analysis with python-chess as the move generator, the result of every K+P v K position and the number of half-moves to a safe promotion with best play (`content/kpk.json`, 279 kB, bundled). It is validated against known theory (including Lasker's "only by playing K-e5"), the published count of 111,282 won positions for the pawn on files a–d, Stockfish on a random sample, and the property that best play shortens the distance by exactly one per half-move; the app-side probe is tested against the same properties. No Syzygy download or tablebase API is needed for this ending.
The app uses it for play-outs: "win it" against the longest defence and "hold it" against the most testing tries, from 480 start positions in which exactly one move keeps the result. Every learner move is judged by whether it changed the theoretical result, so feedback says "lets the win go" or "loses" as a fact and lists the moves that kept it; nothing is engine opinion. A win must be converted within 30 moves and a draw held for 10. Results feed a separate "Endgame technique, exact" metric and the review queue, never the puzzle metric.
Still open in M5: basic mates and rook endings (need larger tables or Syzygy), exchange-counting drills, deeper calculation training, the training-to-game transfer metric, and a controlled evaluation of scheduler changes.

## ADR-021 "The opposition" is checked by exact play-outs; scheduler forecast is compared with outcomes — accepted 2026-11-10
- `endgame.opposition` no longer uses puzzles tagged "pawn endgame" as its check or its evidence. Its check is check-kpk-v1: five unseen king-and-pawn starts (three to win, two to hold) against perfect play, no help, four must be kept correct on every move. Its evidence is first-time play-outs. `endgame.passed-pawn` still uses tagged puzzles.
- `reviewCalibration` replays the attempt log and, at each scheduled review, compares the recall probability FSRS predicted just before it with the outcome. The retention card shows forecast against observed with n. This is the baseline any later scheduler version must be replayed against on the same log before it replaces v1. Note from building it: after a first miss the earliest review is one day later, which FSRS itself forecasts at about 77%, below its 90% target for established items.

## ADR-022 Owner decisions of 2026-11-10: US jurisdiction, public API for own games — accepted
The owner confirmed they are in the United States (the Lasker excerpts stay), supplied their Chess.com account and asked for the work to be completed autonomously. Consequences:
- `pipeline/trainer_pipeline/fetch_chesscom.py` downloads the owner's own monthly PGN archives from Chess.com's Published-Data API: strictly serial, conditional (ETag), stops on 429, documented endpoints only, Mac only. The username is passed on the command line and is not stored in the repository. The app still never contacts chess.com. Manual PGN download remains supported.
- Chess.com lesson links stay as collected (ADR-014 item a); re-collecting by hand remains an option.
- Games against Chess.com's coach or bots (`Event "Play vs …"`) are untimed practice: they are left out of every game metric and counted in the import report.

## ADR-023 Game analysis v2: chances and labels measured on whole lines — accepted 2026-11-10
Running v1 on the owner's 87 real games showed two faults in the labels. v2 fixes them: a tactical chance needs the engine's best line to end at least two points up on the balance before the opponent's last move, so taking back a piece is not a chance; "loses material" means the line after the move played ends at least two points down on the balance before that move, so an even trade is not a loss; a new label "misses material" covers a major error where nothing is lost but the best line would have won at least two points more. Files carry `analysisVersion`; the app replaces a stored analysis when the version or engine settings differ.

## ADR-024 Hosting on GitHub Pages as a deploy-only repository; Device check — accepted 2026-11-10
The owner asked for the app to be put on their phone. `scripts/deploy-pages.sh` publishes `dist/` to a public, single-commit repository served by GitHub Pages, with `source.tar.gz` (a snapshot of the tracked source, to meet the GPL for a public copy), a `noindex` tag and commits under the owner's GitHub no-reply address. Never published: `data/` (raw downloads, the owner's games and analysis), git history, anything from the browser's storage. GitHub Pages serves every project of one account from one origin, so other Pages sites of the same account share browser storage with this app; that is acceptable for a single owner.
Installing to the Home Screen needs a tap on the phone and cannot be done remotely. To make the real-device gate checkable by the owner in one tap, Progress → Your data → "Check this device" runs the app's own storage, backup/restore, offline-cache, content-checksum, rules and endgame-table checks on the device with throwaway data.
iOS testing done here: real Mobile Safari in the iOS 27 simulator, opened by URL (WebDriver automation needs an admin-only switch): first load and pack install, all device checks, the in-app update notice, and a cold start with the server stopped. Not possible from here: touch input in the simulator and anything on the physical phone.

## ADR-025 Public source repository — accepted 2026-11-10
The owner asked for the project to be pushed to a public GitHub repository. Before pushing, tracked files and the whole git history were searched for account names, e-mail addresses, tokens, opponent names and machine paths (none found); `data/` (raw downloads, the owner's games and analysis) is git-ignored and was never committed. What is public by design: the owner's chess ratings in the profile documents and app, and the owner's usual commit identity. The built app is served by GitHub Pages from the `gh-pages` branch of the same repository (this replaces the separate deploy-only repository of ADR-024); `main` holds the source.
