"""Mechanical validation of local lessons (content/lessons/*.json).

A local lesson is a verbatim excerpt of a rights-cleared human-written text plus the
positions that text discusses. Nothing here writes instructional prose. The validator
proves, for each lesson:

  * every paragraph is a verbatim substring of the registered source text
    (whitespace-insensitive), so no paraphrase or generated text can slip in;
  * every diagram position equals the diagram printed in the source;
  * every position reached "from the opening moves" is reproduced by replaying them;
  * every move the learner is asked to find is legal, and the engine's view of it is
    recorded as evidence (best move, expected-score before/after).

    uv run python -m trainer_pipeline.lessons            # validate + write evidence
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import chess
import chess.engine

from .puzzles import win_percent

REPO = Path(__file__).resolve().parents[2]
CONTENT = REPO / "content"
RAW_TEXTS = REPO / "data" / "raw" / "gutenberg"
EVIDENCE_OUT = CONTENT / "verification" / "lessons.json"

ENGINE_NODES = 400_000
#: A move the learner must find has to be the engine's first choice, or within this many
#: expected-score points of it (several moves can win; the author's must be one of them).
MAX_LOSS_WP = 5.0

_ASCII_PIECE = {"K": "k", "Q": "q", "R": "r", "B": "b", "Kt": "n", "P": "p"}


class LessonError(ValueError):
    pass


def squash(s: str) -> str:
    """Remove all whitespace: comparison key for 'is this text verbatim?'."""
    return re.sub(r"\s+", "", s)


def source_text(source: dict) -> str:
    path = RAW_TEXTS / source["localFile"]
    if not path.exists():
        raise LessonError(f"source text {path} missing; run `python -m trainer_pipeline.fetch_sources`")
    return path.read_text(encoding="utf-8")


def lasker_diagram(text: str, number: int) -> str:
    """Board part of the FEN for 'DIAGRAM <n>' in the Gutenberg e-text of Lasker (1918).

    The e-text draws boards in ASCII with ^ for White and # for Black; the caption follows
    the board."""
    m = re.search(rf"^\s*DIAGRAM {number}\.?\s*$", text, re.M)
    if not m:
        raise LessonError(f"DIAGRAM {number} not found")
    rows = re.findall(r"^\s*([1-8]) \|(.*)\|\s*$", text[: m.start()], re.M)[-8:]
    if [r[0] for r in rows] != list("87654321"):
        raise LessonError(f"DIAGRAM {number}: could not read eight ranks")
    fen_rows = []
    for _, body in rows:
        cells = body.split("|")
        if len(cells) != 8:
            raise LessonError(f"DIAGRAM {number}: rank has {len(cells)} cells")
        out, empty = "", 0
        for cell in cells:
            c = cell.strip()
            if not c:
                empty += 1
                continue
            if empty:
                out += str(empty)
                empty = 0
            colour, name = c[0], c[1:]
            if colour not in "^#" or name not in _ASCII_PIECE:
                raise LessonError(f"DIAGRAM {number}: unknown cell {c!r}")
            ch = _ASCII_PIECE[name]
            out += ch.upper() if colour == "^" else ch
        if empty:
            out += str(empty)
        fen_rows.append(out)
    return "/".join(fen_rows)


def board_from_step(step: dict, where: str) -> chess.Board:
    board = chess.Board(step["fen"])
    if not board.is_valid():
        raise LessonError(f"{where}: invalid position {step['fen']} ({board.status()!r})")
    return board


def check_position(step: dict, text: str, where: str) -> chess.Board:
    board = board_from_step(step, where)
    if "diagram" in step:
        want = lasker_diagram(text, step["diagram"])
        base = chess.Board(step["fen"])
        # A diagram may be shown after some moves from the text have been played.
        if step.get("afterDiagramMoves"):
            base = chess.Board(step["diagramFen"])
            for san in step["afterDiagramMoves"]:
                base.push_san(san)
            if base.board_fen() != board.board_fen() or base.turn != board.turn:
                raise LessonError(f"{where}: afterDiagramMoves do not lead to fen")
            base = chess.Board(step["diagramFen"])
        if base.board_fen() != want:
            raise LessonError(f"{where}: board {base.board_fen()} != source diagram {step['diagram']} {want}")
    if "fromMoves" in step:
        b = chess.Board()
        for san in step["fromMoves"]:
            try:
                b.push_san(san)
            except ValueError as e:
                raise LessonError(f"{where}: fromMoves illegal at {san}") from e
        if b.board_fen() != board.board_fen() or b.turn != board.turn or b.castling_rights != board.castling_rights:
            raise LessonError(f"{where}: fromMoves lead to {b.fen()} not {board.fen()}")
    return board


def validate_lesson(lesson: dict, sources: dict[str, dict], engine: chess.engine.SimpleEngine | None) -> dict:
    lid = lesson["id"]
    source = sources.get(lesson["sourceId"])
    if not source:
        raise LessonError(f"{lid}: unknown source {lesson['sourceId']}")
    if source["permission"] not in {"public-domain-reviewed", "cc0", "licensed", "user-authored", "cc-by-sa"}:
        raise LessonError(f"{lid}: source {source['id']} is not cleared for local content")
    text = source_text(source)
    haystack = squash(text)
    evidence: dict = {"lesson": lid, "revision": lesson["revision"], "tries": []}

    def check_paragraphs(paras: list[str], where: str):
        for i, para in enumerate(paras):
            if squash(para) not in haystack:
                raise LessonError(f"{where} paragraph {i + 1} is not verbatim from {source['id']}: {para[:60]!r}")

    for n, step in enumerate(lesson["steps"]):
        where = f"{lid} step {n + 1} ({step['type']})"
        if step["type"] == "text":
            check_paragraphs(step["paragraphs"], where)
        elif step["type"] == "board":
            check_position(step, text, where)
        elif step["type"] == "try":
            board = check_position(step, text, where)
            check_paragraphs(step.get("before", []), where + " before")
            check_paragraphs(step.get("after", []), where + " after")
            moves = step["moves"]
            if len(moves) % 2 != 1:
                raise LessonError(f"{where}: a try must end on the learner's move")
            for ply, uci in enumerate(moves):
                move = chess.Move.from_uci(uci)
                if move not in board.legal_moves:
                    raise LessonError(f"{where}: illegal move {uci} in {board.fen()}")
                if ply % 2 == 0 and engine is not None:
                    solver = board.turn
                    info = engine.analyse(board, chess.engine.Limit(nodes=ENGINE_NODES), multipv=1)[0]
                    best_wp = win_percent(info["score"], solver)
                    after = board.copy(stack=False)
                    after.push(move)
                    if after.is_checkmate():
                        played_wp = 100.0
                    else:
                        ainfo = engine.analyse(after, chess.engine.Limit(nodes=ENGINE_NODES), multipv=1)[0]
                        played_wp = win_percent(ainfo["score"], solver)
                    ev = {
                        "step": n + 1,
                        "fen": board.fen(),
                        "move": uci,
                        "san": board.san(move),
                        "engineBest": info["pv"][0].uci(),
                        "bestWinPct": round(best_wp, 1),
                        "moveWinPct": round(played_wp, 1),
                    }
                    evidence["tries"].append(ev)
                    if best_wp - played_wp > MAX_LOSS_WP:
                        raise LessonError(f"{where}: engine disagrees with the text's move {uci}: {ev}")
                board.push(move)
        else:
            raise LessonError(f"{where}: unknown step type")
    return evidence


def load_all() -> tuple[list[dict], dict[str, dict]]:
    sources = {s["id"]: s for s in json.loads((CONTENT / "sources.json").read_text())["sources"]}
    lessons = [json.loads(p.read_text()) for p in sorted((CONTENT / "lessons").glob("*.json"))]
    return lessons, sources


def main() -> int:
    lessons, sources = load_all()
    engine_path = shutil.which("stockfish")
    if not engine_path:
        print("native Stockfish not found: cannot produce engine evidence", file=sys.stderr)
        return 2
    out = {"engine": None, "limit": {"nodes": ENGINE_NODES}, "maxLossWinPct": MAX_LOSS_WP, "lessons": []}
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        out["engine"] = engine.id.get("name")
        for lesson in lessons:
            out["lessons"].append(validate_lesson(lesson, sources, engine))
            print(f"ok  {lesson['id']} (rev {lesson['revision']})")
    EVIDENCE_OUT.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {EVIDENCE_OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
