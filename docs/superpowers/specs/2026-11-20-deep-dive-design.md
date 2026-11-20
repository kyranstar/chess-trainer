# Deep dive: openings, tactics and strategy (ADR-062)

Date: 2026-11-20. Owner request: "augment the progress feature with some additional really helpful things that might go in 'advanced stats' like openings, tactics, strategies. I would love a detailed breakdown that is presented in a simple, clear way without information overload, utilizing beautiful and apt graphics and visualizations. Let's go deep into the chess universe - what kinds of stats will be both fun to look at and useful for improving?"

The owner's standing instruction is to work autonomously and ship (memory: no manual steps; ship to production and report), so the design below is my call throughout; it is recorded here so it can be corrected.

## Intent

Progress (ADR-061) answers "how am I doing and what next" in ten seconds. It does not answer "what kind of player am I": which openings go well, which tactics beat him and which he misses, where games turn, how he uses the clock, how games end. Those are the questions a coach asks after looking at fifty games. The deep dive answers them from the records already on the phone, each as one picture with one sentence, with the games or positions behind it one tap away.

## Goals

- Three pages, one per area the owner named: **Openings**, **Tactics**, **Strategy**. Each holds four to six cards; each card makes one point (title, one headline, one picture, one line naming the sample) and opens what it counts.
- Pictures chosen for the data, not for variety: a tree for openings, a two-sided bar for "against you / for you", a board for where pieces fall, a row of colour per game for how games go, lines for the clock.
- Useful for improving: every motif links to its concept in Learn; every count opens its positions or games.
- On the Progress overview: one section, "Deep dive", with three tappable cards, each with a small picture and one fact. Nothing else on the overview changes.

## Non-goals and anti-goals

- No ability score, accuracy percentage, "playing style" label, or ranking of weaknesses beyond counts with their sample.
- No sentence that says why a move was played or what to do about it. Motif names are board facts worked out by generating legal moves (below), not interpretation; anything that does not fit is "Other".
- No change to any frozen definition (early blunders, major errors, clear chances, the clock rule). New definitions are written once, here and in `docs/METRICS.md`.
- No LLM-written text. No opening explanations: the opening names come from a CC0 dataset of names only.
- No new runtime dependency; charts are hand-drawn SVG like ADR-061.

## Approaches considered

1. **More cards on the overview** (a fourth and fifth section): cheapest, but turns the ten-second page back into a lab report.
2. **One long "Advanced stats" page**: everything in one scroll; simple to build, but ten unrelated charts in a row is the overload the owner asked to avoid.
3. **Chosen: three themed pages behind one overview section**, matching the owner's three words. Each page is short enough to read in a minute; the overview gains three cards, not ten.

## Cohort

Each page has one filter row at the top: **Rapid** (rated rapid, the cohort of every game chart, default) and **All games** (every game with moves, any time control, rated or not). The Openings page adds **As White / As Black**. Training cards (puzzles) are under their own heading and ignore the game filter.

## Openings

Opening names: the Lichess `chess-openings` dataset (CC0-1.0, github.com/lichess-org/chess-openings), read at a pinned commit by `pipeline/trainer_pipeline/opening_names.py` into `public/packs/opening-names.json` (position key → name; the app's `positionKey`, which is the dataset's EPD). A game's opening is the deepest named position it reached in its first 40 plies (the dataset's own advice; transpositions included). The family is the name before the colon.

1. **Your opening tree** — an icicle: one band per ply for the first three moves of each side, each cell as wide as the share of games that went that way, coloured by his score from those games (mostly won ≥ 60%, mixed, mostly lost ≤ 40%; under three games: outline only). Tap a cell: the line, the games, won/drawn/lost, the opening's name at that point, and a link to the games. Headline: the most played line and its count.
2. **Openings you play** — families by number of games (six, the rest as "Other"), each with a thin won/drawn/lost bar and the score; each row opens its games.
3. **After the opening** — one dot per game on a worse–level–better axis: his expected score before his 11th move (best play, the measurement record). Rows: the four most played families with at least three games, then all. Ahead ≥ 60 (about a pawn better), behind ≤ 40. Headline: "Ahead after move 10 in N of M".

