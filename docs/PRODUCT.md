# Product specification — Chess Trainer

## North star
A personally useful chess coach that teaches new chess concepts in a coherent progression and measures whether those concepts improve unseen problem-solving and real games. It is not simply a repertoire memorizer or puzzle queue.

## Product structure
**Today:** one primary Resume action, a 30-minute plan with four sequential blocks, clear source/online requirements, ability to skip/swap, unblocked offline fallbacks, and summary at the end.
**Learn:** concept map with locked/unlocked/reviewable skills; prerequisites; human-authored courses linked or locally licensed; show course source and approximate time; separate 'view source', 'mark done', 'check understanding'.
**Practice:** adaptive puzzles, isolated concept drills, openings, endgames, candidate-move calculation, custom mistake sets.
**Progress:** game outcomes, error evidence, unseen exercise performance, retention, curriculum coverage, and actionable drill-through.

## Daily experience (30 minutes)
1. Review 7 min: due opening decisions, spaced endgame facts, recent misses; respect hard time cap.
2. Learn 9 min: always reserve protected new-learning time when a vetted concept is ready. Keep a progression through course prerequisites. If an online course cannot be reached, show an honest offline fallback, not copied text.
3. Apply 8 min: guided then unseen exercises for the concept just taught; distinguish hints from unassisted success.
4. Test 6 min: mixed/unseen diagnostics, own-game critical positions, occasional endgame conversion.
This is a starting heuristic for **study days**. Reserve ~2 days/week for deliberate real-game play and immediate review (for instance one 10+5 rapid game, review, and short reflection, extending the session if the game runs long). Those play days intentionally replace some study blocks; meaningful new learning is protected across the *week*, not mechanically required during an unfinished live game. A concept can span multiple days.

## First-run diagnostic
- Short, self-paced initial checks on loose pieces/opponent threats, simple forks/pins/skewers, checking and forced-move calculations, elementary mates, king-and-pawn endgames, opening principles, and current repertoire knowledge.
- Require sufficient observations before declaring mastery/weakness; mark uncovered concepts 'untested'. Do not force beginner lessons for mastered concepts; skip through a pre-test.
- Later adapt based on first-try performance on **unseen** positions and real-game evidence.

## Skill graph
- Taxonomy: board vision & safety; candidate moves & calculation; tactical motifs; opening principles; repertoire knowledge; pawn, rook, and mating endgames; positional play; defense and conversion; time-management patterns.
- Each concept: unique ID, description, prerequisites, human course references, local practice references, mastery evidence, assessment rubric, version.
- Each learning objective should have an independent transfer exercise and one delayed retention check.

## Initial course progression
- W1: threat scan, loose pieces, undefended captures, basic mating threats; show assessments of prereqs.
- W2: counting exchanges, forks/pins, candidate moves, opening development and king safety.
- W3: forcing sequences/checks/captures/threats, simple king-and-pawn endings, one- and two-move calculation.
- W4: discovered attacks and defender removal, simple endgame conversion, Italian structures/anti-Caro-Kann principles.
- Beyond: strategic piece activity, center/pawn breaks, defensive technique, conversion, intermediate endgames, calculation depth. Adaptive, not strict weekly deadlines.
- Source suggestions: Chess.com Learn Path, relevant beginner courses and study guides, Chessreps for opening courses, Lichess practice, optional Steps Method workbooks. Do not assert availability of an import or exact lesson without verification.

## Feedback quality requirements
- For each task: what is being tested, whether alternatives are accepted, what error occurred, and actionable remediation. When objectively verifying alternatives, use legal rules and sufficiently stable engine/tablebase evidence. 'Not in your repertoire' is not equal to 'bad'.
- Present a short lesson **before** application and clear rationale **after**. Maintain explanation source and provenance. A task unsupported by verified explanation should be presented as practice, not instruction.

## User stories
- I can complete a meaningful 30-minute session on my iPhone with no network once offline materials are installed.
- I learn something genuinely new most days without falling into unlimited flashcard reviews.
- I can leave the app for Chess.com/Chessreps, return, mark work done, and demonstrate what I learned through independent exercises.
- I see ratings and game-quality trends separated by time control and identify actual moves underlying a metric.
- I can practice a concept again when a weakness appears in later games.
- My data can be exported and restored before sync exists.

## Explicit non-goals for initial releases
- No competitive rated chess, social platform, built-in paid content marketplace, autonomous scraping of memberships, paid LLM tutoring, or full offline replicas of third-party lessons.
