from trainer_pipeline.lesson_builder import Source, after, from_start, write

s = Source("lasker-chess-and-checkers-1918")
d20 = s.diagram(20, "w", "kq")
d21 = s.diagram(21, "w", "KQkq")
d22 = s.diagram(22, "b", "KQkq")
d23 = s.diagram(23, "b", "KQkq")
petroff = ["e4", "e5", "Nf3", "Nf6", "Nxe5", "Nxe4", "Qe2", "Nf6"]
kings_gambit = ["e4", "e5", "f4", "Bc5", "fxe5"]
D21 = "Quite frequently a similar attack with the Knight"
scandinavian = ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6", "Bc4", "e6", "Bd2"]

write({
    "id": "lasker-double-attack",
    "conceptId": "tactics.double-attack",
    "sourceId": s.meta["id"],
    "title": "How the different men cooperate: the double attack",
    "locator": "Part II, section “How the Different Men Cooperate”, Diagrams 20–23",
    "revision": 2,
    "estMinutes": 8,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("There are two kinds of elementary attack."),
            s.para("In the following diagrams simple illustrations"),
        ]},
        {"type": "try", "fen": d20, "diagram": 20, "orientation": "white", "moves": ["c3d5"], "after": [
            s.para("In the position of Diagram 20 White on the move wins"),
            s.para("On the next move White will, therefore, take the Pawn"),
        ]},
        {"type": "board", "fen": d21, "diagram": 21, "orientation": "white"},
        {"type": "try", "fen": after(d21, ["Nd5", "Qc6"]), "diagram": 21, "diagramFen": d21, "afterDiagramMoves": ["Nd5", "Qc6"],
         "orientation": "white", "moves": ["f1b5", "c6b5", "d5c7"],
         "before": [s.para(D21, end="but not by Q-c6;")],
         "after": [s.para(D21, begin="for in the latter case White would continue")]},
        {"type": "board", "fen": d22, "diagram": 22, "fromMoves": scandinavian, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("Sometimes two pieces are involved in the double attack", end="which Black cannot keep protected.")]},
        {"type": "try", "fen": from_start(petroff), "fromMoves": petroff, "orientation": "white", "moves": ["e5c6"],
         "after": [s.para("Threats of this kind more frequently occur")]},
        {"type": "text", "paragraphs": [s.para("Next to the Knight the Queen is most frequently", end="to carry out a double attack.")]},
        {"type": "try", "fen": d23, "diagram": 23, "fromMoves": kings_gambit, "orientation": "black", "moves": ["d8h4", "g2g3", "h4e4"],
         "after": [s.para("After the opening moves (1) P-e4, P-e5; (2) P-f4, B-C5;")]},
    ],
})
