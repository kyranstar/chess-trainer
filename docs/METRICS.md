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

## Evidence discipline
- Report analysis coverage: analyzed decision count / eligible decisions, analyzed games / eligible games. Do not pool games with inconsistent engine settings without labeling.
- Flag e.g. `<20 relevant observations` as provisional by policy; threshold to be evaluated, not treated as statistical magic.
- Game outcomes vary with opponent and game context; rating trend is the main real-play result indicator but inherently noisy.
- Keep an 'Unknown/Other' category for every attempt to assign conceptual causes. Engine mistakes are not automatically 'calculation errors'.
- Never claim training caused rating improvement without a defensible experimental design.
