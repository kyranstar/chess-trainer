from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d9 = s.diagram(9, "w")
drive = ["Qf5", "Kc6", "Qe5", "Kd7", "Kc4", "Kc6", "Qe7", "Kb6", "Qd7", "Ka6"]
cornered = after(d9, drive)
LINE = "(1)Q-f5, K-c6; (2)Q-e5, K-d7;"

# Only the Queen's mate is here. The text's Rook example starts from "Diagram 9 with a Rook on h3
# instead of the Queen", a position that is neither a printed diagram nor reached by moves, so the
# validator cannot tie it to the book. The first moves of the drive are quoted, not asked: any
# of several Queen moves wins there, and only (6) K-c5 is singled out by the text.
write({
    "id": "lasker-queen-mate",
    "conceptId": "mate.basic-pieces",
    "sourceId": s.meta["id"],
    "title": "Fundamental endings: mating the lone king with king and queen",
    "locator": "Part II, section “Fundamental Endings”, Diagram 9",
    "revision": 1,
    "estMinutes": 6,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("It is clear that in order to checkmate the lone King"),
            s.para("It can easily be seen that this can be done without difficulty"),
        ]},
        {"type": "board", "fen": d9, "diagram": 9, "orientation": "white"},
        {"type": "text", "paragraphs": [
            s.para("How will White proceed in order to drive the King"),
            s.para("A direct onslaught with the Queen on e6 or d7"),
            s.para("The correct way of maneuvering for White will be to confine"),
        ]},
        {"type": "try", "fen": cornered, "diagram": 9, "diagramFen": d9, "afterDiagramMoves": drive, "orientation": "white",
         "moves": ucis(cornered, ["Kc5"]),
         "before": [s.para(LINE, end="White's Queen attacking all of them.")],
         "after": [s.para(LINE, begin="The correct move is (6) K-c5.")]},
    ],
})
