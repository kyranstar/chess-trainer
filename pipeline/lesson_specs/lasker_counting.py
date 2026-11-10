from trainer_pipeline.lesson_builder import Source, after, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d24 = s.diagram(24, "w", "kq")
d25 = s.diagram(25, "w", "KQkq")
castled = after(d25, ["Ng5", "O-O"])
castled_into_it = after(d24, ["Bd3", "O-O"])
D24 = "Diagram 24 shows a typical case of a double threat"

write({
    "id": "lasker-counting",
    "conceptId": "safety.counting",
    "sourceId": s.meta["id"],
    "title": "More attackers than defenders, and what the men are worth",
    "locator": "Part II, sections “Relative Value of the Men” and “How the Different Men Cooperate”, Diagrams 24–25",
    "revision": 1,
    "estMinutes": 9,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("There are two kinds of elementary attack."),
            s.para("Although it is impossible to indicate exactly the relative value"),
        ]},
        {"type": "board", "fen": d25, "diagram": 25, "orientation": "white"},
        {"type": "text", "paragraphs": [
            s.para("Black's last move was Kt-e7", end="as it is already attacked by the Bishop c4."),
            s.para("There are only two ways for Black to defend f7."),
        ]},
        {"type": "try", "fen": castled, "diagram": 25, "diagramFen": d25, "afterDiagramMoves": ["Ng5", "O-O"], "orientation": "white",
         "moves": ucis(castled, ["Qh5", "h6", "Nxf7"]),
         "before": [s.para("Of the two ways indicated only the first one is feasible.")],
         "after": [
             s.para("This is the only defense against the threat Qxh7 mate."),
             s.para("(3) Ktxf7          Rxf7"),
             s.para("Black has to sacrifice the exchange."),
         ]},
        {"type": "try", "fen": castled_into_it, "diagram": 24, "diagramFen": d24, "afterDiagramMoves": ["Bd3", "O-O"], "orientation": "white",
         "moves": ucis(castled_into_it, ["Qe4"]),
         "before": [s.para(D24, end="and now Black cannot castle")],
         "after": [
             s.para(D24, begin="as White would continue with Q-e4"),
             s.para("When castling on the King side a player must always beware"),
         ]},
    ],
})
