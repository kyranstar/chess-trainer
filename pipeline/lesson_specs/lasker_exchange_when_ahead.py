from trainer_pipeline.lesson_builder import Source, after, write

s = Source("lasker-chess-and-checkers-1918")
d17 = s.diagram(17, "w")

OFFER = "From the foregoing it will be clear to the beginner"


def shown(moves: list[str]) -> dict:
    return {"type": "board", "fen": after(d17, moves), "diagram": 17, "diagramFen": d17, "afterDiagramMoves": moves, "orientation": "white"}


# Nothing is asked. R-e5 is the text's move, but the engine rates several other Rook moves as
# winning too, and after R-e5, R-b6 it rates Kxf5 and R-c5 with the text's Rxf5+, so neither
# move can be asked for as the one answer. The offer and the refusal are shown on the board.
write({
    "id": "lasker-exchange-when-ahead",
    "conceptId": "conversion.trade-when-ahead",
    "sourceId": s.meta["id"],
    "title": "A pawn ahead: forcing the exchange of pieces",
    "locator": "Part II, section “Relative Value of the Men”, Diagram 17",
    "revision": 2,
    "estMinutes": 3,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [s.para(OFFER, end="The position of Diagram 17 offers a simple example.")]},
        {"type": "board", "fen": d17, "diagram": 17, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para(OFFER, begin="White on the move will play R-e5,", end="offering the exchange of Rooks.")]},
        shown(["Re5"]),
        {"type": "text", "paragraphs": [s.para(OFFER, begin="If Black tried to avoid the exchange by playing R-b6,", end="he would take the Pawn g4 too.")]},
        shown(["Re5", "Rb6", "Rxf5+"]),
        {"type": "text", "paragraphs": [s.para(OFFER, begin="Therefore Black has to make the offered exchange of Rooks,")]},
        shown(["Re5", "Rxe5", "Kxe5"]),
    ],
})
