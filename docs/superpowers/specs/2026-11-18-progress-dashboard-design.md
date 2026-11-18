# Progress dashboard redesign (ADR-061)

Date: 2026-11-18. Owner request: "redesign the progress dashboard, include more timeseries and make everything more clean concise app looking layout, and perhaps rework some of the measures", then, in the same conversation with the outside designer (ChatGPT, "GPT-6 Astra"): "timeframes inherent into each metric", "recent game breakdowns", "how we can improve actionably", "summarizing actions", and "how to explain each measure — concise and direct, never overcrowding … visualized in an intuitive and pretty and creative way".

The brainstorm with Astra ran four rounds (one by the owner directly). This document is what was kept, what was changed and why.

## Intent

Progress today is a lab report: a period picker, a text headline, then about twelve cards of sentences and one sparkline. The owner wants an app-like page that shows, in about ten seconds, how he is playing, one concrete thing to work on, and the history behind it, with the statistics one tap away rather than on the page.

## Goals

- Every card makes one point at a glance: title, one number, one chart, one subtitle line carrying the sample and window (and the 95% range for a rate).
- More time series, each in the form its data can honestly carry today ("the graph grows with the evidence, not with elapsed time").
- Recent games as games: what happened in the last three, and a breakdown screen per game.
- One next action, tied to a real position.
- A timeframe that belongs to each metric (Recent / Trend / History), chosen on its detail screen.
- Explanations moved off the overview: one short "About this measure" per detail screen and one shared "Reading the ranges" note.

## Non-goals and anti-goals

- No composite score, no ability percentage, no "biggest weakness" ranking, no green/red verdict on a noisy change.
- No claim that training caused a change. Only 4 of the 45 rated rapid games are since training began (10 November); the page says so.
- No AI-written coaching prose. Astra proposed a "cue to carry into the next game" in fixed generic sentences; it is **not built**: those sentences would be teaching text written by an LLM, which `CLAUDE.md` forbids in the teaching and feedback path. The action is a link to positions instead.
- No change to any frozen definition: the early-blunder predicate (ADR-027/032), the major-error threshold (20 expected-score points), the clear-chance rule, the clock-pressure rule (10% of base, undecided positions only).

## Approaches considered

