from trainer_pipeline.lesson_builder import Source, after, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
d31 = s.diagram(31, "b", "kq")
d32 = s.diagram(32, "w")
pinned = after(d31, ["Ng4", "h3", "Ngxe5"])
ruy = ["e4", "e5", "Nf3", "Nc6", "Bb5"]
qgd = ["d4", "d5", "Nf3", "Nf6", "c4", "e6", "Bg5"]

write({
    "id": "lasker-pin",
    "conceptId": "tactics.pin",
    "sourceId": s.meta["id"],
    "title": "How the different men cooperate: the pin",
    "locator": "Part II, section “How the Different Men Cooperate”, Diagrams 31–32",
    "revision": 1,
    "estMinutes": 9,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "board", "fen": d31, "diagram": 31, "orientation": "white"},
        {"type": "try", "fen": pinned, "diagram": 31, "diagramFen": d31, "afterDiagramMoves": ["Ng4", "h3", "Ngxe5"],
         "orientation": "white", "moves": ucis(pinned, ["Nxe5", "Nxe5", "Re1"]),
         "before": [s.para("In the opening and in the middle game the main threat", end="takes the Pawn e5 with the Knight g4,")],
         "after": [s.para("In the opening and in the middle game the main threat", begin="then White wins a piece by")]},
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
        {"type": "text", "paragraphs": [
            s.para("The Pawn e5 is attacked twice and defended twice."),
            s.para("P-e4 in answer to P-d4 would not help either;"),
        ]},
        {"type": "try", "fen": after(d32, ["d4", "Bxd4"]), "diagram": 32, "diagramFen": d32, "afterDiagramMoves": ["d4", "Bxd4"],
         "orientation": "white",
         "moves": ucis(after(d32, ["d4", "Bxd4"]), ["Nxd4", "Nxd4", "Qxd4", "exd4", "Rxe7", "dxc3", "Bxf6", "gxf6", "Rxd7"]),
         "before": [s.para("It remains to examine whether in answer to (1) P-d4")],
         "after": [s.para("Up to this move an even exchange of pieces has taken place")]},
        {"type": "text", "paragraphs": [s.para("Instead of playing (1) P-d4 and taking advantage")]},
    ],
})
