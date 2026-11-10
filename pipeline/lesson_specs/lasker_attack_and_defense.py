from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d5w = s.diagram(5, "w")
d5b = s.diagram(5, "b")
rook_e6 = after(d5w, ["Re6"])
interposed = after(d5b, ["Bc5+", "Re3"])
bishop_h2 = after(d5b, ["Bh2+"])
rook_e8 = after(d5w, ["Re8+"])
DEFEND = "A man is said to DEFEND or to PROTECT another man"
CHECK = "Unless the attacking man can be captured"
H2 = "Instead of checking on c5 Black could have attacked"
E8 = "If it were White's move he could give check"

write({
    "id": "lasker-attack-and-defense",
    "conceptId": "safety.hanging-pieces",
    "sourceId": s.meta["id"],
    "title": "Special terms: attack, defense and the unprotected man",
    "locator": "Part I, section “Special Terms” (Attack and Defense; Check and Checkmate), Diagram 5",
    "revision": 1,
    "estMinutes": 6,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [s.para("A man is said to ATTACK another man")]},
        {"type": "board", "fen": d5w, "diagram": 5, "orientation": "white"},
        {"type": "try", "fen": rook_e6, "diagram": 5, "diagramFen": d5w, "afterDiagramMoves": ["Re6"], "orientation": "black",
         "moves": ucis(rook_e6, ["fxe6"]),
         "before": [s.para(DEFEND, end="without White losing anything in exchange.")],
         "after": [s.para(DEFEND, begin="Black has a much more simple way")]},
        {"type": "try", "fen": interposed, "diagram": 5, "diagramFen": d5b, "afterDiagramMoves": ["Bc5+", "Re3"], "orientation": "black",
         "moves": ucis(interposed, ["Bxe3+"]),
         "before": [
             s.para("If a man makes a move which attacks the opposing King", end="is said to be in \"check.\""),
             s.para(CHECK, end="or he may interpose his Rook on e3."),
         ],
         "after": [s.para(CHECK, begin="The latter would be very unwise")]},
        {"type": "try", "fen": bishop_h2, "diagram": 5, "diagramFen": d5b, "afterDiagramMoves": ["Bh2+"], "orientation": "white",
         "moves": ucis(bishop_h2, ["Kxh2"]),
         "before": [s.para(H2, end="White's King on h2.")],
         "after": [s.para(H2, begin="But in this case")]},
        {"type": "try", "fen": rook_e8, "diagram": 5, "diagramFen": d5w, "afterDiagramMoves": ["Re8+"], "orientation": "black",
         "moves": ucis(rook_e8, ["Nxe8"]),
         "before": [s.para(E8, end="with the Rook on e8.")],
         "after": [s.para(E8, begin="But Black could take the Rook")]},
    ],
})
