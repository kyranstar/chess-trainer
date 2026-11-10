"""Download the owner's own games from Chess.com's Published-Data API as monthly PGN files.

Owner decision 2026-11-10 (ADR-022): use the official public API for own games, on request,
from the Mac only. The app itself never contacts chess.com.

Rules followed (from Chess.com's API documentation, see docs/audits/2026-11-10-chesscom.md):
  * strictly serial: one request at a time, each awaited before the next;
  * conditional requests: stored ETags are sent, unchanged months answer 304 and are not re-downloaded;
  * 429 means stop and say so; no retry loop;
  * only the documented endpoints for one player's public game archive are used.

    uv run python -m trainer_pipeline.fetch_chesscom --player YOUR_USERNAME
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "data" / "my-games"
API = "https://api.chess.com/pub/player/{player}/games/archives"
USER_AGENT = "chess-trainer-pipeline/0.1 (personal single-user tool)"

#: (url, etag or None) -> (status, body bytes, etag or None)
Fetch = Callable[[str, str | None], tuple[int, bytes, str | None]]


def http_fetch(url: str, etag: str | None) -> tuple[int, bytes, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **({"If-None-Match": etag} if etag else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read(), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        return e.code, b"", None


class RateLimited(RuntimeError):
    pass


def sync(player: str, out_dir: Path, fetch: Fetch = http_fetch, months: int | None = None) -> dict:
    """Fetch the archive list, then each month's PGN (newest first), one request at a time."""
    out_dir.mkdir(parents=True, exist_ok=True)
    etag_file = out_dir / ".etags.json"
    etags: dict[str, str] = json.loads(etag_file.read_text()) if etag_file.exists() else {}
    status, body, _ = fetch(API.format(player=player.lower()), None)
    if status == 429:
        raise RateLimited("Chess.com answered 429 (too many requests); try again later.")
    if status != 200:
        raise RuntimeError(f"Could not list game archives for {player!r}: HTTP {status}")
    archives = sorted(json.loads(body)["archives"], reverse=True)
    if months:
        archives = archives[:months]
    report = {"months": len(archives), "downloaded": [], "unchanged": [], "failed": []}
    try:
        for url in archives:
            year, month = url.rstrip("/").split("/")[-2:]
            name = f"{year}-{month}.pgn"
            path = out_dir / name
            status, body, etag = fetch(f"{url}/pgn", etags.get(url) if path.exists() else None)
            if status == 304:
                report["unchanged"].append(name)
            elif status == 200:
                path.write_bytes(body)
                if etag:
                    etags[url] = etag
                report["downloaded"].append(name)
            elif status == 429:
                raise RateLimited("Chess.com answered 429 (too many requests); stopped. Run again later to continue.")
            else:
                report["failed"].append(f"{name}: HTTP {status}")
    finally:
        etag_file.write_text(json.dumps(etags, indent=1))
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", required=True)
    ap.add_argument("--months", type=int, default=None, help="only the most recent N months")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()
    try:
        report = sync(args.player, args.out, months=args.months)
    except RateLimited as e:
        print(e, file=sys.stderr)
        return 3
    print(json.dumps(report))
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
