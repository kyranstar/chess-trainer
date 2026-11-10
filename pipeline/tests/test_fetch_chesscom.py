"""The Chess.com fetcher against a fake transport: serial, conditional, stops on 429. No network."""

import json

import pytest

from trainer_pipeline.fetch_chesscom import RateLimited, sync

BASE = "https://api.chess.com/pub/player/someone/games"


class Fake:
    def __init__(self, months, limited_at=None):
        self.months = months  # {"2026/10": (pgn bytes, etag)}
        self.calls = []
        self.in_flight = 0
        self.limited_at = limited_at

    def __call__(self, url, etag):
        assert self.in_flight == 0, "requests must be serial"
        self.in_flight += 1
        try:
            self.calls.append((url, etag))
            if self.limited_at is not None and len(self.calls) > self.limited_at:
                return 429, b"", None
            if url.endswith("/archives"):
                return 200, json.dumps({"archives": [f"{BASE}/{m}" for m in self.months]}).encode(), None
            key = "/".join(url.split("/")[-3:-1])
            body, tag = self.months[key]
            if etag == tag:
                return 304, b"", tag
            return 200, body, tag
        finally:
            self.in_flight -= 1


def test_downloads_each_month_newest_first_then_uses_etags(tmp_path):
    fake = Fake({"2026/09": (b"[Event \"a\"]\n", "e9"), "2026/10": (b"[Event \"b\"]\n", "e10")})
    r = sync("Someone", tmp_path, fake)
    assert r["downloaded"] == ["2026-10.pgn", "2026-09.pgn"] and r["unchanged"] == []
    assert fake.calls[0] == (f"{BASE}/archives", None)  # username is lower-cased in the URL
    assert (tmp_path / "2026-10.pgn").read_bytes() == b"[Event \"b\"]\n"

    again = Fake(fake.months)
    r2 = sync("someone", tmp_path, again)
    assert r2["unchanged"] == ["2026-10.pgn", "2026-09.pgn"] and r2["downloaded"] == []
    assert [c[1] for c in again.calls[1:]] == ["e10", "e9"]


def test_a_changed_month_is_downloaded_again(tmp_path):
    sync("someone", tmp_path, Fake({"2026/10": (b"old", "e1")}))
    r = sync("someone", tmp_path, Fake({"2026/10": (b"new", "e2")}))
    assert r["downloaded"] == ["2026-10.pgn"]
    assert (tmp_path / "2026-10.pgn").read_bytes() == b"new"


def test_stops_at_once_on_429_and_keeps_what_it_has(tmp_path):
    fake = Fake({"2026/08": (b"a", "1"), "2026/09": (b"b", "2"), "2026/10": (b"c", "3")}, limited_at=2)
    with pytest.raises(RateLimited):
        sync("someone", tmp_path, fake)
    assert len(fake.calls) == 3  # list, one month, then the 429: no retry
    assert (tmp_path / "2026-10.pgn").exists() and not (tmp_path / "2026-09.pgn").exists()
    assert json.loads((tmp_path / ".etags.json").read_text()) == {f"{BASE}/2026/10": "3"}


def test_months_limit_and_missing_player(tmp_path):
    fake = Fake({"2026/08": (b"a", "1"), "2026/09": (b"b", "2"), "2026/10": (b"c", "3")})
    assert sync("someone", tmp_path, fake, months=1)["downloaded"] == ["2026-10.pgn"]
    with pytest.raises(RuntimeError, match="HTTP 404"):
        sync("nobody", tmp_path, lambda url, etag: (404, b"", None))
