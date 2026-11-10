from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d6w = s.diagram(6, "w")
d6b = s.diagram(6, "b")
d23 = s.diagram(23, "b", "KQkq")
kings_gambit = ["e4", "e5", "f4", "Bc5", "fxe5", "Qh4+", "Ke2"]
D23 = "After the opening moves (1) P-e4, P-e5; (2) P-f4, B-C5;"

write({
    "id": "lasker-checkmate",
    "conceptId": "mate.in-one",
    "sourceId": s.meta["id"],
    "title": "Special terms: checkmate on the move",
    "locator": "Part I, section “Special Terms” (Check and Checkmate), Diagram 6; Part II, section “How the Different Men Cooperate”, Diagram 23",
    "revision": 1,
    "estMinutes": 5,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [s.para("If a King is in Check and there is no move")]},
        {"type": "try", "fen": d6w, "diagram": 6, "orientation": "white", "moves": ucis(d6w, ["Qxg6#"]), "after": [
            s.para("If it were White's move he would take the Pawn on g6"),
            s.para("Moreover, the latter cannot be taken by the Pawn on f7"),
        ]},
        {"type": "try", "fen": d6b, "diagram": 6, "orientation": "black", "moves": ucis(d6b, ["Qxg2#"]), "after": [
            s.para("If it were Black's move he would take the Pawn g2"),
        ]},
        {"type": "board", "fen": d23, "diagram": 23, "fromMoves": kings_gambit[:5], "orientation": "black"},
        {"type": "try", "fen": from_start(kings_gambit), "fromMoves": kings_gambit, "orientation": "black",
         "moves": ucis(from_start(kings_gambit), ["Qxe4#"]),
         "before": [s.para(D23, end="in which Black wins a Rook by Q-h4+.")],
         "after": [s.para(D23, begin="White cannot reply (4) K-e2", end="on account of Qxe4 mate.")]},
    ],
})
