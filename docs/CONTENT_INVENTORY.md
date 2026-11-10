# Content inventory (M0 source and course feasibility audit)

Audit date: 2026-11-10. Detailed evidence, quotes and per-URL verification labels are in
`docs/audits/2026-11-10-*.md`. This file is the summary the product is built against.
Machine-readable form: `content/sources.json` (registry), `content/concepts.json`
(concept → lesson/link/assessment map), `content/lessons/` (local lessons),
`content/themes.json` (CC0 theme definitions).

How links were checked: an automated fetch read public pages once, without logging in.
`lichess.org` and `www.chess.com` both answer scripted requests with Cloudflare
challenges, so most lesson-level URLs were read off a fetched index page and **not opened
individually**. Each link in `content/concepts.json` carries a `verified` note saying which.
Nothing in this file should be read as "every link was clicked".

## 1. What may be stored in the app, and what may only be linked

| Source | Use in app | Basis | Offline? |
|---|---|---|---|
| Lichess puzzle database | **Bundled** (filtered pack) | "Database exports are released under the Creative Commons CC0 license" (database.lichess.org) | Yes |
| Lichess puzzle theme names and descriptions (English) | **Bundled** as concept definitions | `translation/source/puzzleTheme.xml` is listed as CC0 1.0 in lila's COPYING.md | Yes |
| Edward Lasker, *Chess and Checkers: The Way to Mastership* (1918) | **Bundled** verbatim excerpts | US public domain (published before 1931); Project Gutenberg #4913. **Not** public domain in life+70 countries until 2052 (author died 1981) | Yes |
| J. R. Capablanca, *Chess Fundamentals* (1921) | **Cleared for bundling**, no lesson built yet | Public domain in the US and in life+70 countries (author died 1942); Project Gutenberg #33870. Plain text has no diagrams, so positions must be reconstructed and proven against the text's move sequences | Yes |
| Lichess Practice (32 studies) | **Link only** | Chapter content is in studies owned by Lichess accounts; no public licence found. Titles are AGPL (lila repo) | No |
| Lichess Learn | **Link only** | Text is AGPL-3.0 in the lila repo; bundling would add AGPL obligations for little gain at this level | No |
| Chess.com Lessons | **Link only** | User Agreement (updated 2026-03-25) §2(B), §4(C) forbid copying; §5 permits linking; §4(D) restricts automated/AI access | No |
| Chessreps courses | **Link only** | ToS §6.2/§7.3 forbid copying and automated tools; no export exists | No |
| Steps Method | **Reference for sequencing only** | Copyright notices only, no reproduction licence; workbooks are sold, not licensed | n/a |

### Rights findings that constrain the design

1. **Chess.com §4(D)** names "educational tools" among the things automated or AI tools may
   not be used to build from its content, and requires written authorisation for "any other
   automated access". Consequences adopted here: the app never fetches `www.chess.com`;
   only course/lesson titles, authors and URLs are stored (catalogue facts, no descriptions
   or lesson text); the catalogue is a static hand-maintained table. The catalogue in this
   repository was first assembled from the automated audit fetches. **Open decision for the
   owner** (see `docs/STATE.md`): keep those links, or re-collect them by hand in a browser.
2. **Own games.** Chess.com's PubAPI documentation says "Our APIs and documentation are
   public", and Chess.com's own help article points end users at the monthly PGN URL. The
   User Agreement §2(D)(d) allows downloading game records only "as expressly permitted".
   Default for M4: **manual PGN import** (Game History → Download, or the monthly PGN URL
   pasted into a browser). A serial, rate-respecting PubAPI fetch script is possible but is
   an **owner decision** because of §4(D).
3. **Lichess opening explorer now needs an OAuth token** (anonymous requests return 401;
   spec changed 2026-03-03). Move-frequency data for the repertoire trainer is computed
   offline on the Mac from the CC0 monthly game dumps instead: `public/packs/openings-lichess.json`
   holds counts from 2,875,117 rated blitz/rapid/classical games (the first 1.5 GB of the
   October 2026 file), 12,301 positions, by rating band of the player making the move.
4. **Chessreps** has PGN / Lichess-study *import* but no export. The only compliant data
   flow is one-way into Chessreps. Repertoire lines inside this app must come from the
   owner's own PGN or rights-cleared sources, not from Chessreps courses.
5. **Chess.com free accounts** get unlimited "Learn to Play" lessons but otherwise one
   lesson per day; the owner's membership tier is not recorded. Linked Chess.com lessons
   are therefore labelled "membership".
