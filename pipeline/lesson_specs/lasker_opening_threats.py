from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
attacked = ["e4", "e5", "Nf3"]
pinned = ["e4", "e5", "Nf3", "Nc6", "Bb5"]
ruy = ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "Bxc6", "dxc6", "Nxe5"]
early_queen = ["e4", "e5", "Bc4", "Bc5", "Qh5"]
E5 = "That the Bishop may be used to advantage on b5"
F7_ATTACKED = "If White, on his second move, plays B-c4, he attacks the Pawn f7."
F7 = "Therefore, on the second move, Black may make any developing"

# All positions are replayed from the moves in the text; none is a printed diagram.
write({
    "id": "lasker-opening-threats",
    "conceptId": "safety.threat-scan",
    "sourceId": s.meta["id"],
    "title": "King's Pawn openings: what the last move threatens",
    "locator": "Part III, section “King's Pawn Openings”",
    "revision": 2,
    "estMinutes": 5,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        # Shown, not asked: the text weighs Kt-c6 against P-d6 and the other protections on
        # grounds of development, and the engine does not fault P-d6 or Kt-f6 here.
        {"type": "text", "paragraphs": [s.para(E5, begin="Supposing White plays (2) Kt-f3.", end="Then the Pawn e5 is attacked.")]},
        {"type": "board", "fen": from_start(attacked), "fromMoves": attacked, "orientation": "black"},
        {"type": "text", "paragraphs": [
            s.para(E5, begin="The only sensible protection is", end="the Knight or the Bishop respectively."),
            s.para(E5, begin="Now, it can readily be seen that after", end="the threat to remove the protecting Knight."),
        ]},
        {"type": "board", "fen": from_start(pinned), "fromMoves": pinned, "orientation": "black"},
        {"type": "try", "fen": from_start(ruy), "fromMoves": ruy, "orientation": "black",
         "moves": ucis(from_start(ruy), ["Qd4"]),
         "before": [s.para(E5, begin="It is true, that this threat needs no attention", end="(5) Ktxe5,")],
         "after": [s.para(E5, begin="Q-d4 attacking Knight and Pawn at the same time")]},
        {"type": "text", "paragraphs": [
            s.para(F7_ATTACKED, end="White could try (3) Q-f3 or Q-h5."),
            s.para(F7, end="bound to be chased away very soon."),
        ]},
        # The sentence that names the reply to Q-h5 is shown after the move has been found.
        {"type": "try", "fen": from_start(early_queen), "fromMoves": early_queen, "orientation": "black",
         "moves": ucis(from_start(early_queen), ["Qe7"]),
         "before": [s.para(F7, begin="For instance: (2) ...., B-c5;", end="(3) Q-h5,")],
         "after": [
             s.para(F7_ATTACKED, begin="However, Black would then have time to defend himself"),
             s.para(F7, begin="Q-e7 (not P-g6 on account of"),
         ]},
    ],
})
