from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d16 = s.diagram(16, "w")
line = ["Kd3", "Kd5", "Ke3", "Ke5", "b4", "g5", "b5", "Kd5", "b6", "Kc6"]
decoyed = after(d16, line)

write({
    "id": "lasker-passed-pawn",
    "conceptId": "endgame.passed-pawn",
    "sourceId": s.meta["id"],
    "title": "Winning with an extra passed pawn",
    "locator": "Part II, section “Relative Value of the Men”, Diagram 16",
    "revision": 1,
    "estMinutes": 7,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("For the beginner, of course, the opposition maneuvers"),
            s.para("Diagram 16 shows a typical position on which the winning method"),
        ]},
        {"type": "board", "fen": d16, "diagram": 16, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("White's King, however, is free to go wherever he likes", end="thereby giving the way free to his own King.")]},
        {"type": "try", "fen": d16, "diagram": 16, "orientation": "white", "moves": ucis(d16, ["Kd3", "Kd5", "Ke3", "Ke5", "b4"]),
         "after": []},
        {"type": "try", "fen": decoyed, "diagram": 16, "diagramFen": d16, "afterDiagramMoves": line, "orientation": "white",
         "moves": ucis(decoyed, ["Kd4", "Kxb6", "Ke5", "f4", "Kf5"]),
         "after": [s.para("White's King, however, is free to go wherever he likes", begin="According to this scheme play could proceed like this:")]},
    ],
})
