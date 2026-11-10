from trainer_pipeline.lesson_builder import Source, from_start, write

c = Source("capablanca-chess-fundamentals-1921")
# The plain text has no diagrams, so every position is replayed from the moves it gives.
four_knights = ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"]
castled = four_knights + ["Bb5", "Bb4", "O-O", "O-O"]
developed = castled + ["d3", "d6", "Bg5"]


def example(k: int, *, end: str | None = None) -> str:
    """Paragraph k of Example 17, counted from its heading; move rows repeat in other
    examples, so they are addressed by position rather than by their opening words."""
    hits = [i for i, p in enumerate(c._paras) if p.strip().startswith("EXAMPLE 17.--Suppose we begin:")]
    if len(hits) != 1:
        raise ValueError("Example 17 heading not found exactly once")
    out = c._join(c._paras[hits[0] + k])
    return out[: out.index(end) + len(end)] if end else out


write({
    "id": "capablanca-opening-strategy",
    "conceptId": "opening.principles",
    "sourceId": c.meta["id"],
    "title": "General strategy of the opening",
    "locator": "Part I, Chapter I, section 6 “General Strategy of the Opening”, Example 17",
    "revision": 1,
    "estMinutes": 6,
    "notationNote": "This 1921 text uses descriptive notation. Files are named after the piece that starts on them and each side counts ranks from its own back rank, so P - K 4 is e4 for White and e5 for Black, Kt - K B 3 is Nf3 for White and Nf6 for Black, and B - Kt 5 is Bb5 or Bg5. Kt is the knight, x is a capture, O - O is castling. Underscores mark the book's italics.",
    "steps": [
        {"type": "text", "paragraphs": [
            c.para("The main thing is to _develop the pieces quickly_."),
            c.para("From the outset two moves", end="accomplishes so much."),
        ]},
        {"type": "text", "paragraphs": [example(k) for k in range(0, 7)]},
        {"type": "board", "fen": from_start(four_knights), "fromMoves": four_knights, "orientation": "white"},
        {"type": "text", "paragraphs": [
            example(7), example(8), example(9), example(10), example(11),
            example(12, end="a very important point_."), example(13), example(14),
        ]},
        {"type": "board", "fen": from_start(castled), "fromMoves": castled, "orientation": "white"},
        {"type": "text", "paragraphs": [
            example(15), example(16), example(17),
            example(19, end="continue the same course."),
        ]},
        {"type": "board", "fen": from_start(developed), "fromMoves": developed, "orientation": "white"},
        {"type": "text", "paragraphs": [example(22), example(23), example(24)]},
    ],
})
