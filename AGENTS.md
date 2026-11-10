# Permanent engineering and educational quality standards

## Product decisions
- The objective is improvement in *real games* through a systematic course, practice and feedback loop; the objective is not maximizing streaks, puzzle counts or time spent.
- Product must teach new concepts regularly and test retention on unfamiliar positions, not just replay solved exercises.
- For the user's current ratings (Daily 772, Rapid 457, Blitz 423, Chess.com Puzzles 1617), begin with a diagnostic, not assumptions about proficiency. Puzzle and game ratings are not interchangeable.
- Treat Rapid and Daily as distinct cohorts; Blitz performance is valuable but noisy and not the sole optimization target.

## Chess integrity
- Use a mature chess library as the source of truth for legality, FEN, SAN/PGN, castling, promotions, draw rules and repetition; do not implement your own rules engine.
- Test position orientation, import/export round trips, tablebase game outcomes, alternative valid tactical solutions, and chess puzzle 'opponent setup move' semantics.
- For a puzzle, accept any verifiably equivalent winning/checkmating move where multiple answers exist, with an explicit policy for ambiguous exercises.
- Engine evaluation and error classification must record engine version, settings, analysis depth/nodes, position, point of view, and reproducible evidence. Never equate a centipawn swing with a definitive psychological or conceptual error.

## Teaching and content
- Every curriculum item must have a source or author, revision, license/permission, learning objective, prerequisites, and valid assessment(s).
- Distinguish source *link* (course stays on provider site) from rights-cleared *local content* (app can store and render). No extraction or paraphrase of protected lessons into a substitute course.
- New lessons only become active after passing the content quality gate: factual correctness, teachability, level appropriateness, prerequisites, concrete transfer task, useful feedback and provenance.
- No invented instructional facts, synthetic citations, or unverified engine-based claims. An unsupported position is 'needs review', not a published teaching example.

## UX and reliability
- One-tap resume for today's session. Four clear destinations: Today, Learn, Practice, Progress. Users can see why a task is scheduled and replace it if needed.
- When a linked course opens in another app/site, show an honest return/complete/check-understanding flow; don't claim to auto-observe partner-platform completion.
- Mobile touch targets, accessible contrast, board coordinates, flip option, undo only where pedagogically appropriate, no forced hints, clear explanation before/after according to lesson policy.
- Offline available content, attempts, review scheduler and dashboards must work with no network and no local Mac worker. Linked protected courses may be unavailable offline; label them clearly.
- Every IndexedDB schema migration is tested against a real previous schema. Explicit backup/export and restore are required before significant user data accumulates.

## Measurement
- Immutable practice attempt and game-analysis records; separate observed values, inferred labels and unsupported hypotheses.
- Cohort filters, sample-size/uncertainty badges, analysis coverage, definitions and drill-down provenance for every game-quality metric.
- Avoid scalar 'overall mastery' and unexplained percentages. Repeated-item success is not generalizable to unseen-item skill.
- Review policies are versioned. A change to scheduling algorithm must never retroactively corrupt history.

## Security and cost
- No credential harvesting, membership cookies, paid API keys or private user data in source control or remote logging.
- Optional future sync needs conflict-safe append-only event identity, retries, idempotency, authentication, encryption in transit, and exportability.
- Test plan must be runnable locally without cloud credentials or hosted endpoints.
