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
