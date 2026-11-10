"""Helpers for writing lesson specs (pipeline/lesson_specs/*.py).

A spec never contains lesson prose. It names paragraphs by their opening words and the
helper copies them from the checksummed source text, so a lesson JSON cannot contain
retyped or paraphrased text. `trainer_pipeline.lessons` then re-proves everything.

    uv run python lesson_specs/lasker_pin.py     # writes content/lessons/lasker-pin.json
"""

from __future__ import annotations

import json
import re

import chess

from .lessons import CONTENT, RAW_TEXTS, lasker_diagram


class Source:
    def __init__(self, source_id: str):
        sources = {s["id"]: s for s in json.loads((CONTENT / "sources.json").read_text())["sources"]}
        self.meta = sources[source_id]
        self.text = (RAW_TEXTS / self.meta["localFile"]).read_text(encoding="utf-8")
        self._paras = re.split(r"\n\s*\n", self.text)

    @staticmethod
    def _join(block: str) -> str:
        out = ""
        for line in (l.strip() for l in block.strip().splitlines()):
            # "Kt-\nd5" -> "Kt-d5": a line ending in a hyphen continues without a space
            out += line if out.endswith("-") else (" " if out else "") + line
        return out

    def para(self, start: str, *, begin: str | None = None, end: str | None = None) -> str:
        """The unique paragraph that starts with `start`; optionally only the part from
        `begin` (inclusive) to `end` (inclusive)."""
        hits = [p for p in self._paras if p.strip().startswith(start)]
        if len(hits) != 1:
            raise ValueError(f"{len(hits)} paragraphs start with {start!r}")
        out = self._join(hits[0])
        if begin:
            out = out[out.index(begin):]
        if end:
            out = out[: out.index(end) + len(end)]
        return out

    def diagram(self, number: int, turn: str, castling: str = "-") -> str:
        fen = f"{lasker_diagram(self.text, number)} {turn} {castling} - 0 1"
        board = chess.Board(fen)
        if not board.is_valid():
            raise ValueError(f"diagram {number}: {board.status()!r}")
        return fen


def after(fen: str, sans: list[str]) -> str:
    board = chess.Board(fen)
    for san in sans:
        board.push_san(san)
    return board.fen()


def from_start(sans: list[str]) -> str:
    return after(chess.STARTING_FEN, sans)


def ucis(fen: str, sans: list[str]) -> list[str]:
    """Convert a SAN line (learner, reply, learner, ...) to UCI from `fen`."""
    board = chess.Board(fen)
    out = []
    for san in sans:
        move = board.parse_san(san)
        out.append(move.uci())
        board.push(move)
    return out


def write(lesson: dict) -> None:
    lesson.setdefault("review", {
        "textCheck": "verbatim-from-source (pipeline/trainer_pipeline/lessons.py)",
        "moveCheck": "legal + engine evidence in content/verification/lessons.json",
        "ownerReview": "pending",
    })
    path = CONTENT / "lessons" / f"{lesson['id']}.json"
    path.write_text(json.dumps(lesson, indent=2, ensure_ascii=False) + "\n")
    tries = sum(1 for s in lesson["steps"] if s["type"] == "try")
    print(f"wrote {path.name}: {len(lesson['steps'])} steps, {tries} interactive")
