from trainer_pipeline.lesson_builder import Source, after, write

s = Source("lasker-chess-and-checkers-1918")
d16 = s.diagram(16, "w")
PLAN = "White's King, however, is free to go wherever he likes"
advanced = ["Kd3", "Kd5", "Ke3", "Ke5", "b4", "g5"]
decoyed = advanced + ["b5", "Kd5", "b6", "Kc6", "Kd4", "Kxb6"]
won = decoyed + ["Ke5", "f4", "Kf5", "Kc6", "Kxg5", "Kd6", "Kxf4", "Ke6", "Kg5", "Kf7"]


def shown(moves: list[str]) -> dict:
    return {"type": "board", "fen": after(d16, moves), "diagram": 16, "diagramFen": d16, "afterDiagramMoves": moves, "orientation": "white"}


# Nothing is asked. The text shows a plan ("play could proceed like this"), and at every move
# of it the engine finds several others that win as well, pawn moves on the King's wing among
# them, so no single move can be asked for. The line is shown on the board in three stages.
write({
    "id": "lasker-passed-pawn",
    "conceptId": "endgame.passed-pawn",
    "sourceId": s.meta["id"],
    "title": "Winning with an extra passed pawn",
    "locator": "Part II, section “Relative Value of the Men”, Diagram 16",
    "revision": 2,
    "estMinutes": 5,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("For the beginner, of course, the opposition maneuvers"),
            s.para("Diagram 16 shows a typical position on which the winning method"),
        ]},
        {"type": "board", "fen": d16, "diagram": 16, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para(PLAN, end="(3) P-b4, P-g5;")]},
        shown(advanced),
        {"type": "text", "paragraphs": [s.para(PLAN, begin="(4) P-b5, K-d5;", end="(6) K-d4, Kxb6;")]},
        shown(decoyed),
        {"type": "text", "paragraphs": [s.para(PLAN, begin="(7) K-e5, P-f4;")]},
        shown(won),
    ],
})
