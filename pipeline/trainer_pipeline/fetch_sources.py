"""Download the rights-cleared source texts named in content/sources.json into
data/raw/gutenberg/ and verify their checksums.

    uv run python -m trainer_pipeline.fetch_sources
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request

from .lessons import CONTENT, RAW_TEXTS


def main() -> int:
    RAW_TEXTS.mkdir(parents=True, exist_ok=True)
    failed = False
    for s in json.loads((CONTENT / "sources.json").read_text())["sources"]:
        if "fetchUrl" not in s:
            continue
        path = RAW_TEXTS / s["localFile"]
        if not path.exists():
            req = urllib.request.Request(s["fetchUrl"], headers={"User-Agent": "chess-trainer-pipeline/0.1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                path.write_bytes(r.read())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        ok = digest == s["sha256"]
        failed |= not ok
        print(("ok  " if ok else "MISMATCH ") + f"{s['id']} {path.name} {digest}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
