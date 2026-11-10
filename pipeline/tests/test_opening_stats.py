import io

from trainer_pipeline.opening_stats import BANDS, band_index, build_positions, first_moves, scan

GAME = """[Event "Rated {speed} game"]
[Site "https://lichess.org/abc"]
[White "a"]
[Black "b"]
[Result "1-0"]
[WhiteElo "{w}"]
[BlackElo "{b}"]
[TimeControl "600+5"]

{moves}

"""
ITALIAN = "1. e4 { [%eval 0.2] [%clk 0:10:00] } 1... e5 { [%clk 0:10:00] } 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6?! 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O 1-0"
TRANSPOSED = "1. e4 e5 2. Bc4 Nc6 3. Nf3 Bc5 4. c3 Nf6 5. d3 d6 1-0"
SHORT = "1. e4 e5 2. Qh5 Ke7 3. Qxe5# 1-0"


def games(*specs):
    return io.StringIO("".join(GAME.format(speed=s, w=w, b=b, moves=m) for s, w, b, m in specs))


def test_first_moves_strips_comments_numbers_annotations_and_result():
    assert first_moves(ITALIAN, 8) == ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6"]
    assert first_moves(SHORT, 14) == ["e4", "e5", "Qh5", "Ke7", "Qxe5#"]


def test_band_index_boundaries():
    assert band_index(799) == 0 and band_index(800) == 1 and band_index(1999) == 6 and band_index(2600) == len(BANDS) - 1


def test_scan_filters_speed_and_length_and_bands_by_mover():
    root, stats = scan(games(("Rapid", 900, 1500, ITALIAN), ("Bullet", 900, 1500, ITALIAN), ("Blitz", 900, 1500, SHORT), ("Blitz", "?", 1500, ITALIAN)), None)
    assert stats["games"] == 4 and stats["used"] == 1 and stats["bySpeed"]["Rapid"] == 1
    e4 = root.children["e4"]
    assert e4.counts[band_index(900)] == 1  # White's move, White's band
    assert e4.children["e5"].counts[band_index(1500)] == 1  # Black's move, Black's band


def test_transpositions_merge_into_one_position(monkeypatch):
    import trainer_pipeline.opening_stats as m

    monkeypatch.setattr(m, "MIN_POSITION_GAMES", 1)
    monkeypatch.setattr(m, "TRIE_MIN_GAMES", 1)
    monkeypatch.setattr(m, "MIN_MOVE_GAMES", 1)
    root, _ = scan(games(("Rapid", 1000, 1000, ITALIAN), ("Rapid", 1000, 1000, TRANSPOSED)), None)
    positions, illegal = build_positions(root)
    assert illegal == 0
    # After 3...Bc5 both move orders reach the same position; 4.c3 was played in both games.
    key = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -"
    assert sum(positions[key]["n"]) == 2
    assert positions[key]["moves"][0]["san"] == "c3"


def test_engine_evidence_orders_a_normal_move_above_a_weakening_one():
    import shutil

    import pytest

    import trainer_pipeline.opening_evals as ev

    path = shutil.which("stockfish")
    if not path:
        pytest.skip("native Stockfish not installed")
    ev._init(path)
    try:
        key, out = ev._evaluate(("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", ["e2e4", "g2g4"]))
    finally:
        ev._engine.quit()
    assert out["moves"]["e2e4"] > out["moves"]["g2g4"]
    assert out["bestWp"] >= out["moves"]["e2e4"]
    assert 0 <= out["moves"]["g2g4"] <= 100 and out["bestSan"]
