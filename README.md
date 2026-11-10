# Chess Trainer

A personal, offline-first chess coach for one learner (iPhone + Mac). It teaches concepts
from human-written sources, practises them on unseen positions, schedules review, and
reports only what the recorded attempts support.

Start with `docs/STATE.md` for what works today and what does not. The product contract is
in `CLAUDE.md`, `AGENTS.md` and `docs/`.

## Layout

| Path | What |
|---|---|
| `src/` | React + TypeScript PWA (Vite). `chess/` rules wrapper, `puzzles/`, `schedule/`, `learn/`, `metrics/`, `db/` (IndexedDB, backup), `games/` (fetching own games from Chess.com's public API, on-device analysis, game metrics), `engine/` (UCI wrapper), `ui/` |
| `public/engine/` | Vendored Stockfish 19 lite single-threaded WebAssembly build (GPL-3.0; see `PROVENANCE.md` there) |
| `content/` | Source registry, concept map, CC0 theme definitions, local lessons, engine evidence |
| `public/packs/` | Built offline packs: engine-verified puzzles and the opening frequency book (both from CC0 Lichess data) |
| `pipeline/` | Mac-side Python: puzzle pack, lesson specs and validator, opening statistics and evidence, own-game analysis |
| `e2e/` | Playwright tests against the production build |
| `docs/` | Contract, decisions, content inventory, audits, state |
| `data/` | Raw downloads and work files (git-ignored) |

## Commands

Node 22.23.1 (`nvm use`), Python via `uv`, native Stockfish on PATH for the pipeline.

```sh
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit tests (Vitest)
npm run build        # typecheck + production build with service worker
npm run e2e          # Playwright: iPhone-size WebKit + desktop Chromium, incl. offline
npm run check        # all of the above

cd pipeline
uv sync
uv run pytest                                        # puzzle semantics, lesson validation
uv run python -m trainer_pipeline.fetch_sources      # download + checksum public-domain texts
uv run python -m trainer_pipeline.lessons            # validate lessons, write engine evidence
uv run python -m trainer_pipeline.build_puzzle_pack  # needs data/raw/lichess_db_puzzle.csv.zst (~30 min)
uv run python -m trainer_pipeline.games --player YOUR_USERNAME ../data/my-games/*.pgn   # analyse your own games
```

The full command list, including the opening-book build, is in `docs/STATE.md`.

## Using it on an iPhone

Serve `dist/` over HTTPS (any static host), open it in Safari, Share → Add to Home Screen,
and open it once while online so the practice pack installs. After that it runs with no
network. Progress lives only in that Home Screen app's storage: use Progress → Download
backup to keep a copy and to move history between devices.

With a Chess.com username set (Progress → Your games), the app reads that player's public
ratings and games from Chess.com's public API whenever it is opened and analyses new games
on the device. That is the only outside service it contacts, and nothing is uploaded.

## Licence

GPL-3.0-or-later (the board and rules libraries and the bundled Stockfish engine are GPL). Bundled content: Lichess puzzle
data and theme definitions (CC0); excerpts from Edward Lasker, *Chess and Checkers* (1918,
public domain in the United States). Lessons on Chess.com, Chessreps and Lichess are linked,
never copied. See `docs/CONTENT_INVENTORY.md`.