6. **Licences of bundled code.** `@lichess-org/chessground` and `chessops` are
   GPL-3.0-or-later; this repository is licensed GPL-3.0-or-later and any public hosting
   must offer the source (ADR-007).

## 2. The offline human-written lesson gap (honest status)

- **5 of 29** concepts have a local, offline, human-written lesson today, all from Lasker
  (`tactics.double-attack`, `tactics.pin`, `endgame.opposition`, `endgame.passed-pawn`,
  `conversion.trade-when-ahead`). 22 have only online links; 2 have no lesson found.
- The two public-domain books can plausibly supply local lessons for: pins, discovered
  check, the opposition and pawn promotion, basic mates (K+R, K+Q), relative value of the
  pieces, opening development and the centre, and the Giuoco Piano. They do **not** cover:
  skewers, back-rank patterns as a topic, removing the defender, threat scanning,
  rook-endgame theory, the Caro-Kann, time management.
- Therefore: offline days can always run review, application and test blocks, and can run
  the *learn* block only for concepts with a local lesson. Otherwise the app says new
  learning needs a connection and defers it. **This gap is open, not solved.**
- Every local lesson is a verbatim excerpt. `pipeline/trainer_pipeline/lessons.py` proves
  each paragraph is a substring of the checksummed source file, each diagram equals the
  book's diagram, and each move the learner is asked to find is legal and agrees with
  Stockfish (evidence in `content/verification/lessons.json`). No lesson text is written
  or paraphrased by a language model. Excerpt *selection* was done by the build agent and
  each lesson is flagged `ownerReview: pending` until the owner has read it.

## 3. Concept map (29 concepts)

"Week" is the starting order from `docs/PRODUCT.md`, not a deadline. A concept with an
assessment gap can be studied but is never reported as demonstrated.

