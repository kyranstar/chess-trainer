from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
kings_pawn = ["e4", "e5"]
centre_game = ["e4", "e5", "d4", "exd4", "Qxd4"]
quiet_game = ["e4", "e5", "Bc4", "Bc5", "Nf3", "Nc6", "d3", "Nf6", "Nc3", "d6", "O-O", "O-O", "Bg5"]
SECOND = "White is not forced to develop this Bishop on the second move"
QUIET = "If both players refrain from premature attack"

# The section on King's Pawn openings, in the book's order. The general principles that precede
# it in the book are the lesson lasker-opening-principles.
write({
    "id": "lasker-opening-development",
    "conceptId": "opening.principles",
    "sourceId": s.meta["id"],
    "title": "King's Pawn openings: developing the pieces",
    "locator": "Part III, section “King's Pawn Openings”",
    "revision": 2,
    "estMinutes": 6,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [s.para("After (1) P-e4, P-e5 the only Pawn which both players have to")]},
        {"type": "board", "fen": from_start(kings_pawn), "fromMoves": kings_pawn, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("Before moving the Queen's Pawn the players will have to make sure")]},
        {"type": "try", "fen": from_start(centre_game), "fromMoves": centre_game, "orientation": "black",
         "moves": ucis(from_start(centre_game), ["Nc6"]),
         "before": [s.para(SECOND, end="(3) Qxd4")],
         "after": [s.para(SECOND, begin="the white Queen is exposed to the attack")]},
        {"type": "text", "paragraphs": [s.para(QUIET, end="(6) o-o, o-o; (7) B-g5.")]},
        {"type": "board", "fen": from_start(quiet_game), "fromMoves": quiet_game, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para(QUIET, begin="This move is the first one with which White trespasses", end="deprived of its mobility.")]},
    ],
})
