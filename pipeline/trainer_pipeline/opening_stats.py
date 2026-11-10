"""Move frequencies by rating band from a Lichess monthly game dump (CC0).

The Lichess opening explorer API needs an OAuth token (since 2026-03), and the app must not
depend on an account, so frequencies are computed here on the Mac by streaming part of a
monthly dump. Nothing but the aggregated counts is kept.

    curl -sL -r 0-1499999999 https://database.lichess.org/standard/lichess_db_standard_rated_2026-10.pgn.zst \\
      | zstd -dc 2>/dev/null \\
      | uv run python -m trainer_pipeline.opening_stats --month 2026-10 --bytes 1500000000

What is counted: rated Blitz, Rapid and Classical games (no Bullet, no Correspondence, no
variants, both ratings present, at least 8 plies). Every game contributes to the tree for
its first 4 plies; games inside the learner's repertoire families (ROOTS) contribute to
DEPTH plies. Each move is banded by the rating of the player who made it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import chess

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "packs" / "openings-lichess.json"

BANDS = [0, 800, 1000, 1200, 1400, 1600, 1800, 2000]  # lower bounds; last is 2000+
SHALLOW = 4
DEPTH = 14
#: SAN prefixes below which the tree is counted to DEPTH (White: Italian complex and Caro-Kann).
ROOTS = [("e4", "e5"), ("e4", "c6")]
#: A branch of the move tree is followed only while it has this many games.
TRIE_MIN_GAMES = 40
#: A position (after merging transpositions) and a move are kept only with this many games.
MIN_POSITION_GAMES = 150
MIN_MOVE_GAMES = 15

_COMMENT = re.compile(r"\{[^}]*\}")
_NUM = re.compile(r"\d+\.+")
_SUFFIX = re.compile(r"[?!]+")
_SPEEDS = ("Blitz", "Rapid", "Classical")


def band_index(rating: int) -> int:
    i = 0
    for j, lo in enumerate(BANDS):
        if rating >= lo:
            i = j
    return i


def first_moves(movetext: str, limit: int) -> list[str]:
    head = _COMMENT.sub(" ", movetext[: 110 * limit])
    head = _SUFFIX.sub("", _NUM.sub(" ", head))
    out = []
    for tok in head.split():
        if tok in ("1-0", "0-1", "1/2-1/2", "*") or "{" in tok or "}" in tok or "[" in tok:
            break
        out.append(tok)
        if len(out) == limit:
            break
    return out


class Node:
    __slots__ = ("counts", "children")

    def __init__(self):
        self.counts = [0] * len(BANDS)
        self.children: dict[str, Node] = {}


def scan(stream, max_games: int | None) -> tuple[Node, dict]:
    root = Node()
    stats = {"games": 0, "used": 0, "bySpeed": {s: 0 for s in _SPEEDS}, "skipped": 0}
    event = white = black = None
    variant_ok = True
    for line in stream:
        if line.startswith("[Event "):
            event, white, black, variant_ok = line, None, None, True
        elif line.startswith("[WhiteElo "):
            white = line[11:-3]
        elif line.startswith("[BlackElo "):
            black = line[11:-3]
        elif line.startswith("[Variant ") and "Standard" not in line:
            variant_ok = False
        elif line.startswith("1. "):
            stats["games"] += 1
            speed = next((s for s in _SPEEDS if event and f"Rated {s} " in event), None)
            if not speed or not variant_ok or not (white and black and white.isdigit() and black.isdigit()):
                stats["skipped"] += 1
            else:
                moves = first_moves(line, DEPTH)
                if len(moves) >= 8:
                    stats["used"] += 1
                    stats["bySpeed"][speed] += 1
                    deep = any(tuple(moves[: len(r)]) == r for r in ROOTS)
                    bands = (band_index(int(white)), band_index(int(black)))
                    node = root
                    for ply, san in enumerate(moves[: DEPTH if deep else SHALLOW]):
                        child = node.children.get(san)
                        if child is None:
                            child = node.children[san] = Node()
                        child.counts[bands[ply % 2]] += 1
                        node = child
            if max_games and stats["games"] >= max_games:
                break
    return root, stats


def build_positions(root: Node) -> tuple[dict, int]:
    """Replay the kept part of the tree with python-chess and merge transpositions."""
    positions: dict[str, dict] = {}
    illegal = 0
    stack = [(root, chess.Board())]
    while stack:
        node, board = stack.pop()
        total_here = sum(sum(c.counts) for c in node.children.values())
        if total_here < TRIE_MIN_GAMES:
            continue
        key = " ".join(board.epd().split(" ")[:4])
        entry = positions.setdefault(key, {"n": [0] * len(BANDS), "moves": {}})
        for san, child in node.children.items():
            try:
                move = board.parse_san(san)
            except ValueError:
                illegal += 1
                continue
            m = entry["moves"].setdefault(move.uci(), {"uci": move.uci(), "san": board.san(move), "n": [0] * len(BANDS)})
            for i, c in enumerate(child.counts):
                m["n"][i] += c
                entry["n"][i] += c
            nxt = board.copy(stack=False)
            nxt.push(move)
            stack.append((child, nxt))
    out = {}
    for key, entry in positions.items():
        moves = sorted(entry["moves"].values(), key=lambda m: (-sum(m["n"]), m["uci"]))
        kept = [m for m in moves if sum(m["n"]) >= MIN_MOVE_GAMES]
        if sum(entry["n"]) >= MIN_POSITION_GAMES and kept:
            out[key] = {"n": entry["n"], "moves": kept}
    return out, illegal


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True)
    ap.add_argument("--bytes", type=int, default=0, help="compressed bytes streamed (for the manifest)")
    ap.add_argument("--max-games", type=int, default=0)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    t0 = time.time()
    root, stats = scan(sys.stdin, args.max_games or None)
    positions, illegal = build_positions(root)
    manifest = {
        "id": "openings-lichess",
        "version": f"{args.month}.1",
        "schema": 1,
        "buildDate": time.strftime("%Y-%m-%d"),
        "source": {
            "title": "Lichess standard rated games",
            "url": f"https://database.lichess.org/standard/lichess_db_standard_rated_{args.month}.pgn.zst",
            "license": "CC0-1.0",
            "month": args.month,
            "compressedBytesRead": args.bytes,
            "note": "The first part of the month's file, in time order; not a random sample of the month.",
        },
        "filters": {
            "speeds": list(_SPEEDS), "rated": True, "variant": "Standard", "minPlies": 8,
            "bandedBy": "rating of the player making the move",
            "depthPlies": DEPTH, "shallowPlies": SHALLOW, "deepUnder": [" ".join(r) for r in ROOTS],
            "minPositionGames": MIN_POSITION_GAMES, "minMoveGames": MIN_MOVE_GAMES, "minBranchGames": TRIE_MIN_GAMES,
        },
        "bands": BANDS,
        "games": stats,
        "positions": len(positions),
        "unparsedMoves": illegal,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"manifest": manifest, "positions": positions}, separators=(",", ":")))
    print(json.dumps(manifest["games"]), f"{len(positions)} positions, {args.out.stat().st_size / 1e6:.2f} MB, {time.time() - t0:.0f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
