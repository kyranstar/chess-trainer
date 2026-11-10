from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

c = Source("capablanca-chess-fundamentals-1921")
# The plain text has no diagrams, so every position is replayed from the moves it gives.
philidor = ["e4", "e5", "Nf3", "d6", "d4", "Nd7"]
bishop_e7 = philidor + ["Bc4", "Be7"]
pawn_retakes = bishop_e7 + ["dxe5", "dxe5"]
completed = philidor + ["Bc4", "h6", "Nc3", "Ngf6", "Be3", "Be7", "Qe2", "c6", "Rd1", "Qc7", "O-O"]
bishop_out = ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5"]
loses_pawn = bishop_out + ["dxe5"]
knight_f6 = bishop_out + ["Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6"]


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
    "title": "Control of the centre",
    "locator": "Part I, Chapter I, section 7 “Control of the Centre”, Examples 18–19",
    "revision": 1,
    "estMinutes": 9,
    "notationNote": "This 1921 text uses descriptive notation. Files are named after the piece that starts on them and each side counts ranks from its own back rank, so P - K 4 is e4 for White and e5 for Black, Kt - Q 2 is Nd2 for White and Nd7 for Black, Q - R 5 is Qh5 and Q - Q Kt 3 is Qb3. Kt is the knight, x is a capture, O - O is castling. Underscores mark the book's italics.",
    "steps": [
        {"type": "text", "paragraphs": [
            c.para("The four squares, K 4 and Q 4", end="_The control of the centre is of great importance._"),
            example(18, 1), example(18, 2), example(18, 3), example(18, 4), example(18, 5),
            example(18, 6, end="the more natural square for the Kt."),
        ]},
        {"type": "board", "fen": from_start(philidor), "fromMoves": philidor, "orientation": "white"},
        {"type": "try", "fen": from_start(bishop_e7), "fromMoves": bishop_e7, "orientation": "white",
         "moves": ucis(from_start(bishop_e7), ["dxe5", "Nxe5", "Nxe5", "dxe5", "Qh5"]),
         "before": [example(18, 7), example(18, 8, end="4...B - K 2, because of")],
         "after": [example(18, 8, begin="5 P x P, Kt x P")]},
        {"type": "try", "fen": from_start(pawn_retakes), "fromMoves": pawn_retakes, "orientation": "white",
         "moves": ucis(from_start(pawn_retakes), ["Qd5"]),
         "after": [example(18, 8, begin="(if 5...P x P, 6 Q - Q 5)", end="6 Q - Q 5)")]},
        {"type": "text", "paragraphs": [
            example(18, 9), example(18, 10), example(18, 11),
            example(18, 12, end="evidently somewhat hampered."),
        ]},
        {"type": "board", "fen": from_start(completed), "fromMoves": completed, "orientation": "white"},
        {"type": "try", "fen": from_start(loses_pawn), "fromMoves": loses_pawn, "orientation": "white",
         "moves": ucis(from_start(loses_pawn), ["Qxd8+", "Kxd8", "Nxe5"]),
         "before": [example(19, 1), example(19, 2), example(19, 3), example(19, 4)],
         "after": []},
        {"type": "try", "fen": from_start(knight_f6), "fromMoves": knight_f6, "orientation": "white",
         "moves": ucis(from_start(knight_f6), ["Qb3"]),
         "before": [example(19, 5), example(19, 6)],
         "after": [c.para("These examples will show the practical application")]},
    ],
})
