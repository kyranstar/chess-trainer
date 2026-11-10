# Design review and release gates (2026-11-10)

Ratings are assessments of the **design**, not evidence that an implemented product passed. Score 1–5 and record limitations. Any score below 4 requires remediation before the associated functionality is promised.

| Axis | Design score | Current judgment | Mitigation / gate |
|---|---:|---|---|
| Curriculum & teachability | 4 | Structured prerequisite map, new-learning guarantee, unseen transfer | Validate with early real learner sessions and content-source audit |
| Human-written course quality | 3 | Strong memberships but no blanket rights to integrate lessons; actual catalog unverified | Phase 0 rights + lesson catalog audit; official links with explicit completion; no mirrored content |
| Practical coverage | 4 | Tactics, strategy, calculation, openings, endgames, play analysis | Validate concept coverage matrix and difficulty span |
| UX & course handoff | 4 | One-session flow with external-course return checks | Test return-to-app on iPhone; never claim automatic completion |
| Personalization | 4 | Prerequisite-led deterministic adaptation, explicit exploration | Demonstrate recommendations change for synthetic profiles; avoid false precision |
| Chess correctness | 4 | Mature rules, engine evidence, tablebase checks | Automated fixture validation, alternative solution checks |
| Performance measurement | 4 | Direct drill-down, denominators, uncertainty, independent transfer | Snapshot tests and sparse-data/coverage rules |
| Offline mobile reliability | 3 | IndexedDB and service worker are viable but local-only is not inherently durable | Airplane-mode tests + export/import + schema migrations + home-screen device testing |
| Privacy & cost | 4 | No required LLM or cloud compute; static hosting optional | Network capture and $0-cost test |
| Maintainability / compaction resilience | 4 | Source-controlled living documents and milestones | Independent clean-session recovery drill |
| Engine/AI analysis credibility | 4 | No generative teacher; conservative objective chess analysis | Bench against hand-labeled positions; expose unknowns |

## Major unresolved items
1. Identify sufficient rights-cleared human-written material for genuinely offline new lessons, or explicitly scope offline to drill/review and online to linked third-party lectures. Do not call this gap solved by installing an LLM.
2. Implement and test local export/restore and real iPhone offline reopening *before* relying on IndexedDB for irreplaceable history.
3. Verify library and tooling licenses before shipping; Chessground/Stockfish may impose GPL obligations if distributing an application. Keep dependency licensing notes.
4. Confirm source access and permitted use from Chess.com and Chessreps docs before writing adapters, especially anti-scraping and AI-use restrictions.

## Product release gates
- Content/legal: sourced/authorized, provenance complete, never third-party mirrored without authorization.
- Chess correctness: all exercises and lines legal, reference solutions verified; alternate sound moves handled correctly.
- Teachability: user can state objective, receive appropriate explanation and solve an unseen example.
- Curriculum: novel concept instruction available or accurately labeled linked/unavailable; no silent repetition-only substitution.
- Personalization: correct due reviews, different weak-skill profiles get different tasks, unknown remains untested.
- Analytics: all visible metrics traceable to test fixtures, definition and denominator; no misleading percentages.
- Mobile: iPhone-size UI, offline shell + packs, persistence, backup restore, service worker upgrade safe.
- Security/cost: no provider credentials needed, no required paid APIs, no cloud leakage by default.
- Build: typecheck, unit tests, integration tests, build, license check and manual smoke evidence documented.
