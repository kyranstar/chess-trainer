from trainer_pipeline.lesson_builder import Source, from_start, ucis, write

s = Source("lasker-chess-and-checkers-1918")
fools_mate = ["f3", "e5", "g4"]
MASTER = "Even a Chess master once said"

# The opening of Part III, in the book's order. Its application to (1) P-e4, P-e5 is the lesson
# lasker-opening-development.
write({
    "id": "lasker-opening-principles",
    "conceptId": "opening.principles",
    "sourceId": s.meta["id"],
    "title": "General principles of chess strategy: development",
    "locator": "Part III, “General Principles of Chess Strategy”",
    "revision": 1,
    "estMinutes": 5,
    "notationNote": "This 1918 text writes Kt for the knight and names the piece and its target square: Kt-d5 is today's Nd5, P-e4 is e4.",
    "steps": [
        {"type": "text", "paragraphs": [
            s.para("At the beginning of the game the Knights are the only pieces"),
            s.para("In any hand to hand fight evidently that player"),
        ]},
        {"type": "text", "paragraphs": [
            s.para("The important point, therefore, is to place the pieces"),
            s.para("Moreover, it will be important to place the pieces"),
        ]},
        {"type": "try", "fen": from_start(fools_mate), "fromMoves": fools_mate, "orientation": "black",
         "moves": ucis(from_start(fools_mate), ["Qh4#"]),
         "before": [s.para(MASTER, end="(1) P-f3, P-e5; (2) P-g4.")],
         "after": [
             s.para(MASTER, begin="Now, he asks, should Black omit"),
             s.para("The shallowness of this argument is obvious."),
         ]},
        {"type": "text", "paragraphs": [
            s.para("As was stated before, the point of greatest importance"),
            s.para("The beginner who makes this great principle of development"),
        ]},
    ],
})