1. **Restyle the existing cards** (keep the period picker and the sections, add charts): cheapest, but keeps one global window that means different reliability on every card, and keeps the text.
2. **Nine metric cards with per-metric charts and detail screens** (Astra's first round): clean, honest, but answers "how am I doing" and not "what happened and what next".
3. **Chosen: 2 plus a game layer** (Astra's "Progress 2.0", requested by the owner): Next up, Recent games and a game breakdown screen, a "How you play" breakdown, the nine cards, activity, and a list of rows for everything else. Each card and section opens a detail screen with Recent / Trend / History.

## The page (390 px wide, top to bottom)

1. **Next up** — one action, one reason, one button. Deterministic order: the latest rated rapid game's first early blunder ("Review your latest early blunder" · "Move 14 of your game on Nov 17" · Open position); else its largest big mistake; else its first missed clear chance; else, if positions from his games are due in review, "Positions from your games are due" → Practice; else "Nothing from your games to review" → Today. At most one primary action; no secondary list.
2. **Recent games** — three rows (latest first): result as a word and a coloured mark (Win / Draw / Loss, mark shape differs), colour played, date, rating after and change, "2 big mistakes", and "Early blunder, move 14" when there is one. Tap → game breakdown. "All games" row → list of every rated rapid game.
3. **In your games** — section header with "45 rated rapid games".
   - **Early blunders.** Headline "9 of 20 games". Subtitle "Last 20 rated rapid · 11 in the 20 before". Chart: the last 40 games as squares, 20 | 20, filled square = a game with an early blunder, hollow = without; a "Training began" tick where it falls. Range line: "95% range 26–64%". Provisional below 20 games ("Provisional · 12 rated rapid games"); with 20–39 the previous-20 part is omitted.
   - **Rapid rating.** Headline "494". Subtitle "+37 over 20 games · 45 rated games". Chart: rating after each rated rapid game (x = game number), latest point labelled, "Training began" tick, no band (a rating is a record, not an estimate).
   - **Big mistakes.** Headline "6.2 per 100 moves". Subtitle "Last 20 rated rapid · 31 in 498 moves". Chart: faint dot per game (its own rate), a 20-game rolling pooled rate as the line with its 95% band (game-clustered, t with G−1 df, `src/metrics/stats.ts`). Range line on the card.
   - **Chances taken.** Headline "4 of 9" with the share. Subtitle "Clear chances · last 40 rated rapid". Chart: one mark per clear chance in game order (filled = taken, hollow = missed). Unit: the existing clear chance (one move beats every other by 20+, counted once while it stays on the board).
4. **How you play** — a card with one default chart (big mistakes per 100 moves by move phase 1–9, 10–19, 20–29, 30+, bars with range whiskers) and "Open" → detail with four views: Move phase, Mistake type (counts of the four labels, sorted bars, each a link to its positions), Clock (low on time against the rest, the existing rule), Colour (White against Black: big mistakes and early-blunder share).
5. **In training** (first looks only, never repeats):
   - **Spotting danger** ("Is this move safe?"). Headline "73% spotted". Subtitle "First looks · 15 unsafe, 13 safe". Chart: two rows on one 0–100% axis, "Spotted" and "False alarms", each a dot with its range. Provisional until both kinds have 20.
   - **Your move.** Headline "62% sound". Subtitle "28 of 45 first looks · best, good or inaccuracy". Chart: blocks of 20 first looks as points with whiskers, not joined; the incomplete block as faint marks. *My call, against Astra's "avoided a major error" (under 20 points):* the card uses the app's own verdict (sound = best, good or inaccuracy, ADR-043) so the dashboard agrees with what each answer told him.
   - **Spotting chances** ("Anything to win?"). Same form as Spotting danger.
   - **Fresh puzzles.** Headline "63% solved". Subtitle "63 of 100 unseen puzzles". Chart: blocks of 20 with whiskers (five today).
6. **Learning** — **Concept checks.** Headline "3 passed". Subtitle "5 of 29 checked · rechecks after 21 days". Chart: a 29-cell grid in curriculum order, one cell per concept, by state (passed, recheck due, checked not passed, studied, started, not started, no check yet) with a legend of counts. Tap → the per-concept table (moved from the overview).
7. **Practice activity** — 28 daily bars, positions not minutes (minutes are unreliable: a position left on screen counts), stacked first looks / repeats and reviews; days before the first recorded attempt drawn as "not tracked", not as zero. Headline "9 of 28 days". Subtitle "271 positions · 160 first looks".
8. **More** — rows, each its own screen holding the current card unchanged in substance: Other ratings (blitz, daily charts), Retention, King-and-pawn endings, Openings, Play days, Puzzle level, Reading the ranges, Your data and backup.

No global period picker. Links into the existing positions lists keep working (their `period` parameter defaults to all).

## Detail screens

Route `progress/metric/<id>`: title; segmented control **Recent / Trend / History**; the headline for that window; the chart for that window; one subtitle; "View the N positions" (the existing lists); "About this measure" in one or two short sentences. Windows (Astra's table, adopted):

| Metric | Recent | Trend | History |
|---|---|---|---|
| Early blunders | last 5 games | last 20 vs the 20 before | all |
| Rapid rating | last 10 games | last 20 games | all |
| Big mistakes | last 5 games | 20-game rolling rate | all |
| Chances taken | last 5 games | last 40 games | all |
| Spotting danger / chances | last 10 of each kind | last 20 of each kind | all |
| Your move | last 20 | blocks of 20 | all |
| Fresh puzzles | last 20 | blocks of 20 | all |
| Practice activity | 7 days | 28 days | since tracking began |

A window with little data is still selectable and says "Provisional"; a larger window is never substituted silently.

Route `progress/game/<id>`: result, colour, opponent, date, rating change; "How the game went": your expected score before each of your moves (0–100, the measurement record's `facts`), with markers at big mistakes and missed chances; "Moments": up to three, deterministic (first early blunder, largest big mistake, first missed clear chance, first big mistake under time pressure; deduplicated), each opening the existing position screen; "No big mistakes found at this engine setting" when there are none; link to the game on Chess.com.

Route `progress/how` (How you play), `progress/more/<page>` (the rows), `progress/games` (all rated rapid games).

## Explanations

- Overview: no paragraphs, no footnotes, no "i" icons. Statistical words (Wilson, expected score, cluster) never appear on the overview.
- "95% range" is the one label for uncertainty; "Provisional" for under 20 units of the metric's own kind (games, chances, first looks per class).
- Each detail screen ends with "About this measure": one or two sentences of fixed copy (e.g. "Games in which one of your first 20 moves lost material or allowed mate in a short line. Rated rapid games only."). The current long definitions move there, shortened.
- "Reading the ranges" (under More) explains the range and "Provisional" once.

## Visual language

Five patterns, each used for one kind of data (Astra): game strips (squares, one per game), trajectories (line over game number), paired estimates (dot + range rows on one 0–100% axis), sequential blocks (points with whiskers, never joined), status and activity (grid, daily bars). Colour from the app's tokens: one accent for series (`--best`), `--flag` for an event against him (blunder, miss, false alarm), `--good` only where a legend names it; filled against hollow carries the same meaning so colour is never the only channel. Hand-drawn SVG, no chart library (offline bundle, no new dependency). Every chart has an accessible name that states what it shows, and a tap on a mark shows its values in a readout line under the chart.

## Left to the builder

Exact pixel sizes; the detail screen of each metric beyond its windows; which existing tests are rewritten for the new markup (keep `data-testid`s where the measure is unchanged: `card-unseen`, `card-ownmove`, `card-errors`, `card-missed`, `card-ratings`, `rating-<tc>`, `card-coverage`, `card-endgame`, `card-openings`, `card-journal`).

## Build order

1. Pure series functions with unit tests (`src/progress/series.ts`): per-game strips, rolling cluster rates, chance episodes per game, phase/type/clock/colour breakdowns, game summary and moments, attempt strips and blocks, activity days, concept cells, next action.
2. SVG chart components (`src/ui/charts.tsx`).
3. Overview page and the More pages (existing cards moved, not rewritten).
4. Metric detail screens with Recent / Trend / History; game breakdown; How you play.
5. Browser tests rewritten for the new page; a screenshot pass at 390 px light and dark on the owner's backup copy (local only).
6. Docs: ADR-061, `docs/METRICS.md`, `docs/STATE.md`; deploy and live check.