## Tactics

Motifs (new, `src/games/motifs.ts`): a move is classified on the board, by legal-move generation with chessops, from the side that plays it, in this order:
- **Mate**: the event is a mate (allowed, or the chance was a mate).
- **Hanging piece**: the move takes a piece that could be taken for nothing (no recapture, or a cheaper capturer: the test of "Your move", `looseAfter`).
- **Fork**: after the move, the moved piece attacks two or more of the other side's pieces, each the king, undefended, or worth more than the attacker.
- **Pin or skewer**: after the move, the moved piece (bishop, rook, queen) attacks a piece with a more valuable piece or the king behind it on the same line.
- **Discovered attack**: after the move, another piece of the mover's newly attacks the king or a piece worth 3 or more, through the square the move left.
- **Other**: none of these.

"Against you" classifies the opponent's first move of the refutation of each big mistake labelled "loses material" or "allows mate". "For you" classifies the best move of each position where the engine's best line won material or mated (`opportunity`), taken or not.

1. **Tactics, both ways** — a two-sided bar per motif: to the left how often it was used against him (red), to the right the chances he had (blue: filled taken, outlined missed). Each side opens its positions; each motif links to its concept. Headline: the motif that came up most, both ways together.
2. **Where your pieces fall** — a board, his side at the bottom (Black's games mirrored by rank, so the kingside stays on the right), each square shaded by how often a piece of his was taken there in those big mistakes, and a row of the five piece kinds with their counts.
3. **Puzzle motifs** (training) — first-look puzzle results by Lichess theme, for motif themes seen at least five times, lowest share solved first, each a dot with its 95% range; each row links to its concept where one covers the theme.
4. **Puzzle difficulty** (training) — share solved by puzzle rating band of 200, a point with its range per band.

## Strategy

1. **Your games, move by move** — the last 20 games of the cohort as rows, newest on top, one cell per move of his coloured by his expected score before it (seven steps from lost to won, neutral at level), a tick on each big mistake, the result at the end. Tap a row: the date, the result, the move of the largest drop, a link to the game page. Headline: "Games turn around move N": the median move of each game's largest single loss, over games with a big mistake.
2. **Winning and saving** — of the games where he stood winning at some move (expected score 75 or more, about three pawns), how many he won; of those where he stood lost (25 or less), how many he did not lose. Dot and range rows; each opens its games.
3. **King safety** — the move he castled on, one dot per game, with a pile for games he never castled; under it the results of games castled by move 10 against the rest as won/drawn/lost bars. Correlation, not cause; the card says neither.
4. **Time left** — the median share of his starting time left after each of his moves, his against his opponents', to the last move at least ten games reached; rapid and blitz games with clocks only. Headline: both at move 20.
5. **Thinking time** — big mistakes per 100 moves by the time the move took (under 5 s, 5–15 s, 15–60 s, over a minute), moves 11 on, undecided positions only (expected score 10–90, the clock rule's filter); headline: the median time per move.
6. **How games end** — wins and losses by how they ended (checkmate, resignation, on time, abandoned), losses to the left, wins to the right, draws as a count. Headline: losses on time, or wins by mate if none.

## Explanations

Each page ends with "About these numbers": one sentence per card, fixed copy. Small samples carry "Provisional" (under 20 games, chances or first looks); rates carry "95% range" where a rate is shown.

## Visual language

ADR-061's tokens: series blue (`--ch-a`), event red (`--ch-bad`), neutral gray. New: a diverging blue–gray–red ramp of seven steps for expected score and score (`--dv-*`, light and dark each its own), validated for monotone lightness per arm; won/drawn/lost as blue / gray / red, always with a legend and the result letter or count beside it, so colour is never the only channel. Every chart has an accessible name; interactive charts on the pages show the tapped value in a readout line.

## Left to the builder

Pixel sizes; how many plies the tree shows if it does not fit (three moves each, fewer cells merged into "other"); the wording of each "About" sentence; test names.
