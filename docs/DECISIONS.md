# Decision log

## ADR-001 Course-first, not AI-first — accepted 2026-11-10
Use established human-written courses as the primary means of teaching new concepts. There is no generative LLM required or trusted as a correctness/education authority. Engine analysis supports concrete evaluations only.

## ADR-002 Protected-course link strategy — accepted 2026-11-10
Chess.com and Chessreps memberships provide access within the providers' interfaces. Without permission or authorized exports, link out and track completion/independent checks; do not scrape or mirror copyrighted courses. The cost is weaker integrated/offline lessons; mitigate with rights-cleared materials and explicit UX.

## ADR-003 Offline-first data, delayed sync — accepted 2026-11-10
Installable iPhone PWA with IndexedDB local progress; Mac native batch engine. Optional static hosting may deliver app shell and rights-cleared packs but cannot receive personal progress in phase 1. Explicit backup/restore is non-negotiable.

## ADR-004 Measurable performance — accepted 2026-11-10
Display separate ratings, unseen practice, reproducible game error metrics, concept mastery and cross-context transfer with denominators and source drill-down. Don't combine them into an arbitrary skill number.

## ADR-005 Deterministic scheduler first — accepted 2026-11-10
Use prerequisites, transparent priorities and memory scheduler; only introduce statistical personalization when sufficient real evidence exists, preserving unknown/uncertain states.

## ADR-006 Scope limited to one learner — accepted 2026-11-10
No login required initially, no payment system, no multiplayer/community, no shared cloud infrastructure. Private, simple, maintainable code wins over extensibility theater.
