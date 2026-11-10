"""Local lessons must be verbatim, match the book's diagrams, and contain only legal moves."""

import copy
import json
import re

import chess
import pytest

from trainer_pipeline.lessons import CONTENT, RAW_TEXTS, LessonError, lasker_diagram, load_all, source_text, squash, validate_lesson

lessons, sources = load_all()
by_id = {l["id"]: l for l in lessons}
needs_texts = pytest.mark.skipif(
    not all((RAW_TEXTS / s["localFile"]).exists() for s in sources.values() if "localFile" in s),
    reason="source texts not downloaded; run python -m trainer_pipeline.fetch_sources",
)


def test_there_is_at_least_one_lesson():
    assert lessons


@needs_texts
@pytest.mark.parametrize("lesson", lessons, ids=lambda l: l["id"])
def test_lesson_is_verbatim_and_legal(lesson):
    validate_lesson(lesson, sources, engine=None)


@needs_texts
def test_a_reworded_paragraph_is_rejected():
    bad = copy.deepcopy(by_id["lasker-double-attack"])
    first_text = next(s for s in bad["steps"] if s["type"] == "text")
    first_text["paragraphs"][0] = first_text["paragraphs"][0].replace("elementary attack", "basic attack")
    with pytest.raises(LessonError, match="not verbatim"):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_a_position_that_differs_from_the_book_diagram_is_rejected():
    bad = copy.deepcopy(by_id["lasker-double-attack"])
    step = next(s for s in bad["steps"] if s["type"] == "try" and "diagram" in s and "diagramFen" not in s)
    step["fen"] = step["fen"].replace("r3k1nr", "r3k2r", 1)
    with pytest.raises(LessonError):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_an_illegal_lesson_move_is_rejected():
    bad = copy.deepcopy(by_id["lasker-double-attack"])
    step = next(s for s in bad["steps"] if s["type"] == "try")
    step["moves"] = ["c3c8"]
    with pytest.raises(LessonError, match="illegal"):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_lasker_ascii_diagram_parser_reads_diagram_15():
    text = source_text(sources["lasker-chess-and-checkers-1918"])
    assert lasker_diagram(text, 15) == "8/4k3/8/5K2/4P3/8/8/8"
    assert squash("a  b\nc") == "abc"


# --- lessons added from the opening chapters, the rules chapter and Capablanca's text ---

CAPABLANCA = [l for l in lessons if l["sourceId"] == "capablanca-chess-fundamentals-1921"]


def _tries(lesson):
    return [s for s in lesson["steps"] if s["type"] == "try"]


def test_lesson_ids_are_unique_and_match_a_concept():
    concepts = {c["id"] for c in json.loads((CONTENT / "concepts.json").read_text())["concepts"]}
    assert len(by_id) == len(lessons)
    for lesson in lessons:
        assert lesson["conceptId"] in concepts, lesson["id"]


@pytest.mark.parametrize("lesson", lessons, ids=lambda l: l["id"])
def test_every_position_is_tied_to_the_source(lesson):
    """A board is either a printed diagram (optionally plus moves from the text) or the
    start position plus moves from the text; nothing is typed in freehand."""
    for n, step in enumerate(lesson["steps"]):
        if step["type"] == "text":
            assert step["paragraphs"], f"{lesson['id']} step {n + 1}"
            continue
        assert "diagram" in step or "fromMoves" in step, f"{lesson['id']} step {n + 1} has a free-standing position"
        if "afterDiagramMoves" in step:
            assert "diagram" in step and "diagramFen" in step


@pytest.mark.parametrize("lesson", lessons, ids=lambda l: l["id"])
def test_a_try_is_played_from_the_side_to_move_and_a_mate_has_one_answer(lesson):
    for n, step in enumerate(lesson["steps"]):
        if step["type"] != "try":
            continue
        board = chess.Board(step["fen"])
        assert step["orientation"] == ("white" if board.turn else "black"), f"{lesson['id']} step {n + 1}"
        for uci in step["moves"][:-1]:
            board.push_uci(uci)
        mates = []
        for move in board.legal_moves:
            board.push(move)
            if board.is_checkmate():
                mates.append(move.uci())
            board.pop()
        if step["moves"][-1] in mates:
            # the learner must not be told a different checkmate "is not the move the text plays"
            assert mates == [step["moves"][-1]], f"{lesson['id']} step {n + 1}: other mates {mates}"


