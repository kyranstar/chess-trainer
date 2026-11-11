# Test plan and quality gates

## Rules and puzzles
- Parse and replay FEN/PGN and all source lines with mature rules engine; make/fork/undo, legal promotion options, castling through check rejected, en passant, repetition, stalemate, checkmate, legal move alternatives.
- Lichess puzzle source: apply source-specific setup move first when required, verify side to solve, enumerate accepted chess-equivalent continuations where appropriate, preserve source puzzle ID.
- Endgame fixture: tablebase exact result before/after each reviewed move; handle underpromotions and multi-solution draws/wins.
- Repertoire transpositions give same canonical position under different legal move orders; maintain correct instructional source contexts.

## Learning pipeline
- Diagnostic with insufficient evidence shows Untested, not 0% mastery.
- New-learning budget remains protected despite review backlog.
- Linked course opened ≠ completed; explicit manual completion and independent assessment are distinct records.
- Failed and successful first attempts, hints and repeated attempts have correct labels; delayed review doesn't inflate fresh-solving metric.
- Review schedule deterministic under fixed time and replayable logs; version change preserves source events.

## Game analysis & metrics
- Import same PGN twice is idempotent, including different encodings and archive refreshes.
- Analyze engine fixture with perspective-consistent evaluations, reproducible engine metadata, explicit coverage and no ungrounded causal labels.
- Metric tests use fixture game data: major-error denominator, missing clocks, mismatched time controls, excluded unanalyzed games, low n, WDL perspective, engine-version changes.
- Every dashboard card shows sample size/period/scope and opens exactly the source games/attempts underlying the aggregate.

## Mobile/reliability
- iPhone installed PWA loads offline with previously downloaded pack; imported answers survive force quit/reopen and update.
- No mandatory remote network requests during a 30-minute session. Offline linked courses clearly unavailable; practice fallback continues.
- Export full user-owned data to JSON/ZIP with schema version; reimport into clean device reproduces attempts, review due dates and dashboard derived values.
- Corrupted import shows error and does not damage existing data; migrate old schema successfully.
- Navigation, board taps, voiceover labels, color contrasts, move feedback, portrait/landscape; avoid excessive scrolling for main session.
- Exercise layout (ADR-051, `e2e/layout.spec.ts`): the board's place and size are the same through question, wrong move, replay, solution and the next position; the main button is in one place; nothing scrolls while a position is being asked; the flip control in the bar turns the board. The churn suite starts watching for unwanted movement only once a line that plays itself has come to rest.

## Cost/security
- Network capture verifies no personal data uploaded in local-only mode. No third-party credential collection, logs sanitized, HTTPS for static hosting.
- App builds and tests in clean workspace with no cloud credentials, API keys or paid accounts.
