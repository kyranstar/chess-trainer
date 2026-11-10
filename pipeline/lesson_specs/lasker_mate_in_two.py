from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d27 = s.diagram(27, "w")
d42 = s.diagram(42, "w")
rook_lift = after(d27, ["Qh5", "g6", "Qh6", "d6"])
queen_taken = after(d42, ["Rd8", "Qxc4"])
G6 = "Black could try to defend himself with (1) ..., P-g6."
D42 = "White on the move can force the mate by (1) R-d8"

write({
    "id": "lasker-mate-in-two",
    "conceptId": "mate.in-two",
    "sourceId": s.meta["id"],
    "title": "Mated in two moves: two positions",
    "locator": "Part II, sections “How the Different Men Cooperate” and “Sacrificing”, Diagrams 27 and 42",
    "revision": 1,
    "estMinutes": 4,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        # (1) Q-h5 is shown, not asked: it passes the gate but Stockfish rates Ktxc8 as good.
        {"type": "board", "fen": d27, "diagram": 27, "orientation": "white"},
        {"type": "text", "paragraphs": [
            s.para("It remains to show some examples of the cooperation of Rooks", begin="Diagram 27 shows one of the positions"),
            s.para("White plays (1) Q-h5, and if Black makes an indifferent move"),
        ]},
        {"type": "try", "fen": rook_lift, "diagram": 27, "diagramFen": d27, "afterDiagramMoves": ["Qh5", "g6", "Qh6", "d6"], "orientation": "white",
         "moves": ucis(rook_lift, ["Rh5", "gxh5", "Qf6#"]),
         "before": [s.para(G6, end="another mate in two moves, namely")],
         "after": [s.para(G6, begin="(3) R-h5 (threatening Qxh7)")]},
        {"type": "board", "fen": d42, "diagram": 42, "orientation": "white"},
        {"type": "try", "fen": queen_taken, "diagram": 42, "diagramFen": d42, "afterDiagramMoves": ["Rd8", "Qxc4"], "orientation": "white",
         "moves": ucis(queen_taken, ["Rxe8+", "Qg8", "Nf7#"]),
         "before": [s.para(D42, end="he would be mated in two moves by")],
         "after": [s.para(D42, begin="(2) Rxe8+, Q-g8; (3) Kt-f7.", end="(3) Kt-f7.")]},
    ],
})
