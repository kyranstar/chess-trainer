# Content provenance and legal-use policy

## Rights boundaries
- Chess.com/Chessreps premium courses: LINKS and user-controlled completion tracking only, unless a documented, authorized export or permission applies. Membership does not imply scraping, mirroring, bulk download, or reuse rights.
- Chess.com own game records: prefer official permitted exports or documented PubAPI public-game access with a legal-use review and rate limits. Respect AI-usage restrictions; never train a proprietary ML model from Chess.com course material or scrape protected lesson content.
- Lichess open puzzle database and relevant released database exports: CC0 as stated at https://database.lichess.org/ . Puzzle data is not the same as annotated/human-written instruction. A public Lichess Study's human-written annotation does **not** automatically inherit the puzzle DB's CC0 license.
- Lichess practice and Learn interfaces: use official links. Do not infer that a website's program source license automatically covers third-party course annotations or all written content.
- Steps Method: reference for progression; workbook/manual exercises are copyrighted and not bundled without license.
- Source links, identifiers, course titles, and user-entered notes may be stored as provenance; never bypass paywalls or membership controls.

## Source registry fields
`source_id, title, author, provider, url, source_type, permission_type(link|cc0|licensed|user-authored|public-domain-reviewed), license_url, license_notes, content_version, teaching_level, concepts, access_requirement, online_required, last_reviewed_at`.

## Lesson publishing gate
Before 'Ready for learning' status: human-written verified text or a linked external course; specific lesson objective; prerequisite match; legal content permission; worked/linked example; at least one unseen assessment; correct alternate solutions; sensible hint/feedback; reviewer and date. Drafts don't silently ship.

## Proposed source catalog (verify links, entitlements and levels in Phase 0)
- Chess.com Learn Path: https://www.chess.com/learn (linked, membership access varies).
- Chess.com beginner courses: https://www.chess.com/lessons/skill-level/beginner (linked).
- Chess.com coach study guides: https://www.chess.com/article/view/study-plan-directory (linked; rating-specific guidance, not automatically reusable text).
- Chessreps: https://www.chessreps.com/ (linked; opening course details provided by user).
- Lichess Practice: https://lichess.org/practice (linked; rights separately checked).
- Steps Method: https://www.stappenmethode.nl/en (reference, purchase optional, no bundled chapters).
- Lichess puzzle database: https://database.lichess.org/ (CC0 exercises).

## AI analysis policy
No generative AI required. Never generate teaching text with an LLM as production content by default. Stockfish and tablebases support concrete validation and verifiable PVs; they do not provide psychological explanations. Optional future local LLM may produce non-authoritative drafts behind an explicit opt-in and human review gate, with zero impact on correctness or assessment.

## Known teaching-content gap
The project cannot guarantee a fully offline, comprehensive **human-written course library** without identifying appropriately licensed texts or producing human-reviewed original material. This is a Phase 0 blocking discovery and a labeled product limitation; do not quietly replace missing text with generated material.
