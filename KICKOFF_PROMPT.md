# Claude implementation kickoff — Personalized Chess Trainer

You are the lead product engineer, chess pedagogy architect, and verification lead for a single-user chess training PWA. This project must produce a real usable product, not a generic mockup. Your authoritative project contract is attached in this starter kit. Start by reading `CLAUDE.md`, `AGENTS.md`, `docs/STATE.md`, `docs/PRODUCT.md`, `docs/CONTENT_POLICY.md`, `docs/QUALITY_REVIEW.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/LEARNING_MODEL.md`, `docs/METRICS.md`, `docs/DATA_MODEL.md`, `docs/TEST_PLAN.md`, `docs/DECISIONS.md` and `docs/USER_PROFILE.md`.

## Desired product
Build an iPhone-first, offline-capable chess coach for one person, using the user's initial Chess.com ratings (Daily 772, Rapid 457, Blitz 423, Puzzles 1617), 30-minute daily target, Italian opening experience and developing anti–Caro-Kann knowledge. Primary objective is to learn new principled chess skills and improve real rated-game outcomes. The daily core is **7 minutes review, 9 minutes new human-written education, 8 minutes applied training, 6 minutes independent test**. The allocation applies to study days; plan approximately two deliberate play-and-review days per week when feasible, keeping new learning protected over the week. The allocation is adjustable but new concepts must not be crowded out by endless review.

## Content and trust constraints
Prefer established human-written chess lessons: Chess.com's own Learn Path and beginner courses, Chessreps opening courses, Lichess official practice, and optional Steps Method books. Paid memberships do not imply bulk download/republishing rights. Do not scrape, reverse engineer, copy or mirror third-party protected courses. Link to official content, manually record lesson completion and independently quiz the user when source integrations are unavailable. Only embed vetted rights-cleared content. Lichess open puzzle data is usable as CC0 practice data, not a substitute for high-quality instruction.

There is no budget or requirement for generative AI. Do not use LLM-written instructional content, unreviewed heuristics or engine 'commentary' as authoritative teaching. Native Stockfish and tablebases can validate concrete calculations; show evidence and uncertainty. Distinguish objectively bad moves from reasonable alternatives to repertoire moves. Correctness, pedagogy and legal content rights outrank breadth or superficial polish.

## Main UI
Four tabs: Today (one-tap 30-minute session), Learn (prerequisite-based curriculum and accessible course links), Practice (puzzles, openings, endgames, calculation and personal mistakes), Progress (real ratings, analyzed game errors, source positions, independent skills, retention and transfer). On an iPhone, a board must be comfortable to manipulate, lessons concise, navigation clear, and transition back from external courses explicit.

## Architecture
React/TypeScript/Vite, appropriate mature licensed board and chess rules libraries, Dexie/IndexedDB and service worker, curated offline Lichess puzzles, optional single-threaded lite Stockfish WASM. A Mac-local Python/python-chess/native Stockfish/SQLite pipeline imports **permitted** PGNs, analyzes games and builds versioned static offline packs. Host static PWA and rights-cleared content packs for free if helpful, but store private progress locally. Sync is explicitly later, not promised in the MVP. Export/import with schema migration tests is mandatory from the earliest milestone. Never require a paid API, cloud LLM or running Mac to practice.

## Personalization and analytics
Start with a concise baseline diagnostic, explicit untested state, concept prerequisites, deterministic task selection and FSRS review scheduling. Protect learning time and use unseen examples to measure real mastery; do not confuse puzzle-rating level with over-the-board playing strength. Import the user's own Chess.com game records through approved official mechanisms or manual PGN. Analyze local games with versioned engine settings. Show rating by time control, major-errors per analyzed decision, verified threats missed, unseen puzzle performance, opening preparedness, theoretical endgames, retention and training-to-game transfer. Every metric needs source evidence, period, sample size, exclusions and an honest uncertainty state. Drilling down must show the actual games/positions. Do not assert causal skill weaknesses solely from engine eval swings.

## Required execution process
1. Reconcile repository status with `docs/STATE.md` and summarize the current milestone.
2. **Run Phase M0 content feasibility first.** Audit actual official course URLs, legal access and levels, mapping at least 20–30 core concepts to available linked or rights-cleared human-written content. Save `docs/CONTENT_INVENTORY.md`. Mark any truly offline human-course gap honestly; do not invent a course library or bypass licensing limits.
3. Build M1 as a complete minimal vertical slice: one course-link/verified local lesson → independent practice → review record → meaningful dashboard; functioning mobile PWA and offline puzzle pack with tests, persisted attempts, backup/restore.
4. Implement successive milestones from `docs/ROADMAP.md`, running their explicit quality gates and automated tests, including chess legality, offline persistence, lesson rights, data accuracy and learning efficacy checks.
5. Keep all changes tightly scoped, tested and visible. Do not ship placeholder metrics, fake data presented as real, fictitious course annotations, dead buttons or architecture disconnected from the actual learner flow.
6. At every milestone and before ending a session, update `docs/STATE.md`, `docs/ROADMAP.md`, relevant specifications and ADRs with exactly what changed, what was verified, remaining risks and the next executable task. Maintain this so any future Claude session after compaction can reconstruct the project without conversation memory.

## Autonomy and decisions
Use the documented constraints rather than repeatedly asking the user routine implementation questions. If a new choice would materially change rights, privacy, spending, training philosophy or core UX, document the tradeoff and request a decision. Otherwise choose a simple maintainable option, write an ADR and proceed.

## Definition of success
A real learner can open the iPhone PWA, work through a coherent new concept sourced from a verified human-written course, apply it to new chess positions, finish a 30-minute session offline whenever all required local materials are available, see truthful personalized metrics, and revisit relevant mistakes. No data loss, fabricated analysis, impermissible course reuse, pay-to-run dependence, or reliance on chat memory.

Begin now with M0 and the smallest user-visible M1 slice. Do not stop at generating a plan. Use the supplied repo documents as durable ground truth, update them as you implement, and provide actual test/build evidence when reporting progress.
