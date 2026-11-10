from trainer_pipeline.lesson_builder import Source, after, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d31 = s.diagram(31, "b", "kq")
d32 = s.diagram(32, "w")
taken = after(d32, ["d4", "Bxd4"])
recapture = ["d4", "Bxd4", "Nxd4", "Nxd4", "Qxd4", "exd4", "Rxe7", "dxc3"]
Rook = "In the opening and in the middle game the main threat"
pinned = after(d31, ["Ng4", "h3", "Ngxe5"])
ruy = ["e4", "e5", "Nf3", "Nc6", "Bb5"]
qgd = ["d4", "d5", "Nf3", "Nf6", "c4", "e6", "Bg5"]

write({
    "id": "lasker-pin",
    "conceptId": "tactics.pin",
    "sourceId": s.meta["id"],
    "title": "How the different men cooperate: the pin",
    "locator": "Part II, section “How the Different Men Cooperate”, Diagrams 31–32",
    "revision": 2,
    "estMinutes": 9,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "board", "fen": d31, "diagram": 31, "orientation": "white"},
        {"type": "try", "fen": pinned, "diagram": 31, "diagramFen": d31, "afterDiagramMoves": ["Ng4", "h3", "Ngxe5"],
         "orientation": "white", "moves": ucis(pinned, ["Nxe5", "Nxe5", "Re1"]),
         "before": [s.para(Rook, end="takes the Pawn e5 with the Knight g4,")],
         # Only the sentence that says what a pin is. The text's claim around it ("then White wins
         # a piece ... P-d6 or Q-e7 is not a sufficient defense, for White continues with (5) P-f4")
         # is refuted by 4...P-d6 5.P-f4 P-d3+ and is not shown.
         "after": [s.para(Rook, begin='This move "pins" Black\'s Knight', end="if the Knight moved.")]},
        {"type": "text", "paragraphs": [s.para("Pieces that can be used for pinning a hostile man")]},
        {"type": "board", "fen": from_start(ruy), "fromMoves": ruy, "orientation": "white"},
        {"type": "board", "fen": from_start(qgd), "fromMoves": qgd, "orientation": "white"},
        {"type": "text", "paragraphs": [
            s.para("The disadvantage arising from having a piece pinned"),
            s.para("Two of Black's men are pinned, namely,"),
        ]},
        # Shown, not asked: Stockfish prefers the alternative (1) Kt-d5 that the text itself
        # discusses below, so the learner is never asked to "find" (1) P-d4 here.
        {"type": "board", "fen": d32, "diagram": 32, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("The Pawn e5 is attacked twice and defended twice.")]},
        {"type": "board", "fen": after(d32, ["d4"]), "diagram": 32, "diagramFen": d32, "afterDiagramMoves": ["d4"], "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("P-e4 in answer to P-d4 would not help either;")]},
        # The book's line in two parts, so that its remark on (5) Bxf6 is read before that move is asked.
        {"type": "try", "fen": taken, "diagram": 32, "diagramFen": d32, "afterDiagramMoves": ["d4", "Bxd4"],
         "orientation": "white",
         "moves": ucis(taken, ["Nxd4", "Nxd4", "Qxd4", "exd4", "Rxe7"]),
         "before": [s.para("It remains to examine whether in answer to (1) P-d4")],
         "after": [s.para("(1) P-d4          Bxd4")]},
        {"type": "try", "fen": after(d32, recapture), "diagram": 32, "diagramFen": d32, "afterDiagramMoves": recapture,
         "orientation": "white",
         "moves": ucis(after(d32, recapture), ["Bxf6", "gxf6", "Rxd7"]),
         "before": [s.para("Up to this move an even exchange of pieces has taken place")],
         "after": [s.para("(5) Bxf6          Pxf6")]},
        # The text's last paragraph on Diagram 32 ((1) Kt-d5 instead) is left out: it turns to a
        # different idea and ends by deferring it to the middle-game chapter.
    ],
})
