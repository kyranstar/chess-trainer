# Instruction and adaptive scheduling model

## Goals
Build principled breadth before niche opening depth; new learning must remain protected. Weakness-driven reviews do not overtake the curriculum. Progress uses tested knowledge and real-game transfer, not engagement proxies.

## Scheduler v1: deterministic and transparent
- Daily budget 30m: 7m due review, 9m vetted new instruction, 8m immediate transfer tasks, 6m mixed/unseen diagnostic/game-review positions.
- Within each block rank candidate tasks by prerequisites, expected relevance, due status, confidence in weakness, novelty, and estimated effort; limit repeat of one concept and introduce some exploratory coverage.
- On approximately two days a week offer a deliberate rapid-game-and-review session instead of four separate study blocks, and schedule uncompleted lesson blocks onto the next study day. The weekly mix is adjustable based on real game volume.
- Default lesson order uses a verified dependency graph; avoid ML-trained recommendation models with sparse initial personal data.
- Start with a small baseline diagnostic. Unknown means unknown, not weak. Short re-tests can place a learner forward in a syllabus.
- A task source must have rights-cleared local content or link to official external course; if a link is unavailable offline, schedule a separate offline-available practice block and show new-learning deferred honestly.

## Memory
- Track decision-specific repetition events and use documented `ts-fsrs` current API (do not rely on stale API examples). Separate unassisted first attempts, review attempts, hints and optional user self-grades.
- Training tasks that require human understanding, e.g. chess plans, need a novel transfer check; high SRS recall alone cannot label them mastered.
- For puzzles use both skill/difficulty ability estimates and a failed-puzzle review queue; repeated puzzle success does not inflate unseen puzzle accuracy.
- Repertoire nodes are transposition-aware, but contexts and learner-side preferences remain identifiable. A sound alternative is not an automatic SRS failure unless an explicitly disclosed repertoire-recall mode is being tested.

## Adaptation v2 after enough data
- Estimate expected improvement per minute and uncertainty, penalize stale/ambiguous evidence, prioritize recurring errors and high-opportunity concepts, reserve curriculum exploration budget.
- Keep simple baselines, offline replay evaluations and policy versioning. Prove benefit against deterministic v1 before adopting complex bandit or predictive algorithms.
