"""Add engine evidence to the opening frequency book (public/packs/openings-lichess.json).

For every book position: the engine's first choice and its expected score, and the expected
score after each move that people actually play there. The app shows these numbers as
evidence when the learner records a repertoire move; the engine never chooses the move.

    uv run python -m trainer_pipeline.opening_evals            # all positions
    uv run python -m trainer_pipeline.opening_evals --min-games 200
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import shutil
import sys
import time

import chess
import chess.engine

from .opening_stats import OUT
from .puzzles import win_percent

NODES = 80_000
_engine: chess.engine.SimpleEngine | None = None


def _init(path: str):
    global _engine
    _engine = chess.engine.SimpleEngine.popen_uci(path)
    _engine.configure({"Threads": 1, "Hash": 32})


def _evaluate(item: tuple[str, list[str]]):
    key, ucis = item
    assert _engine is not None
    board = chess.Board(f"{key} 0 1")
    mover = board.turn
    info = _engine.analyse(board, chess.engine.Limit(nodes=NODES), multipv=1)[0]
    best = info["pv"][0]
    out = {"bestWp": round(win_percent(info["score"], mover), 1), "bestSan": board.san(best), "moves": {}}
    for uci in ucis:
        after = board.copy(stack=False)
        after.push(chess.Move.from_uci(uci))
        if after.is_checkmate():
            wp = 100.0
        elif after.is_game_over():
            wp = 50.0
        else:
            wp = win_percent(_engine.analyse(after, chess.engine.Limit(nodes=NODES), multipv=1)[0]["score"], mover)
        out["moves"][uci] = round(wp, 1)
    # The engine's own first choice is at least as good as any listed move at this budget.
    out["bestWp"] = max([out["bestWp"], *out["moves"].values()])
    return key, out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-games", type=int, default=0, help="only evaluate positions seen at least this often")
    ap.add_argument("--workers", type=int, default=max(1, (mp.cpu_count() or 2) - 2))
    args = ap.parse_args()
    engine_path = shutil.which("stockfish")
    if not engine_path:
        print("native Stockfish not found", file=sys.stderr)
        return 2
    book = json.loads(OUT.read_text())
    items = [(k, [m["uci"] for m in p["moves"]]) for k, p in book["positions"].items() if sum(p["n"]) >= args.min_games]
    with chess.engine.SimpleEngine.popen_uci(engine_path) as e:
        name = e.id.get("name")
    print(f"{len(items)} positions, {sum(len(u) for _, u in items)} moves, {name} @ {NODES} nodes, {args.workers} workers", flush=True)
    t0 = time.time()
    with mp.Pool(args.workers, initializer=_init, initargs=(engine_path,)) as pool:
        for n, (key, ev) in enumerate(pool.imap_unordered(_evaluate, items, chunksize=4), 1):
            p = book["positions"][key]
            p["bestWp"], p["bestSan"] = ev["bestWp"], ev["bestSan"]
            for m in p["moves"]:
                m["wp"] = ev["moves"][m["uci"]]
            if n % 500 == 0:
                print(f"  {n}/{len(items)} {time.time() - t0:.0f}s", flush=True)
    book["manifest"]["engine"] = {"name": name, "nodes": NODES, "positionsEvaluated": len(items), "minGames": args.min_games,
                                  "meaning": "wp = expected score (0-100, Lichess win% sigmoid) for the side making the move"}
    OUT.write_text(json.dumps(book, separators=(",", ":")))
    print(f"done in {time.time() - t0:.0f}s; {OUT.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
