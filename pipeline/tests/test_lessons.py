"""Local lessons must be verbatim, match the book's diagrams, and contain only legal moves."""

import copy

import pytest

from trainer_pipeline.lessons import RAW_TEXTS, LessonError, lasker_diagram, load_all, source_text, squash, validate_lesson

lessons, sources = load_all()
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
    bad = copy.deepcopy(lessons[0])
    first_text = next(s for s in bad["steps"] if s["type"] == "text")
    first_text["paragraphs"][0] = first_text["paragraphs"][0].replace("elementary attack", "basic attack")
    with pytest.raises(LessonError, match="not verbatim"):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_a_position_that_differs_from_the_book_diagram_is_rejected():
    bad = copy.deepcopy(lessons[0])
    step = next(s for s in bad["steps"] if s["type"] == "try" and "diagram" in s and "diagramFen" not in s)
    step["fen"] = step["fen"].replace("r3k1nr", "r3k2r", 1)
    with pytest.raises(LessonError):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_an_illegal_lesson_move_is_rejected():
    bad = copy.deepcopy(lessons[0])
    step = next(s for s in bad["steps"] if s["type"] == "try")
    step["moves"] = ["c3c8"]
    with pytest.raises(LessonError, match="illegal"):
        validate_lesson(bad, sources, engine=None)


@needs_texts
def test_lasker_ascii_diagram_parser_reads_diagram_15():
    text = source_text(sources["lasker-chess-and-checkers-1918"])
    assert lasker_diagram(text, 15) == "8/4k3/8/5K2/4P3/8/8/8"
    assert squash("a  b\nc") == "abc"
