"""Own-game import and analysis, on a small PGN written in Chess.com's export format."""

import shutil
from pathlib import Path

import chess
import chess.engine
import pytest

from trainer_pipeline.games import analyse_game, line_swing, parse_games, time_class

PGN = (Path(__file__).parent / "fixtures" / "chesscom_sample.pgn").read_text()
PLAYER = "fixture_learner"


def test_time_class_follows_chesscom_boundaries():
    assert time_class("600+5") == "rapid"
    assert time_class("600") == "rapid"
    assert time_class("180") == "blitz"
    assert time_class("180+2") == "blitz"
    assert time_class("60") == "bullet"
    assert time_class("1/86400") == "daily"
    assert time_class("-") == "unknown"


def test_import_reads_side_result_ratings_and_clocks():
    games, stats = parse_games(PGN, PLAYER)
    assert stats["read"] == 7 and len(games) == 6
    assert stats["computer"] == 1  # the coach game is counted and left out
    by_url = {g["url"].rsplit("/", 1)[1]: g for g in games}
    g1, g2, g4 = by_url["900000001"], by_url["900000002"], by_url["900000004"]
    assert (g1["color"], g1["result"], g1["playerRating"], g1["opponentRating"], g1["timeClass"]) == ("white", "win", 465, 451, "rapid")
    assert (g2["color"], g2["result"], g2["playerRating"]) == ("black", "loss", 457)
    assert g1["clocks"][0] == 603 and g2["clocks"][7] == 20
    assert g4["timeClass"] == "daily" and g4["clocks"] is None
    assert [g["endDate"] for g in games] == sorted(g["endDate"] for g in games)


def test_import_is_idempotent_and_case_insensitive_and_skips_other_players():
    once, _ = parse_games(PGN, PLAYER)
    twice, stats = parse_games(PGN + "\n\n" + PGN, PLAYER.upper())
    assert [g["id"] for g in twice] == [g["id"] for g in once]
    assert stats["duplicates"] == 6
    assert parse_games(PGN, "someone_else")[0] == []


def test_line_swing_counts_material_from_the_movers_side():
    board = chess.Board("rnbqkb1r/pppp1ppp/5n2/4N3/8/8/PPPPQPPP/RNB1KB1R w KQkq - 2 5")
    pv = [chess.Move.from_uci(u) for u in ["e5c6", "f8e7", "c6d8"]]
    assert line_swing(board, pv, chess.WHITE) == 9
    assert line_swing(board, pv, chess.BLACK) == -9


needs_engine = pytest.mark.skipif(shutil.which("stockfish") is None, reason="native Stockfish not installed")


@pytest.fixture(scope="module")
def analysed():
    games, _ = parse_games(PGN, PLAYER)
    with chess.engine.SimpleEngine.popen_uci(shutil.which("stockfish")) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        return {g["url"].rsplit("/", 1)[1]: (g, analyse_game(g, engine, nodes=80_000)) for g in games}


@needs_engine
def test_only_the_learners_moves_are_decisions_and_evaluations_are_from_their_side(analysed):
    g, a = analysed["900000001"]  # learner is White and mates on move 4
    assert [d[0] for d in a["decisions"]] == [0, 2, 4, 6]
    mate = next(e for e in a["events"] if e["ply"] == 6)
    assert mate["opportunity"] == "mate" and mate["missed"] is False and mate["majorError"] is False
    assert mate["playedWp"] == 100.0
    g2, a2 = analysed["900000002"]  # learner is Black
    assert [d[0] for d in a2["decisions"]] == [1, 3, 5, 7, 9]


@needs_engine
def test_a_move_that_loses_the_queen_is_a_major_error_with_a_concrete_label(analysed):
    _, a = analysed["900000002"]  # 4...Nf6?? allows 5.Nc6+ winning the queen
    blunder = next(e for e in a["events"] if e["ply"] == 7)
    assert blunder["playedSan"] == "Nf6"
    assert blunder["majorError"] is True
    assert blunder["errorLabel"] == "loses-material"
    assert blunder["loss"] >= 20
    assert "Nc6+" in blunder["refutation"]
    assert blunder["clock"] == 20
    assert 0 <= blunder["playedWp"] <= blunder["bestWp"] <= 100


@needs_engine
def test_a_missed_queen_win_is_a_missed_opportunity_but_not_a_drill_when_other_moves_also_win(analysed):
    _, a = analysed["900000003"]  # learner is White and plays 5.d4 instead of 5.Nc6+
    miss = next(e for e in a["events"] if e["ply"] == 8)
    assert miss["bestSan"] == "Nc6+"
    assert miss["opportunity"] == "material" and miss["missed"] is True
    assert miss["majorError"] is True and miss["errorLabel"] == "misses-material"  # nothing lost, a queen not won
    # Other discovered checks win material too, so this position has no single answer to drill.
    assert miss["bestWp"] - miss["secondWp"] < 20 and miss["drill"] is False


@needs_engine
def test_a_missed_mate_with_one_clear_answer_becomes_a_drill(analysed):
    _, a = analysed["900000005"]  # learner is White and plays 4.Qxe5+?? instead of 4.Qxf7#
    miss = next(e for e in a["events"] if e["ply"] == 6)
    assert miss["bestSan"] == "Qxf7#" and miss["playedSan"] == "Qxe5+"
    assert miss["opportunity"] == "mate" and miss["missed"] is True
    assert miss["errorLabel"] == "loses-material"
    assert miss["bestWp"] - miss["secondWp"] >= 20 and miss["drill"] is True


@needs_engine
def test_every_decision_carries_a_loss_between_0_and_100(analysed):
    for _, a in analysed.values():
        for ply, loss, _clock in a["decisions"]:
            assert 0 <= loss <= 100 and ply >= 0


@needs_engine
def test_taking_a_free_piece_is_a_chance_but_taking_back_is_not(analysed):
    _, a = analysed["900000007"]  # learner is White
    by_ply = {e["ply"]: e for e in a["events"]}
    # 2...Qh4?? leaves the queen to be taken: a chance, and it was taken.
    assert by_ply[4]["opportunity"] == "material" and by_ply[4]["missed"] is False
    # 6...Bg4?? leaves a bishop to be taken by the queen: a chance, taken.
    assert by_ply[12]["opportunity"] == "material" and by_ply[12]["missed"] is False
    # 5.Bxc6 starts an even exchange (bishop for knight) while far ahead: not a chance.
    assert 8 not in by_ply or by_ply[8]["opportunity"] is None
    # No move in this game is an error of any kind.
    assert not any(e["majorError"] for e in a["events"])


def test_material_helpers_measure_whole_lines():
    from trainer_pipeline.games import material, material_after

    board = chess.Board("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4")
    trade = [chess.Move.from_uci(u) for u in ["b5c6", "d7c6"]]
    assert material(board, chess.WHITE) == 0
    assert material_after(board, trade, chess.WHITE) == 0  # bishop for knight: even
    assert material_after(board, trade[:1], chess.WHITE) == 3  # cut before the recapture
