# Proposed storage schema (conceptual; refine with migration tests)

## Durable records
- `LearnerProfile(id, version, time_controls, training_minutes, preferences, imported_from)`.
- `Concept(id, taxonomy_path, objective, prereqs[], assessment_policy, content_refs[], revision)`.
- `ContentSource(id, provider, title, author, url, permission, license, version, access, verification)`.
- `Lesson(id, concept_id, source_id, mode: linked|local, duration, prerequisites[], license_state, authored_feedback_refs[], version)`.
- `Exercise(id, concept_ids[], source_id, source_position_fen, side_to_move, setup_moves[], accepted_moves_or_policy, solution_pv[], difficulty, verification_metadata, revision)`.
- `RepertoirePosition(key, canonical_fen, transposition_group)` and `RepertoireDecision(id, position_key, learner_side, response_edges[], acceptable_alternatives[], rationale_refs[], contexts[], reviewer_status)`.
- `TrainingAttempt(uuid, device_id, session_id, exercise_id, content_version, timestamp, first_move, attempt_sequence, hints, time_elapsed, unassisted_success, evaluation, scheduler_version)` (append-only).
- `ReviewState(item_id, algorithm_version, derived_state, last_event_uuid, next_due_at)` (rebuildable from attempts). Since review policy v3 (ADR-052) a position from the learner's own games is one item whichever exercise asked it: `item_id` is `pos:<game>:<ply>` and `ask` holds the exercise id it was last answered as; every other item keeps its exercise id.
- `Game(id, source, source_url, pgn, time_control, white, black, result, player_side, date, source_hash, imported_at)`.
- `GameAnalysis(game_id, engine_version, engine_parameters, positions_covered, analyzed_at, blunder_events[], tactical_opportunities[], evidence_id, analysis_version)`.
- `SkillObservation(uuid, concept_id, attempt_or_game_id, evidence_type, outcome, confidence, observed_at, skill_model_version)`.
- `CurriculumProgress(concept_id, stage, completed_lessons[], unseen_assessment_ids[], version)`.
- `ContentPack(id, schema_version, source_manifest, content_hash, bytes, build_date, source_licenses[])`.
- `BackupManifest(schema_version, exporter_version, export_time, item_counts, content_hashes)`.

## Invariants
- New attempts are immutable; late sync or a retry cannot create duplicate UUIDs.
- Course link clicks are not completion evidence. Completion is user marked, with an independent quiz where possible.
- Keep source records even when a content pack is later removed; do not silently delete user history.
- Puzzle FEN and moves are validated; for Lichess puzzle CSV, the initial supplied move is opponent setup before solving—verify the exact source schema and test implementation.
- Chess end positions, promotions, threefold repetition and other rules delegated to the mature chess library.
- For an imported PGN, exact source identity plus content hash deduplicates repeated archive imports.
- Dashboard cards are derived from versioned source records; record analysis coverage and exclude unanalysed games from denominators.
- Local time zone and UTC timestamps retained; offline session completion is not dependent on clock synchronization or backend connectivity.
