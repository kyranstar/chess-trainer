from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d29 = s.diagram(29, "w")
d33 = s.diagram(33, "w")
d42 = s.diagram(42, "w")
weakened = after(d33, ["Rg3", "g6"])
rook_taken = after(d42, ["Rd8", "Rxd8"])
D29 = "An example for the cooperation of Rook and Bishop"
D42 = "White on the move can force the mate by (1) R-d8"

write({
    "id": "lasker-mating-positions",
    "conceptId": "mate.patterns",
    "sourceId": s.meta["id"],
    "title": "Typical mating positions: rook and bishop, the queen given up on h7, the throttled mate",
    "locator": "Part II, sections “How the Different Men Cooperate” and “Sacrificing”, Diagrams 29, 33 and 42",
    "revision": 1,
    "estMinutes": 7,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4. It writes +/- for checkmate.",
    "steps": [
        {"type": "try", "fen": d29, "diagram": 29, "orientation": "white", "moves": ucis(d29, ["Bf6"]),
         "before": [s.para(D29, end="is shown in Diagram 29.")],
         "after": [s.para(D29, begin="White plays B-f6,")]},
        # Shown, not asked: Stockfish rejects the text's (1) R-g3 (it prefers R-h3), so the learner
        # starts after (1) R-g3, P-g6, where the Queen sacrifice is the engine's move too.
        {"type": "board", "fen": d33, "diagram": 33, "orientation": "white"},
        {"type": "try", "fen": weakened, "diagram": 33, "diagramFen": d33, "afterDiagramMoves": ["Rg3", "g6"], "orientation": "white",
         "moves": ucis(weakened, ["Qxh7+", "Kxh7", "Rh3+", "Kg8", "Rh8#"]),
         "before": [s.para("In Diagram 33, White on the move can play for a similar mate")],
         "after": [s.para("Black could have prolonged the agony one move")]},
        {"type": "text", "paragraphs": [s.para("A mating position which has not been discussed up to now")]},
        # (1) R-d8 is shown, not asked: Stockfish rates R-c5 as good, so only the forced mate is asked.
        {"type": "board", "fen": d42, "diagram": 42, "orientation": "white"},
        {"type": "try", "fen": rook_taken, "diagram": 42, "diagramFen": d42, "afterDiagramMoves": ["Rd8", "Rxd8"], "orientation": "white",
         "moves": ucis(rook_taken, ["Nf7+", "Kg8", "Nh6+", "Kh8", "Qg8+", "Rxg8", "Nf7#"]),
         "before": [s.para(D42, end="occurs if Black takes the Rook instead of the Queen.")],
         "after": [s.para(D42, begin="The mating process then is:")]},
    ],
})