def test_capablanca_lessons_exist_and_use_only_replayed_positions():
    assert CAPABLANCA
    for lesson in CAPABLANCA:
        for step in lesson["steps"]:
            if step["type"] != "text":
                assert "fromMoves" in step and "diagram" not in step


@needs_texts
def test_capablanca_text_has_no_board_to_parse_so_a_diagram_claim_is_rejected():
    text = source_text(sources["capablanca-chess-fundamentals-1921"])
    assert "[Illustration]" in text
    assert not re.search(r"^\s*[1-8] \|.*\|\s*$", text, re.M)
    bad = copy.deepcopy(CAPABLANCA[0])
    step = next(s for s in bad["steps"] if s["type"] != "text")
    step["diagram"] = 1
    with pytest.raises(LessonError, match="DIAGRAM 1 not found"):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_capablanca_reworded_paragraph_and_wrong_replay_are_rejected():
    bad = copy.deepcopy(by_id["capablanca-opening-strategy"])
    first_text = next(s for s in bad["steps"] if s["type"] == "text")
    assert "_develop the pieces quickly_" in first_text["paragraphs"][0]
    first_text["paragraphs"][0] = first_text["paragraphs"][0].replace("_develop the pieces quickly_", "develop the pieces quickly")
    with pytest.raises(LessonError, match="not verbatim"):
        validate_lesson(bad, sources, engine=None)

    bad = copy.deepcopy(by_id["capablanca-control-of-centre"])
    step = next(s for s in bad["steps"] if s["type"] == "try")
    step["fromMoves"] = step["fromMoves"][:-1] + ["Ngf6"]
    with pytest.raises(LessonError, match="fromMoves lead to"):
        validate_lesson(bad, sources, engine=None)


def test_no_lesson_paragraph_carries_e_text_page_markers_or_placeholders():
    for lesson in lessons:
        for step in lesson["steps"]:
            for para in step.get("paragraphs", []) + step.get("before", []) + step.get("after", []):
                assert not re.search(r"\{\d+\}|\[Illustration\]|DIAGRAM \d", para), f"{lesson['id']}: {para[:60]!r}"


@needs_texts
def test_a_move_played_from_a_diagram_must_start_from_the_printed_diagram():
    bad = copy.deepcopy(by_id["lasker-attack-and-defense"])
    step = next(s for s in bad["steps"] if s["type"] == "try" and "afterDiagramMoves" in s)
    # move the black bishop in the claimed starting diagram: no longer the book's Diagram 5
    step["diagramFen"] = step["diagramFen"].replace("3b1n1p", "2b2n1p", 1)
    with pytest.raises(LessonError):
        validate_lesson(bad, sources, engine=None)


def test_moves_as_good_as_the_text_move_are_recorded_and_a_mate_only_equals_a_mate():
    """The app asks for the text's move; an equally good move must never be recorded as a miss."""
    import shutil

    import chess.engine

    from trainer_pipeline.lessons import ENGINE_NODES, sound_alternatives
    from trainer_pipeline.puzzles import win_percent

    path = shutil.which("stockfish")
    if not path:
        pytest.skip("native Stockfish not found")
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        # After 1.e4 e5 2.Nf3 a text plays 2...Nc6. 2...Nf6 is as good; 2...f6 is not.
        board = chess.Board()
        for san in ["e4", "e5", "Nf3"]:
            board.push_san(san)
        best = win_percent(engine.analyse(board, chess.engine.Limit(nodes=ENGINE_NODES), multipv=1)[0]["score"], board.turn)
        ucis = [a["uci"] for a in sound_alternatives(board, board.parse_san("Nc6"), engine, best)]
        assert "g8f6" in ucis
        assert "f7f6" not in ucis
        assert "b8c6" not in ucis  # the text's own move is not its own alternative
        # Two rooks can each mate on the back rank: the other mate is the only equal.
        two = chess.Board("6k1/5ppp/8/8/8/8/8/R3R1K1 w - - 0 1")
        assert [a["uci"] for a in sound_alternatives(two, chess.Move.from_uci("a1a8"), engine, 100.0)] == ["e1e8"]
        one = chess.Board("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1")
        assert sound_alternatives(one, chess.Move.from_uci("e1e8"), engine, 100.0) == []
