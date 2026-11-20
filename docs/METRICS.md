# Performance dashboard contract

## General requirements
Each metric specifies: formal numerator, denominator, unit, population/cohort, time control, period, data source, confidence/uncertainty or `insufficient data`, comparison baseline, exclusions and drill-down links to underlying examples. No single proprietary 'overall chess score'. Never place Daily, Rapid, Blitz and puzzle rating on one interchangeable scale.

## Core dashboard (v1)
1. **Rating by time control**: time series of archived Chess.com game ratings for Rapid, Blitz and Daily; show current value, latest timestamp, last 20 games and longer trend. No ranking across time controls.
2. **Major-error rate**: count of material/position-quality losses exceeding a reproducible rule per 100 analyzed decisions (and per game as secondary). Specify evaluation method, engine settings and coverage. Start with transparent thresholds; calibrate before any causal interpretation. Consider WDL loss with position context vs naïve centipawn-only thresholds.
3. **Missed tactical opportunities**: count of positions with verified tactical gain available but missed, per evaluated opportunity. Must report how candidate positions were discovered and rate of unclassified moves. Distinguish tactical opportunities from generic best-move discrepancies.
4. **Unprotected-piece / immediate-threat error**: mistakes with a concrete verified one-move or short forced loss and a matching objective label; otherwise unknown. Show games and moves.
5. **Opening preparedness**: proportion of repertoire decision occurrences with a sound known response, plus encounter-probability-weighted coverage when population statistics are available. Distinguish playable novelty vs inferior move.
6. **Unseen puzzle accuracy**: first attempt before hints on fresh, non-repeat items, by theme and difficulty band, time trend and sample count. Do not include rehearsed puzzles in this metric.
7. **Retention**: delayed recall on previously seen items, compared with chosen SRS forecast, stratified by interval and concept, with n and calibration warnings.
8. **Endgame proficiency**: separately measured theoretical correctness (tablebase/verified solution) and practical conversion against locally simulated defense; explicit difficulty and n.
9. **Curriculum coverage**: concepts assessed and taught, prerequisites passed, untested concepts, independent-transfer pass status; no arbitrary skill percentage without defined rubric.
10. **Training-to-game transfer**: time series of recurrence of matched *objective* mistake categories before vs after drills, normalized by relevant opportunities; show observational/not causal language.
11. **Clock-pressure errors** (only if clocks present and adequately parsed): error incidence by low-time vs normal-time states, controlling for enough samples.

## Explainability & actionability
Every actionable card should display `[trend] [sample n] [defined period] [confidence]`, then 'View positions' and 'Practice this'. Show gaps and unknowns instead of confected signal. On the main view only 4–6 cards and one clear focus recommendation; detailed tabs can carry the rest.

**Changed by ADR-061 (owner request, 2026-11-18):** the main view is grouped cards rather than 4–6: one action (*Next up*), three recent games, then sections *In your games*, *In training*, *Learning* and a list of rows under *More*. Each card still carries one number, one chart, its sample, window and 95% range or "Provisional", and opens its own screen with *Recent / Trend / History* windows, the positions behind it and "About this measure". There is no global period picker: each measure has windows of its own unit (games, first looks, days).

## Progress page (ADR-061)
| Card | Number | Unit and window | Chart |
|---|---|---|---|
| Early blunders | games with one, of the last 20 | rated rapid games; last 20 against the 20 before | squares per game, two rows |
| Rapid rating | rating after the latest game | rated rapid games; change over 20 | line over game number |
| Big mistakes | per 100 moves, last 20 games | decisions; interval clustered by game | rolling 20-game rate with band |
| Chances taken | clear chances taken | last 40 rated rapid games | one mark per chance |
| How you play | phase with most big mistakes | last 40 games | rows by move number |
| Spotting danger / chances | share spotted | first looks; spotted and false alarms apart | two dot-and-range rows |
| Your move | share sound (best, good, inaccuracy) | first looks | blocks of 20 |
| Fresh puzzles | share solved first try | first-ever showings | blocks of 20 |
| Concept checks | concepts passed | 29 concepts | grid by state |
| Practice | days with an answer of 28 | positions per day | daily bars |


## Deep dive (ADR-062)
Filter: rated rapid (default) or every game of every kind; Openings also by colour. Puzzle cards are first looks and ignore the filter.
| Card | Number | Definition |
|---|---|---|
| Your opening tree | the most played line while a fifth of the games still follow it | first three moves each; cell width = share of games; colour = his score (≥60%, ≤40%, between; outline under 3 games) |
| Openings you play | the most played opening | deepest named position (Lichess `chess-openings`, CC0) in the first 40 plies; won/drawn/lost and score (a draw is half) |
| After the opening | games ahead after move 10 | expected score before his 11th move (measurement record); ahead ≥ 60, behind ≤ 40 |
| Tactics, both ways | the motif that came up most | against: big mistakes labelled losing material or allowing mate, named by the refutation; for: clear chances (one move better by 20+, counted once), named by the best line, taken or missed |
| Where your pieces fall | pieces of the most lost kind | the loose piece taken, else his pieces taken less one of equal value per piece he took back; a capture on a line's last move not counted; Black mirrored by rank |
| Puzzle tactics | the theme with the lowest share solved | first-look puzzles by Lichess theme, themes seen 5+ times, Wilson range |
| Puzzle difficulty | share solved | first-look puzzles per 200 rating points, Wilson range |
| Your games, move by move | median move of each game's largest single loss | over games where it was 20+ points; last 20 games |
| Winning and saving | winning positions won | winning: expected score ≥ 75 before one of his moves; lost: ≤ 25; saved = not lost |
| King safety | games castled by move 10 | from the moves; results by group are what happened, not an effect |
| Time left | his share of the starting time at move 20, and his opponents' | median per move while ≥ 10 games reached it; daily games out |
| Thinking time | median seconds per move | big mistakes per 100 moves by time taken (clock before − after + increment), moves 11+, expected score 10–90, clustered by game |
| How games end | losses on time (else wins by mate) | Chess.com's termination words |

Motif names are board facts worked out by legal-move generation (`src/games/motifs.ts`), never interpretation: hanging piece, fork, pin or skewer, discovered attack, mate, other.

## Evidence discipline
- Report analysis coverage: analyzed decision count / eligible decisions, analyzed games / eligible games. Do not pool games with inconsistent engine settings without labeling.
- Flag e.g. `<20 relevant observations` as provisional by policy; threshold to be evaluated, not treated as statistical magic.
- Game outcomes vary with opponent and game context; rating trend is the main real-play result indicator but inherently noisy.
- Keep an 'Unknown/Other' category for every attempt to assign conceptual causes. Engine mistakes are not automatically 'calculation errors'.
- Never claim training caused rating improvement without a defensible experimental design.
