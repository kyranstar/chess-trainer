# Project state

Updated: 2026-11-10
Status: DESIGN HANDOFF — no implementation is claimed
Branch/commit: Not yet established

## Done
- User requirements captured in `docs/USER_PROFILE.md`.
- Product/course architecture, source/rights boundaries, schema, metrics, learning model, quality review and roadmap documented.
- Initial risks and acceptance tests identified.

## Not yet done
- No code exists in this starter kit, no Chess.com account linked, no subscription course imported, no real games analyzed, no lesson data validated, no iPhone test run.
- Source catalog has suggested official references, not an audited authorized in-app lesson library.

## First implementation task
Run M0 content feasibility: verify exact human-written course resources and their access modes; produce `docs/CONTENT_INVENTORY.md` with course URLs, author, target concept, availability/rights, access mode and teaching-quality rubric. Then implement M1's tiny end-to-end vertical slice.

## Commands (after code scaffold exists)
Define actual package scripts in package.json and record: install, unit tests, typecheck, build, local preview, fixture generation, app export/restore test. Do not invent success output.

## Open risk
Full offline human-written teaching library is **not** solved; official protected courses may remain external links. Mobile progress is per-device until synchronization is built. Verify rights and iOS persistence behavior.

## Next handoff record format
- Date, branch, exact commit, dirty files
- Implemented and user-visible
- Tests and their actual outputs
- Unresolved problems and failing tests
- Updated decisions and external sources
- Single highest-priority next task + exact reproduction commands
