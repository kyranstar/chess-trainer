"""Lichess puzzle CSV semantics. Rows below are verbatim from lichess_db_puzzle.csv (CC0)."""

import shutil

import chess
import chess.engine
import pytest

from trainer_pipeline.puzzles import PuzzleFormatError, parse_row, replay, verify_unique, win_percent

COLS = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags".split(",")


def row(line: str) -> dict:
    return dict(zip(COLS, line.split(",")))


R_00008 = row("00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1819,77,95,10446,crushing hangingPiece long middlegame,https://lichess.org/game/787zsVup/black#48,")
R_0000H = row("0000H,r4rk1/pp3ppp/8/2bqp2b/3N4/P2Bn2P/1PPN1P2/R1BQ1RK1 w - - 1 15,d1h5 d5g2,1032,78,100,92,mate mateIn1 middlegame oneMove,https://lichess.org/game/EwHRkfas#29,French_Defense French_Defense_Tarrasch_Variation")


def test_first_move_is_opponents_setup_and_solver_is_other_side():
    p = parse_row(R_00008)
    # FEN has Black to move: Black plays the setup move, so White is the solver.
    assert chess.Board(p.fen).turn == chess.BLACK
    assert p.solver_color == chess.WHITE
    boards = replay(p)
    assert boards[1].turn == chess.WHITE  # position shown to the solver
    assert len(boards) == len(p.moves) + 1


def test_mate_in_one_ends_in_checkmate():
    p = parse_row(R_0000H)
    assert p.solver_color == chess.BLACK
    assert replay(p)[-1].is_checkmate()
    assert p.opening_tags == ("French_Defense", "French_Defense_Tarrasch_Variation")


def test_illegal_move_rejected():
    bad = dict(R_0000H, Moves="d1h5 d5a1")
    with pytest.raises(PuzzleFormatError):
        replay(parse_row(bad))


def test_odd_move_count_rejected():
    with pytest.raises(PuzzleFormatError):
        parse_row(dict(R_0000H, Moves="d1h5"))


def test_pack_json_round_trip_fields():
    j = parse_row(R_00008).to_pack_json()
    assert j["game"] == "game/787zsVup/black#48"
    assert j["moves"].split()[0] == "f2g3"
    assert "opening" not in j


def test_win_percent_is_symmetric_and_bounded():
    s = chess.engine.PovScore(chess.engine.Cp(150), chess.WHITE)
    assert 50 < win_percent(s, chess.WHITE) < 100
    assert win_percent(s, chess.WHITE) + win_percent(s, chess.BLACK) == pytest.approx(100)
    m = chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE)
    assert win_percent(m, chess.WHITE) == 100 and win_percent(m, chess.BLACK) == 0


@pytest.mark.skipif(shutil.which("stockfish") is None, reason="native Stockfish not installed")
def test_engine_confirms_unique_solution_and_flags_ambiguity():
    with chess.engine.SimpleEngine.popen_uci(shutil.which("stockfish")) as eng:
        eng.configure({"Threads": 1, "Hash": 16})
        v = verify_unique(parse_row(R_00008), eng, 60_000)
        assert v.ok, v
        assert [d.verdict for d in v.decisions][-1] in {"unique", "mate-move"}
        # Two rooks vs bare king, several equally winning moves: the 'solution' cannot be unique.
        amb = dict(R_00008, FEN="7k/8/8/8/8/8/R7/1R4K1 b - - 0 1", Moves="h8g8 a2a7")
        v2 = verify_unique(parse_row(amb), eng, 60_000)
        assert not v2.ok and v2.reason.startswith(("ambiguous", "not-best"))
