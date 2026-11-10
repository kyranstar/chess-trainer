"""The KPK table against known theory and against Stockfish."""

import hashlib
import random
import shutil

import chess
import chess.engine
import pytest

from trainer_pipeline.kpk import DRAW, PAWN_SQUARES, WIN, board_of, generate, index, keeping_moves, probe


@pytest.fixture(scope="module")
def table():
    return generate()


def at(fen: str) -> chess.Board:
    return chess.Board(fen)


def test_known_wins_and_draws(table):
    # Lasker, Diagram 15: White Kf5, pawn e4, Black Ke7.
    assert probe(table, at("8/4k3/8/5K2/4P3/8/8/8 w - - 0 1")) == WIN
    assert [m.uci() for m in keeping_moves(table, at("8/4k3/8/5K2/4P3/8/8/8 w - - 0 1"))] == ["f5e5"]  # "only by playing K-e5"
    # King in front of the pawn with the opposition: win whoever moves... with Black to move.
    assert probe(table, at("4k3/8/4K3/4P3/8/8/8/8 b - - 0 1")) == WIN
    # Same position, White to move: still a win (the pawn has a spare move, Lasker).
    assert probe(table, at("4k3/8/4K3/4P3/8/8/8/8 w - - 0 1")) == WIN
    # Pawn on the 6th, defender takes the opposition: draw; only ...Ke8 holds.
    drawn = at("8/4k3/4P3/4K3/8/8/8/8 b - - 0 1")
    assert probe(table, drawn) == DRAW
    assert [m.uci() for m in keeping_moves(table, drawn)] == ["e7e8"]
    # Rook pawn with the defending king in the corner: draw.
    assert probe(table, at("k7/8/K7/P7/8/8/8/8 w - - 0 1")) == DRAW
    # Pawn out of reach (rule of the square): win; inside the square: draw.
    assert probe(table, at("8/8/8/8/P6k/8/8/K7 w - - 0 1")) == WIN
    assert probe(table, at("8/8/8/4k3/P7/8/8/K7 b - - 0 1")) == DRAW


def test_files_e_to_h_use_the_mirror_image(table):
    assert probe(table, at("8/3k4/8/2K5/3P4/8/8/8 w - - 0 1")) == probe(table, at("8/4k3/8/5K2/4P3/8/8/8 w - - 0 1"))
    assert probe(table, at("7k/8/7K/7P/8/8/8/8 w - - 0 1")) == DRAW


def test_stalemate_and_capture_edges(table):
    assert probe(table, at("k7/P7/K7/8/8/8/8/8 b - - 0 1")) == DRAW  # stalemate
    assert probe(table, at("8/8/8/8/8/1k6/1P6/K7 b - - 0 1")) == DRAW  # the pawn falls
    assert probe(table, at("8/8/8/8/8/8/k7/2K1Q3 w - - 0 1")) is None  # not a KPK position


def test_table_has_the_known_number_of_wins(table):
    # 111,282 is the count of White wins with the pawn on files a-d (as in Stockfish's KPK bitbase).
    assert sum(1 for v in table if v) == 111_282


@pytest.mark.skipif(shutil.which("stockfish") is None, reason="native Stockfish not installed")
def test_agrees_with_stockfish_on_a_random_sample(table):
    rng = random.Random(20261110)
    boards = []
    while len(boards) < 120:
        b = board_of(rng.randint(0, 1), rng.choice(PAWN_SQUARES), rng.randrange(64), rng.randrange(64))
        if b is not None and not b.is_game_over():
            boards.append(b)
    wrong = []
    with chess.engine.SimpleEngine.popen_uci(shutil.which("stockfish")) as engine:
        for b in boards:
            score = engine.analyse(b, chess.engine.Limit(depth=30, time=2.0))["score"].white()
            engine_win = score.is_mate() and score.mate() > 0 or (score.score() is not None and score.score() > 300)
            if bool(engine_win) != (probe(table, b) == WIN):
                wrong.append((b.fen(), str(score)))
    assert wrong == []


def test_distance_counts_half_moves_to_a_safe_promotion(table):
    from trainer_pipeline.kpk import lookup_key

    # Pawn on the 7th, promotion square free and safe: one half-move.
    assert table[lookup_key(at("8/1P6/1K6/8/8/8/8/k7 w - - 0 1"))] == 1
    # Black to move and every reply still loses to an immediate promotion: two half-moves.
    assert table[lookup_key(at("8/1P6/1K6/8/8/8/k7/8 b - - 0 1"))] == 2
    # Along best play the distance falls by exactly one each half-move.
    b = at("8/4k3/8/5K2/4P3/8/8/8 w - - 0 1")
    d = table[lookup_key(b)]
    assert d > 10
    for _ in range(d - 1):
        options = []
        for m in b.legal_moves:
            if m.promotion:
                continue
            nxt = b.copy(stack=False)
            nxt.push(m)
            key = lookup_key(nxt)
            if key is not None and table[key]:
                options.append((table[key], m))
        pick = min(options, key=lambda o: o[0]) if b.turn == chess.WHITE else max(options, key=lambda o: o[0])
        d -= 1
        assert pick[0] == d
        b.push(pick[1])
