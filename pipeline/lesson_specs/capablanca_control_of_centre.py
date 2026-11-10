from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

c = Source("capablanca-chess-fundamentals-1921")
# The plain text has no diagrams, so every position is replayed from the moves it gives.
# Example 19 only. Example 18 is not used: its comments run across the e-text's page markers,
# so they cannot be quoted whole, and its side variations are given inside one sentence.
bishop_out = ["e4", "e5", "Nf3", "d6", "d4", "Bg4"]
loses_pawn = bishop_out + ["dxe5", "dxe5"]
game = bishop_out + ["dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4"]
queen_f6 = game + ["Qf6"]
knight_f6 = game + ["Nf6"]
prevented = queen_f6 + ["Qb3", "b6", "Nc3", "c6"]


def example(number: int, k: int, *, begin: str | None = None, end: str | None = None) -> str:
    """Paragraph k of Example `number`, counted from its heading; move rows repeat between
    examples, so they are addressed by position rather than by their opening words."""
    hits = [i for i, p in enumerate(c._paras) if p.strip() == f"EXAMPLE {number}."]
    if len(hits) != 1:
        raise ValueError(f"Example {number} heading not found exactly once")
    out = c._join(c._paras[hits[0] + k])
    if begin:
        out = out[out.index(begin):]
    if end:
        out = out[: out.index(end) + len(end)]
    return out


write({
    "id": "capablanca-control-of-centre",
    "conceptId": "opening.principles",
    "sourceId": c.meta["id"],
    "title": "Knights before Bishops: Example 19",
    "locator": "Part I, Chapter I, section 7 “Control of the Centre”, Example 19",
    "revision": 2,
    "estMinutes": 5,
    "notationNote": "This 1921 text uses descriptive notation. Files are named after the piece that starts on them and each side counts ranks from its own back rank, so P - K 4 is e4 for White and e5 for Black, Kt - K B 3 is Nf3 for White and Nf6 for Black, and B - Kt 5 is Bb5 or Bg5. Kt is the knight, x is a capture, O - O is castling. Underscores mark the book's italics.",
    "steps": [
        {"type": "text", "paragraphs": [example(19, 1), example(19, 2)]},
        {"type": "board", "fen": from_start(bishop_out), "fromMoves": bishop_out, "orientation": "white"},
        {"type": "try", "fen": from_start(loses_pawn), "fromMoves": loses_pawn, "orientation": "white",
         "moves": ucis(from_start(loses_pawn), ["Qxd8+", "Kxd8", "Nxe5"]),
         "before": [example(19, 3), example(19, 4)],
         "after": []},
        {"type": "text", "paragraphs": [example(19, 5)]},
        {"type": "board", "fen": from_start(queen_f6), "fromMoves": queen_f6, "orientation": "white"},
        # The sentence is split at its semicolon so that the move is asked before it is named.
        {"type": "try", "fen": from_start(knight_f6), "fromMoves": knight_f6, "orientation": "white",
         "moves": ucis(from_start(knight_f6), ["Qb3"]),
         "before": [example(19, 6, end="If Kt - B 3;")],
         "after": [example(19, 6, begin="Q - Q Kt 3 wins a Pawn.")]},
        # The move row is quoted from its first move to its last; the page marker and the
        # e-text's markup stand outside it.
        {"type": "text", "paragraphs": [example(19, 7, begin="7. Q - Q Kt 3", end="P - Q B 3"), example(19, 8)]},
        {"type": "board", "fen": from_start(prevented), "fromMoves": prevented, "orientation": "white"},
        {"type": "text", "paragraphs": [
            example(19, 10),
            example(19, 11, begin="The student is warned against playing Pawns"),
        ]},
    ],
})
