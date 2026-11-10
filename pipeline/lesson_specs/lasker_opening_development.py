from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
fools_mate = ["f3", "e5", "g4"]
kings_pawn = ["e4", "e5"]
centre_game = ["e4", "e5", "d4", "exd4", "Qxd4"]
quiet_game = ["e4", "e5", "Bc4", "Bc5", "Nf3", "Nc6", "d3", "Nf6", "Nc3", "d6", "O-O", "O-O", "Bg5"]
MASTER = "Even a Chess master once said"
SECOND = "White is not forced to develop this Bishop on the second move"

write({
    "id": "lasker-opening-development",
    "conceptId": "opening.principles",
    "sourceId": s.meta["id"],
    "title": "General principles of chess strategy: development in the opening",
    "locator": "Part III, “General Principles of Chess Strategy” and section “King's Pawn Openings”",
    "revision": 1,
    "estMinutes": 10,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("At the beginning of the game the Knights are the only pieces", end="obstruct lines of opposing men."),
            s.para("As was stated before, the point of greatest importance"),
        ]},
        {"type": "try", "fen": from_start(fools_mate), "fromMoves": fools_mate, "orientation": "black",
         "moves": ucis(from_start(fools_mate), ["Qh4#"]),
         "before": [s.para(MASTER, end="(1) P-f3, P-e5; (2) P-g4.")],
         "after": [
             s.para(MASTER, begin="Now, he asks, should Black omit"),
             s.para("The shallowness of this argument is obvious."),
         ]},
        {"type": "board", "fen": from_start(kings_pawn), "fromMoves": kings_pawn, "orientation": "white"},
        {"type": "text", "paragraphs": [
            s.para("After (1) P-e4, P-e5 the only Pawn which both players have to"),
            s.para("Before moving the Queen's Pawn the players will have to make sure"),
        ]},
        {"type": "try", "fen": from_start(centre_game), "fromMoves": centre_game, "orientation": "black",
         "moves": ucis(from_start(centre_game), ["Nc6"]),
         "before": [s.para(SECOND, end="(3) Qxd4")],
         "after": [s.para(SECOND, begin="the white Queen is exposed to the attack")]},
        {"type": "text", "paragraphs": [s.para("If both players refrain from premature attack", end="deprived of its mobility.")]},
        {"type": "board", "fen": from_start(quiet_game), "fromMoves": quiet_game, "orientation": "white"},
        {"type": "text", "paragraphs": [s.para("The beginner who makes this great principle of development")]},
    ],
})
