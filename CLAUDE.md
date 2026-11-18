# Chess Trainer — Claude session contract

Read `AGENTS.md`, `docs/STATE.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, and the currently relevant design specification before editing code. These files, not conversation memory, are authoritative. Resolve discrepancies in the decision log; don't silently overwrite decisions.

## On every session
0. **Before anything else, whatever was asked: look for what the owner flagged.** Run `scripts/fetch-practice.sh && node scripts/flags.mjs`. It pulls the latest backup copy from his phone and lists the positions he marked with the flag in the run bar (ADR-059), each with what his screen said. For every flag listed: look at the position and at what the app showed him (deep engine search, `tools/audit`), tell him what you found at the start of your answer, fix it if it is a defect, and mark it with `node scripts/flags.mjs --done <id> "<note>"`. A flag is a request, not a hint. If the fetch fails (no `gh` access, no copy yet), say so in your answer and carry on. Flags and the backup stay under `data/` (git-ignored): the repository is public and they hold his games.
1. Identify git branch, commit, dirty state, executable project status, and current milestone. Reconcile `docs/STATE.md` with the repository.
2. Read the active milestone's acceptance tests and relevant content/legal restrictions.
3. State the smallest useful vertical slice and its verification steps; then implement it.
4. Run tests, type checks, builds and, for UX changes, manual iPhone-size/browser tests. Record actual commands and results.
5. Update `docs/STATE.md`, roadmap acceptance status, design docs when decisions change, and ADRs when architectural changes occur.
6. Leave the repository in a reproducible state: changed files, passing/failing checks, known issues, next explicit task. Do not hide failing tests or claim unverified success.

## Non-negotiable product invariants
- One user, iPhone and Mac, 30 minutes/day by default; offline-first PWA, local-only privacy by default, no mandatory paid API, hosting optional/free if used.
- Real new learning each day, from rights-cleared human-authored content; avoid an endless-only-review experience.
- Chess.com/Chessreps membership content is LINKED, not mirrored; imports require permitted exports or explicit permission. Never scrape, bypass controls, or fabricate course content.
- No LLM in the teaching, content-labeling, correctness, or feedback critical path. Engine output is evidence for concrete positions, not a substitute for an instructor.
- Preserve correct chess rules: all legal moves, check, castling, en passant, underpromotion, draw conditions; never score a sound non-book move as objectively wrong.
- Show sample size, time control, time window and confidence/coverage with derived metrics; don't invent ability scores.
- All attempts and learning events persist locally, survive restart, and can be exported/restored before cloud sync exists.
- New data or app versions never silently destroy progress; test migration and backup/restore.

## Implementation process
Build end-to-end slices, not placeholder pages. Verify the lesson-to-quiz-to-daily-session-to-dashboard loop with seeded fixture data. Use pinned versions. Keep external source access behind adapters and respect documented rate limits. Treat source failures and licensing uncertainty as explicit product states. Do not quietly substitute unreviewed AI-generated curriculum.

## Compaction handoff
Maintain `docs/STATE.md` after each durable milestone; it must contain branch/commit, implemented behavior, verification evidence, blockers, next slice and exact local commands. Any new Claude session can rebuild context solely from this repository.
