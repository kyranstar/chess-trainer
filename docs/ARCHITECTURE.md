# Offline-first technical architecture

## App
- React + TypeScript + Vite PWA, responsive and iPhone-first.
- Chessground or suitably licensed and integrated equivalent for touch board; chess.js or chessops as *single authoritative* rules library (confirm board library and rules-library integration and licenses).
- Dexie/IndexedDB for attempts, user profile, due reviews, imported games metadata, skill observations, dashboard cache, content pack manifest and import/export events.
- Service worker with versioned app-shell and available offline packs; never cache protected membership pages or credentials. Display pack size and availability.
- Engine: optional single-threaded lightweight Stockfish WASM for *local drill checking* and small analysis. Avoid CPU-heavy background engine during daily sessions on battery.

## Mac preparation pipeline
- Python + python-chess + locally installed native Stockfish + SQLite + reproducible scripts for official game PGN import, engine analysis, puzzle source processing, vetted exercise generation and static offline content-pack assembly.
- Keep provenance, engine metadata, checksums and build manifest for every pack. Download big public datasets on Mac only; ship filtered curated packs to iPhone.
- Avoid connecting iPhone to Mac at runtime. Publish rights-cleared static packs to optional free static hosting or import packs manually.

## Initial deployment & data flow
- Hosted HTTPS static PWA (free static hosting) or Mac localhost for development. Hosting an app shell is distinct from storing user training data remotely.
- Initial progress is local **per device**. Export a self-contained versioned backup file; import on Mac or phone. No cross-device live sync promise until later.
- Offline content must be downloaded once on Wi-Fi and verified via airplane-mode acceptance test.
- No secrets, premium account credentials, or private progress uploaded to static hosting.

## Later optional sync
- Cloudflare Worker + D1 or similarly low-cost backend; privacy review before adoption; append-only client-generated event IDs, idempotent writes, cursors, deterministic conflict policy, proper auth and TLS. Local-first operations never block on network.

## Storage reliability
- Request persistent storage when supported, but treat browser storage as potentially evictable. Backups and recovery are mandatory; encourage device-local Files/iCloud backup export. Verify PWA installed vs Safari behavior on an actual iPhone.
- Schema version and reversible/migration-tested upgrade path. Offline packs may be replaced; irreplaceable user attempts may not.

## Repertoire graph
- Node key: board placement, side to move, castling rights, **legally relevant** en passant status; exclude move counters. Preserve transposed lines and source contexts, white/black intention, multiple accepted sound moves, errors and assessments per decision.
- Move edges: UCI/SAN, source and commentary provenance, engine checks, opponent encounter frequencies if data source permits, pedagogical reason and review scheduling state.

## Test matrix
Desktop Safari/Chrome; iOS Safari Home Screen PWA; offline/cold reopening; slow connection; app update with existing data; phone rotation; keyboard/touch accessibility; service worker update; failed pack download; IndexedDB unavailable/quota errors; export/import hash verification; engine not available. API integration tests use fixtures and mocks; no cloud dependency.
