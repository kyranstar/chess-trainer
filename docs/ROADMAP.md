# Milestones and acceptance gates

## M0 — Source and content feasibility (blocker for course claims) — DONE 2026-11-10
Result: `docs/CONTENT_INVENTORY.md`, `docs/audits/`, `content/`. 29 concepts mapped; offline human-written lesson library is **not** complete (1 of 29) and is recorded as an open gap. Two rights questions are with the owner (`docs/STATE.md`).

- Audit human-written lesson sources, legal reuse, access modes and actual lesson URLs for beginner pathway. Verify Chessreps course access/possible authorized export without scraping.
- Map first 20–30 concepts to appropriate course links or rights-cleared local content; identify gaps and honestly plan linked-only instruction where necessary.
- Verify official Chess.com API/PGN path and terms, puzzle CSV semantics, chess libraries, license obligations and iOS PWA storage limitations.
- Produce real clickable curriculum prototype and content inventory. **Do not** mark offline human course library complete if only links are available.

## M1 — Usable vertical slice — BUILT 2026-11-10; device gate open
Acceptance status: PWA build + service worker ✔ (automated); mobile board, rules library ✔; local lesson flow and linked-course flow ✔; offline Lichess pack with engine-checked correctness ✔; attempts persist ✔; dashboard from real attempts ✔; export/import ✔; typecheck, tests, build, smoke ✔ (see `docs/STATE.md`). **Not yet done: install and airplane-mode restart on a real iPhone.**

- PWA install and launch, mobile chessboard, rules library, at least one complete learn→apply→test→review flow with rights-cleared/local fixture and linked-course flow.
- Offline Lichess practice pack, puzzle correctness, attempts persist, dashboard derives real metrics from attempts, explicit export/import.
- Airplane-mode restart on iPhone; typecheck, tests, build and smoke test pass.

## M2 — Principled curriculum
- Diagnostic, concept taxonomy/prereqs, vetted source catalog, lesson sequencing, local/linked course state, novel transfer tests, first 30 days of credible course plan.
- New-learning time protected, skip-tested prereqs, no false course completion.

## M3 — Opening repertoire
- Import permitted PGNs/Lichess studies; Italian/anti–Caro-Kann learning by position graph, transpositions, contextual explanations, sound alternatives vs bad moves, spaced decision drills.
- Engine checked test lines and import round trips; complete repertoire session offline.

## M4 — Local game analysis + real performance dashboard
- Chess.com game records from supported own-game import or compliant official access; native Mac Stockfish analysis, versioned results, conservative error labels and drill creation.
- Dashboard: rating per time control, game errors and exposure, unseen puzzle performance, curriculum/retention, drill-to-game recurrence; all with denominators/provenance.

## M5 — Advanced endgames, calculation and adaptive optimization
- Verified tablebase/theoretical endgame lessons; multi-ply calculation, active defense, strategic ideas; curriculum refinements grounded in assessment data.
- Reproducible baselines, controlled evaluation of scheduler changes, comprehensive regression fixtures.

## M6 — Optional private synchronization
- Only after durable local and export/restore experience. Versioned event sync with idempotency, conflict policy, no data loss and private account authentication.

## Change policy
Tasks must meet their own measurable acceptance gates. Scope may be simplified, but not by silently fabricating instructional quality or online/offline capability. Update `docs/STATE.md` at the end of each session.
