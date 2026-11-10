from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d14 = s.diagram(14, "w")
d15 = s.diagram(15, "w")
after_ke5 = after(d15, ["Ke5", "Kd7"])
drawn = after(d15, ["e5", "Kf7", "e6+", "Ke7", "Ke5"])

write({
    "id": "lasker-opposition",
    "conceptId": "endgame.opposition",
    "sourceId": s.meta["id"],
    "title": "King and pawn against king: the opposition",
    "locator": "Part II, section “Relative Value of the Men”, Diagrams 14–15",
    "revision": 1,
    "estMinutes": 9,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("The value of a Pawn is the hardest thing to grasp"),
            s.para("To realize the importance of the Pawn it is necessary"),
            s.para("In most of these cases some pieces are on the board"),
        ]},
        {"type": "try", "fen": d14, "diagram": 14, "orientation": "white", "moves": ucis(d14, ["Qd1+", "Ka3", "Qxa4+"]),
         "after": [s.para("White is a Pawn ahead and it will be his object to Queen it.")]},
        {"type": "text", "paragraphs": [
            s.para("A rash advance of the Pawn would again be the wrong thing."),
            s.para("Now, White needs three moves to bring his King up"),
        ]},
        {"type": "try", "fen": d15, "diagram": 15, "orientation": "white", "moves": ["f5e5"],
         "after": [s.para("White can win the game only by playing (5) K-e5.", end="compelled to allow the advance of the opposing King to the next line.")]},
        {"type": "try", "fen": after_ke5, "diagram": 15, "diagramFen": d15, "afterDiagramMoves": ["Ke5", "Kd7"], "orientation": "white",
         "moves": ["e5f6"],
         "after": [s.para("White can win the game only by playing (5) K-e5.", begin="If Black plays K-d7, White answers")]},
        {"type": "try", "fen": drawn, "diagram": 15, "diagramFen": d15, "afterDiagramMoves": ["e5", "Kf7", "e6+", "Ke7", "Ke5"],
         "orientation": "black", "moves": ucis(drawn, ["Ke8", "Kf6", "Kf8", "e7+", "Ke8"]),
         "before": [s.para("The important role which the opposition of the Kings play", end="he cannot keep it if Black continues correctly.")],
         "after": [s.para("The important role which the opposition of the Kings play", begin="The move which saves the game for Black is K-e8.")]},
        {"type": "text", "paragraphs": [
            s.para("To sum up the investigation of this Pawn ending:"),
            s.para("If the Pawn is not yet advanced to the 6th rank"),
            s.para("The ending King and Pawn against King is one of the most"),
        ]},
    ],
})