| # | Concept | Week | Local lesson (offline) | Linked lessons (online) | Independent assessment |
|---|---|---|---|---|---|
| 1 | `safety.hanging-pieces`<br>Hanging pieces | 1 | none yet | [Capturing Pieces: Tactics and Hanging Pieces](https://www.chess.com/lessons/capturing-pieces/tactics-and-hanging-pieces) (Chess.com) | unseen puzzles: hangingPiece |
| 2 | `safety.counting`<br>Counting attackers and defenders | 1 | none yet | [Capturing Pieces: Counting Captures](https://www.chess.com/lessons/capturing-pieces/counting-the-captures) (Chess.com)<br>[Capturing Pieces: Evaluating Captures](https://www.chess.com/lessons/capturing-pieces/value-of-the-pieces) (Chess.com)<br>[Capturing Pieces: Avoiding Bad Trades](https://www.chess.com/lessons/capturing-pieces/avoiding-bad-trades) (Chess.com) | **gap** — The CC0 puzzle data has no tag for exchange counting. Planned: engine-generated capture-sequence drills (M5). |
| 3 | `mate.in-one`<br>Checkmate in one | 1 | none yet | [Checkmate Patterns I](https://lichess.org/practice/checkmates/practicestnamcheckmatepatternsi/fE4k21MW) (Lichess Practice)<br>[Winning the Game: Assisted Checkmates](https://www.chess.com/lessons/winning-the-game/assisted-checkmates) (Chess.com) | unseen puzzles: mateIn1 |
| 4 | `safety.threat-scan`<br>Seeing the opponent's threat | 1 | none yet | [Capturing Pieces: Your Opponent's Move](https://www.chess.com/lessons/capturing-pieces/your-opponents-move) (Chess.com)<br>[Playing the Game: Finding the Right Move](https://www.chess.com/lessons/playing-the-game/finding-the-right-move) (Chess.com) | unseen puzzles: defensiveMove |
| 5 | `tactics.double-attack`<br>Double attack and fork | 2 | `lasker-double-attack` | [The Fork](https://lichess.org/practice/fundamental-tactics/practicestnamthefork/Qj281y1p) (Lichess Practice)<br>[Capturing Pieces: Forks](https://www.chess.com/lessons/capturing-pieces/forks) (Chess.com) | unseen puzzles: fork |
| 6 | `tactics.pin`<br>The pin | 2 | none yet | [The Pin](https://lichess.org/practice/fundamental-tactics/practicestnamthepin/9ogFv8Ac) (Lichess Practice)<br>[Capturing Pieces: Pins](https://www.chess.com/lessons/capturing-pieces/pins) (Chess.com)<br>[Capturing Pieces: Piling Up](https://www.chess.com/lessons/capturing-pieces/piling-up) (Chess.com) | unseen puzzles: pin |
| 7 | `tactics.skewer`<br>The skewer | 2 | none yet | [The Skewer](https://lichess.org/practice/fundamental-tactics/practicestnamtheskewer/tuoBxVE5) (Lichess Practice)<br>[Capturing Pieces: Skewers](https://www.chess.com/lessons/capturing-pieces/skewers) (Chess.com) | unseen puzzles: skewer |
| 8 | `mate.back-rank`<br>Back-rank mate | 2 | none yet | [Finding Checkmate: Back Rank Checkmates](https://www.chess.com/lessons/finding-checkmate/back-rank-checkmates) (Chess.com)<br>[Checkmate Patterns I](https://lichess.org/practice/checkmates/practicestnamcheckmatepatternsi/fE4k21MW) (Lichess Practice) | unseen puzzles: backRankMate |
| 9 | `opening.principles`<br>Opening principles | 2 | none yet | [Opening Principles](https://www.chess.com/lessons/opening-principles) (Chess.com) | **gap** — Principles are assessed through opening decisions in the repertoire trainer (M3). |
| 10 | `mate.in-two`<br>Checkmate in two | 3 | none yet | [Finding Checkmate: Checkmate in 2 Moves](https://www.chess.com/lessons/finding-checkmate/checkmate-in-2-moves) (Chess.com)<br>[Checkmate Patterns II](https://lichess.org/practice/checkmates/practicestnamcheckmatepatternsii/8yadFPpU) (Lichess Practice) | unseen puzzles: mateIn2 |
| 11 | `calc.forcing-moves`<br>Forcing moves: checks, captures, threats | 3 | none yet | [Forcing Moves: Powerful Moves](https://www.chess.com/lessons/forcing-moves/powerful-moves) (Chess.com)<br>[Finding Checkmate: Don't Just Check](https://www.chess.com/lessons/finding-checkmate/dont-just-check) (Chess.com) | unseen puzzles: short |
| 12 | `mate.basic-pieces`<br>Mating with queen or rook against a lone king | 3 | none yet | [Piece Checkmates I](https://lichess.org/practice/checkmates/practicestnampiececheckmatesi/BJy6fEDf) (Lichess Practice)<br>[Winning the Game: Checkmate with the Queen](https://www.chess.com/lessons/winning-the-game/checkmate-with-the-queen) (Chess.com)<br>[Winning the Game: Checkmate with the Rook](https://www.chess.com/lessons/winning-the-game/checkmate-with-the-rook) (Chess.com) | **gap** — Needs play-out against tablebase defence (M5). Capablanca's 'Some simple mates' is the planned local text. |
| 13 | `endgame.opposition`<br>King and pawn endings: the opposition | 3 | none yet | [Opposition](https://lichess.org/practice/pawn-endgames/practicestnamopposition/A4ujYOer) (Lichess Practice)<br>[Key Squares](https://lichess.org/practice/pawn-endgames/practicestnamkeysquares/xebrDvFe) (Lichess Practice)<br>[Pawn Endings: Beginner to Expert: King and Pawn versus King: The Opposition](https://www.chess.com/lessons/pawn-endings-beginner-to-expert/king-and-pawn-versus-king-the-opposition) (Chess.com) | unseen puzzles: pawnEndgame |
| 14 | `endgame.passed-pawn`<br>Passed pawns and the rule of the square | 3 | none yet | [Understanding Endgames: Rule of the Square](https://www.chess.com/lessons/understanding-endgames/rule-of-the-square) (Chess.com)<br>[Understanding Endgames: Passed Pawns](https://www.chess.com/lessons/understanding-endgames/passed-pawns) (Chess.com) | unseen puzzles: pawnEndgame, advancedPawn |
| 15 | `tactics.discovered-attack`<br>Discovered attack and double check | 4 | none yet | [Discovered Attacks](https://lichess.org/practice/fundamental-tactics/practicestnamdiscoveredattacks/MnsJEWnI) (Lichess Practice)<br>[Double Check](https://lichess.org/practice/fundamental-tactics/practicestnamdoublecheck/RUQASaZm) (Lichess Practice)<br>[Winning with Tactics: Discovered Attack](https://www.chess.com/lessons/winning-with-tactics/discovered-attack) (Chess.com) | unseen puzzles: discoveredAttack, doubleCheck |
| 16 | `tactics.remove-defender`<br>Removing the defender | 4 | none yet | [Undermining](https://lichess.org/practice/advanced-tactics/practicestnamundermining/udx042D6) (Lichess Practice)<br>[Winning with Tactics: Remove the Defender](https://www.chess.com/lessons/winning-with-tactics/remove-defender) (Chess.com) | unseen puzzles: capturingDefender |
| 17 | `conversion.trade-when-ahead`<br>Converting extra material | 4 | none yet | [Understanding Endgames: Exchanging Down to a Win](https://www.chess.com/lessons/understanding-endgames/exchanging-down-to-a-win) (Chess.com)<br>[Reading the Board: When to Trade Pieces](https://www.chess.com/lessons/reading-the-board/when-to-trade-pieces) (Chess.com) | **gap** — Needs conversion play-outs against engine defence (M5). |
| 18 | `opening.italian`<br>The Italian Game as White | 4 | none yet | [Italian Game](https://www.chessreps.com/opening/italian-game) (Chessreps)<br>[The Italian Game](https://www.chessreps.com/opening/the-italian-game-oy2wyx0) (Chessreps)<br>[Play The Italian](https://www.chess.com/lessons/play-the-italian) (Chess.com) | opening-tagged puzzles: Italian_Game |
| 19 | `opening.caro-kann-white`<br>Meeting the Caro-Kann as White | 4 | none yet | [Counter the Caro-Kann](https://www.chessreps.com/opening/counter-the-caro-kann-qrhk82i) (Chessreps)<br>[Learn The Caro-Kann Defense](https://www.chess.com/lessons/learn-the-caro-kann-defense) (Chess.com) | opening-tagged puzzles: Caro-Kann_Defense |
| 20 | `tactics.deflection`<br>Deflection and attraction | later | none yet | [Deflection](https://lichess.org/practice/advanced-tactics/practicestnamdeflection/kdKpaYLW) (Lichess Practice)<br>[Attraction](https://lichess.org/practice/advanced-tactics/practicestnamattraction/jOZejFWk) (Lichess Practice)<br>[Winning with Tactics: Deflection](https://www.chess.com/lessons/winning-with-tactics/deflection) (Chess.com)<br>[Winning with Tactics: Decoy](https://www.chess.com/lessons/winning-with-tactics/decoy) (Chess.com) | unseen puzzles: deflection, attraction |
| 21 | `tactics.trapped-piece`<br>Trapping a piece | later | none yet | none found | unseen puzzles: trappedPiece |
| 22 | `tactics.intermezzo`<br>The in-between move | later | none yet | [Zwischenzug](https://lichess.org/practice/fundamental-tactics/practicestnamzwischenzug/ITWY4GN2) (Lichess Practice) | unseen puzzles: intermezzo |
| 23 | `mate.patterns`<br>Checkmate patterns | later | none yet | [Checkmate Patterns III](https://lichess.org/practice/checkmates/practicestnamcheckmatepatternsiii/PDkQDt6u) (Lichess Practice)<br>[Checkmate Patterns IV](https://lichess.org/practice/checkmates/practicestnamcheckmatepatternsiv/96Lij7wH) (Lichess Practice)<br>[Checkmate Patterns You Should Know](https://www.chess.com/lessons/how-to-checkmate) (Chess.com) | unseen puzzles: smotheredMate, mateIn2 |
| 24 | `calc.candidate-moves`<br>Candidate moves | later | none yet | [Candidate Moves](https://www.chess.com/lessons/candidate-moves) (Chess.com) | unseen puzzles: long |
| 25 | `endgame.rook-basics`<br>Basic rook endgames | later | none yet | [Basic Rook Endgames](https://lichess.org/practice/rook-endgames/practicestnambasicrookendgames/pqUSUw8Y) (Lichess Practice)<br>[Rook and Other Endgames](https://www.chess.com/lessons/rook-and-other-endgames) (Chess.com) | unseen puzzles: rookEndgame |
| 26 | `defense.basics`<br>Defending against threats | later | none yet | [Forcing Moves: Saving Draws](https://www.chess.com/lessons/forcing-moves/saving-draws) (Chess.com) | unseen puzzles: defensiveMove, quietMove |
| 27 | `positional.piece-activity`<br>Piece activity | later | none yet | [Make the Most of Your Pieces](https://www.chess.com/lessons/make-the-most-of-your-pieces) (Chess.com)<br>[Opening Principles: Active Pieces](https://www.chess.com/lessons/opening-principles/active-pieces) (Chess.com) | **gap** — No objective unseen assessment identified yet for positional judgement. |
| 28 | `positional.pawn-structure`<br>Pawn structure | later | none yet | [Reading the Board: Pawn Structures](https://www.chess.com/lessons/reading-the-board/pawn-structures) (Chess.com) | **gap** — No objective unseen assessment identified yet for positional judgement. |
| 29 | `time.clock-management`<br>Using the clock | later | none yet | none found | **gap** — No suitable beginner-level human-written lesson found in the audit; measured from own-game clock data in M4. |

### Gaps found by the audit

- No beginner-level Chess.com lesson found for: playing against the Caro-Kann as White,
  rook endgames, defending, time management ("not found in what was fetched", which is not
  the same as "does not exist").
- Chess.com's *Play The Italian* (IM Krykun) is listed as Intermediate and built on
  grandmaster games; it is linked as a stretch resource.
- 7 concepts have no independent unseen assessment yet (counting exchanges, opening
  principles, basic piece mates, conversion, piece activity, pawn structure, clock use).

## 4. Opening courses (linked)

| Opening | Course | Author | Access | URL |
|---|---|---|---|---|
| Italian Game (White) | Italian Game, 22 lines | Chessreps | first line free, rest membership | https://www.chessreps.com/opening/italian-game |
| Italian Game (White) | The Italian Game | GM Wei Yi | first line free, rest membership | https://www.chessreps.com/opening/the-italian-game-oy2wyx0 |
| vs Caro-Kann (White) | Counter the Caro-Kann (Advance Variation, 30 lines) | CM Azel Chua | first line free, rest membership | https://www.chessreps.com/opening/counter-the-caro-kann-qrhk82i |
| Italian Game | Play The Italian | IM Yuriy Krykun | Chess.com membership | https://www.chess.com/lessons/play-the-italian |

A Black repertoire has not been chosen. Chessreps' own beginner page recommends the
Caro-Kann against 1.e4 and the Queen's Gambit Declined against 1.d4; the candidate course
list is in the Chessreps audit file. The app will propose candidates from imported games
(M4) and ask before adopting one.

## 5. Steps Method (sequencing reference only)

Six steps by Rob Brunia and Cor van Wijgerden. The English distributor maps Step 1 to
"rating up to 800" and Step 2 to "up to 1400" on an unspecified scale, and says "Being
sufficient in Step 1 is key" rather than rating. Used here only to order concepts: Step 1
plus/mix topics as a check, Step 2 as the main body, Step 3 next. No exercises are bundled.
Chess Tutor (official software) is Windows-only and covers Steps 1–3.

## 6. Data and platform facts verified for later milestones

- **Puzzle CSV**: 11 columns (`PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,
  NbPlays,Themes,GameUrl,OpeningTags,DailyDate`). "FEN is the position before the opponent
  makes their move"; the first move is the opponent's; the solver is the side *not* to move
  in the FEN. "Any move that checkmates should win the puzzle." Enforced by
  `pipeline/tests/test_puzzles.py` and `src/puzzles/run.test.ts`.
- **PubAPI**: `https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}` (JSON) and
  `.../pgn`; serial access unlimited, parallel may get 429; ETag/Last-Modified supported.
  Live records carried `time_class`, `rated` and `[%clk]` comments, none of which are in
  the documented schema, so importers must tolerate their absence.
- **Lichess monthly game dumps**: CC0, about 28–31 GB compressed per month, streamable.
- **Tablebases**: Syzygy 3-4-5 piece tables about 938 MiB, freely redistributable; the
  Lichess tablebase API needs no auth.
- **iOS storage**: Home Screen web apps are exempt from Safari's 7-day eviction of
  script-writable storage; quota up to 60% of disk per origin; `navigator.storage.persist()`
  is granted by heuristics (Home Screen install helps) without a prompt; Home Screen app
  storage is **separate** from Safari's for the same origin, so progress made in a Safari
  tab does not carry over on install. No File System Access pickers; Web Share with files
  is supported; `<a download>` has an open Home Screen bug (WebKit 290847). Export must be
  tested on the device.
- **Hosting**: GitHub Pages, Cloudflare Pages and Netlify all fit a ~5 MB site on free
  tiers. Cloudflare Pages and Netlify support custom headers; GitHub Pages does not and
  shares one origin across an account's project sites (so storage would be shared too).

## 7. Could not verify (carried forward)

- Individual Lichess Practice and Chess.com lesson URLs (opened only on tap by the owner).
- Which Chess.com lessons are free; the owner's membership tier.
- Chessreps logged-in features (export) and anything past each course's first line.
- How the Steps distributor's rating scale relates to Chess.com rapid.
- iOS file export behaviour on the owner's actual device.
