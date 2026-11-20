"""Opening names by position from the Lichess `chess-openings` dataset (CC0-1.0).

    uv run python -m trainer_pipeline.opening_names

Reads a.tsv to e.tsv at a pinned commit (downloaded once into data/raw/chess-openings/ and
checked against their SHA-256), plays each line, and writes public/packs/opening-names.json:
the position after each named line (the app's `positionKey`: placement, side to move,
castling, en passant only when a capture is legal; the dataset's EPD) and its name. Names
only: the dataset holds no commentary, and none is added. A game's opening is the deepest
named position it reaches (the dataset's own advice), so transpositions are named too.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

import chess
import chess.pgn

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "data" / "raw" / "chess-openings"
OUT = REPO / "public" / "packs" / "opening-names.json"

REPOSITORY = "https://github.com/lichess-org/chess-openings"
COMMIT = "3ba6b20d31b2e6125cb0e6a2e792f400717d9d39"
# The files at COMMIT, as first downloaded and checked on 2026-11-20. A different download is an error.
SHA256 = {
    "a.tsv": "3282e4c9155289a29224f9a85fba0decb46efa35c2fa5e39662d2ac48fb0f793",
    "b.tsv": "2744a3890879bd9dce79093147fe5b6c3a9d9d42a3388af698e67b6829be1c48",
    "c.tsv": "447bbd4b15d68067b150faf12bf66aa14b18582cf80d736aaa7c0081131806ef",
    "d.tsv": "1cf4057a8aece94f27bb3f278ad410ee2844831a642364eeceaafa091dbcceda",
    "e.tsv": "48c6f6645b031a5937c8386839debab0e2e48837251687ba1afb6369677f8546",
}


def fetch(name: str) -> bytes:
    path = RAW / COMMIT[:12] / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/lichess-org/chess-openings/{COMMIT}/{name}"
        req = urllib.request.Request(url, headers={"User-Agent": "chess-trainer-pipeline/0.1"})
        with urllib.request.urlopen(req, timeout=60) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def position_key(board: chess.Board) -> str:
    """The app's positionKey (src/chess/rules.ts): the first four FEN fields, en passant only if legal."""
    return " ".join(board.fen(en_passant="legal").split(" ")[:4])


def read_rows(text: str) -> list[tuple[str, str, str]]:
    rows = []
    lines = text.splitlines()
    header = lines[0].split("\t")
    assert header[:3] == ["eco", "name", "pgn"], header
    for line in lines[1:]:
        if not line.strip():
            continue
        eco, name, pgn = line.split("\t")[:3]
        rows.append((eco, name, pgn))
    return rows


def key_of(pgn: str) -> str:
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None and not game.errors, pgn
    board = game.board()
    for move in game.mainline_moves():
        board.push(move)
    return position_key(board)


def build(texts: dict[str, str]) -> dict:
    """{names: [...], positions: {positionKey: index into names}}."""
    names: list[str] = []
    index: dict[str, int] = {}
    positions: dict[str, int] = {}
    for file in sorted(texts):
        for _eco, name, pgn in read_rows(texts[file]):
            key = key_of(pgn)
            if name not in index:
                index[name] = len(names)
                names.append(name)
            # The first row for a position keeps it.
            positions.setdefault(key, index[name])
    return {"names": names, "positions": positions}


def main() -> int:
    texts: dict[str, str] = {}
    digests: dict[str, str] = {}
    for name, want in SHA256.items():
        raw = fetch(name)
        digests[name] = hashlib.sha256(raw).hexdigest()
        if digests[name] != want:
            print(f"MISMATCH {name} {digests[name]} (expected {want})")
            return 1
        texts[name] = raw.decode("utf-8")
    data = build(texts)
    pack = {
        "manifest": {
            "id": "opening-names",
            "version": COMMIT[:12],
            "schema": 1,
            "buildDate": date.today().isoformat(),
            "source": {
                "title": "Lichess chess-openings (opening names)",
                "url": REPOSITORY,
                "commit": COMMIT,
                "license": "CC0-1.0",
                "files": digests,
                "note": "Names and the moves that reach them only; no commentary.",
            },
            "counts": {"names": len(data["names"]), "positions": len(data["positions"])},
        },
        **data,
    }
    OUT.write_text(json.dumps(pack, separators=(",", ":"), ensure_ascii=False) + "\n")
    for k, v in digests.items():
        print(f"{k} sha256 {v}")
    print(f"{len(data['names'])} names, {len(data['positions'])} positions -> {OUT.relative_to(REPO)} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
