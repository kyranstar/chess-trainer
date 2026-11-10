from trainer_pipeline.lesson_builder import Source, write

s = Source("lasker-chess-and-checkers-1918")
d17 = s.diagram(17, "w")

write({
    "id": "lasker-exchange-when-ahead",
    "conceptId": "conversion.trade-when-ahead",
    "sourceId": s.meta["id"],
    "title": "A pawn ahead: forcing the exchange of pieces",
    "locator": "Part II, section “Relative Value of the Men”, Diagram 17",
    "revision": 1,
    "estMinutes": 4,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [s.para("From the foregoing it will be clear to the beginner", end="The position of Diagram 17 offers a simple example.")]},
        {"type": "try", "fen": d17, "diagram": 17, "orientation": "white", "moves": ["e2e5"],
         "after": [s.para("From the foregoing it will be clear to the beginner", begin="White on the move will play R-e5,")]},
    ],
})
