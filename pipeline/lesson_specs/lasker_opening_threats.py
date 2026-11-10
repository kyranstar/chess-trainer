from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
attacked = ["e4", "e5", "Nf3"]
ruy = ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "Bxc6", "dxc6", "Nxe5"]
early_queen = ["e4", "e5", "Bc4", "Bc5", "Qh5"]
E5 = "That the Bishop may be used to advantage on b5"
F7 = "Therefore, on the second move, Black may make any developing"

# All three positions are replayed from the moves in the text; none is a printed diagram.
write({
    "id": "lasker-opening-threats",
    "conceptId": "safety.threat-scan",
    "sourceId": s.meta["id"],
    "title": "King's Pawn openings: what the last move threatens",
    "locator": "Part III, section “King's Pawn Openings”",
    "revision": 1,
    "estMinutes": 6,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "try", "fen": from_start(attacked), "fromMoves": attacked, "orientation": "black",
         "moves": ucis(from_start(attacked), ["Nc6"]),
         "before": [s.para(E5, begin="Supposing White plays (2) Kt-f3.", end="Then the Pawn e5 is attacked.")],
         "after": [s.para(E5, begin="The only sensible protection is", end="the Knight or the Bishop respectively.")]},
        {"type": "try", "fen": from_start(ruy), "fromMoves": ruy, "orientation": "black",
         "moves": ucis(from_start(ruy), ["Qd4"]),
         "before": [s.para(E5, begin="Now, it can readily be seen that after", end="(5) Ktxe5,")],
         "after": [s.para(E5, begin="Q-d4 attacking Knight and Pawn at the same time")]},
        {"type": "try", "fen": from_start(early_queen), "fromMoves": early_queen, "orientation": "black",
         "moves": ucis(from_start(early_queen), ["Qe7"]),
         "before": [
             s.para("If White, on his second move, plays B-c4, he attacks the Pawn f7."),
             s.para(F7, end="(3) Q-h5,"),
         ],
         "after": [s.para(F7, begin="Q-e7 (not P-g6 on account of")]},
    ],
})
