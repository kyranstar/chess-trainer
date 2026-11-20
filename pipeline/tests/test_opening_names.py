import chess

from trainer_pipeline.opening_names import build, key_of, position_key

TSV = "eco\tname\tpgn\nC50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4\nC50\tItalian Game: Giuoco Piano\t1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5\nC50\tItalian Game\t1. Nf3 Nc6 2. e4 e5 3. Bc4\nB10\tCaro-Kann Defense\t1. e4 c6\n"


def test_key_is_the_apps_position_key():
    # The app's positionKey: placement, side to move, castling, en passant only when a capture is legal.
    assert key_of("1. e4 c6") == "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    board = chess.Board()
    for san in ["e4", "a6", "e5", "d5"]:
        board.push_san(san)
    assert position_key(board) == "rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6"


def test_names_are_shared_and_transpositions_meet():
    out = build({"c.tsv": TSV.replace("B10\tCaro-Kann Defense\t1. e4 c6\n", ""), "b.tsv": "eco\tname\tpgn\nB10\tCaro-Kann Defense\t1. e4 c6\n"})
    assert out["names"] == ["Caro-Kann Defense", "Italian Game", "Italian Game: Giuoco Piano"]
    italian = key_of("1. e4 e5 2. Nf3 Nc6 3. Bc4")
    assert out["positions"][italian] == 1
    assert len(out["positions"]) == 3
