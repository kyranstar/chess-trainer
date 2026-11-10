"""Build the offline Lichess practice pack shipped with the PWA.

    uv run python -m trainer_pipeline.build_puzzle_pack            # full build
    uv run python -m trainer_pipeline.build_puzzle_pack --no-engine  # legality only (tests)

Deterministic: no randomness; candidates are ordered by (-popularity, -plays, id) and the
engine runs single-threaded with a fixed node budget.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import json
import multiprocessing as mp
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path

import chess.engine
import zstandard

from .puzzles import MIN_GAP_WP, Puzzle, PuzzleFormatError, parse_row, replay, verify_unique

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "data" / "raw" / "lichess_db_puzzle.csv.zst"
WORK = REPO / "data" / "work"
OUT_DIR = REPO / "public" / "packs"

PACK_ID = "lichess-core"
PACK_SCHEMA = 1

#: Lichess theme tags the curriculum practises. Every tag here is a tag present in the
#: source data; concept -> theme mapping lives in content/concepts.json.
THEMES = [
    "hangingPiece", "mateIn1", "mateIn2", "backRankMate", "smotheredMate",
    "fork", "pin", "skewer", "discoveredAttack", "doubleCheck",
    "capturingDefender", "deflection", "attraction", "trappedPiece", "xRayAttack",
    "intermezzo", "defensiveMove", "quietMove", "sacrifice", "exposedKing",
    "kingsideAttack", "advancedPawn", "promotion", "pawnEndgame", "rookEndgame",
    "queenEndgame", "knightEndgame", "bishopEndgame", "zugzwang",
]
#: Opening families from the learner's games (OpeningTags column).
OPENINGS = ["Italian_Game", "Caro-Kann_Defense"]

BANDS = [(lo, lo + 200) for lo in range(400, 2400, 200)]  # 400-599 ... 2200-2399
PER_BUCKET = 36
PER_OPENING_BUCKET = 30
OVERSAMPLE = 1.5  # candidates verified per bucket slot; failures are dropped

MIN_POPULARITY = 80
MIN_PLAYS = 300
MAX_RD = 90
MAX_PLIES = 8  # setup move + up to 4 solver moves; keeps phone sessions brisk

ENGINE_NODES = 150_000


def band_of(rating: int) -> tuple[int, int] | None:
    for lo, hi in BANDS:
        if lo <= rating < hi:
            return (lo, hi)
    return None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stream_rows(path: Path):
    with path.open("rb") as raw:
        reader = zstandard.ZstdDecompressor().stream_reader(raw)
        text = io.TextIOWrapper(reader, encoding="utf-8", newline="")
        yield from csv.DictReader(text)


def select_candidates(path: Path) -> tuple[list[Puzzle], dict]:
    """Single pass over the source; keep the best `PER_BUCKET * OVERSAMPLE` per bucket."""
    buckets: dict[tuple, list[tuple]] = defaultdict(list)
    stats = Counter()
    by_id: dict[str, Puzzle] = {}
    cap = int(PER_BUCKET * OVERSAMPLE)
    cap_open = int(PER_OPENING_BUCKET * OVERSAMPLE)
    theme_set = set(THEMES)
    for row in stream_rows(path):
        stats["rows"] += 1
        try:
            if int(row["Popularity"]) < MIN_POPULARITY or int(row["NbPlays"]) < MIN_PLAYS:
                stats["skip_quality"] += 1
                continue
            if int(row["RatingDeviation"]) > MAX_RD:
                stats["skip_rd"] += 1
                continue
            band = band_of(int(row["Rating"]))
            if band is None:
                stats["skip_band"] += 1
                continue
            p = parse_row(row)
        except (PuzzleFormatError, ValueError, KeyError):
            stats["skip_malformed"] += 1
            continue
        if len(p.moves) > MAX_PLIES:
            stats["skip_long"] += 1
            continue
        key = (-p.popularity, -p.plays, p.id)
        keys = [("theme", t, band) for t in p.themes if t in theme_set]
        keys += [("opening", o, band) for o in OPENINGS if o in p.opening_tags]
        kept = False
        for bk in keys:
            limit = cap_open if bk[0] == "opening" else cap
            lst = buckets[bk]
            if len(lst) < limit:
                bisect.insort(lst, key)
                kept = True
            elif key < lst[-1]:
                lst.pop()
                bisect.insort(lst, key)
                kept = True
        if kept:
            by_id[p.id] = p
    wanted = {k[2] for lst in buckets.values() for k in lst}
    cands = sorted((by_id[i] for i in wanted), key=lambda p: p.id)
    stats["candidates"] = len(cands)
    return cands, dict(stats)


_engine: chess.engine.SimpleEngine | None = None


def _init_worker(engine_path: str):
    global _engine
    _engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    _engine.configure({"Threads": 1, "Hash": 32})


def _verify(p: Puzzle):
    assert _engine is not None
    try:
        # A fresh hash per puzzle keeps the result independent of worker scheduling.
        _engine.protocol.send_line("ucinewgame")  # type: ignore[attr-defined]
        v = verify_unique(p, _engine, ENGINE_NODES)
    except PuzzleFormatError as e:
        return p.id, False, f"illegal: {e}", []
    return p.id, v.ok, v.reason, [asdict(d) for d in v.decisions]


def engine_identity(engine_path: str) -> dict:
    with chess.engine.SimpleEngine.popen_uci(engine_path) as e:
        name = e.id.get("name", "unknown")
    return {"name": name, "path": engine_path}


def assemble(cands: list[Puzzle], ok_ids: set[str]) -> list[Puzzle]:
    """Fill each bucket with verified puzzles, best first."""
    theme_set = set(THEMES)
    ordered = sorted((p for p in cands if p.id in ok_ids), key=lambda p: (-p.popularity, -p.plays, p.id))
    fill: Counter = Counter()
    chosen: dict[str, Puzzle] = {}
    for p in ordered:
        band = band_of(p.rating)
        keys = [("theme", t, band) for t in p.themes if t in theme_set]
        keys += [("opening", o, band) for o in OPENINGS if o in p.opening_tags]
        take = False
        for bk in keys:
            limit = PER_OPENING_BUCKET if bk[0] == "opening" else PER_BUCKET
            if fill[bk] < limit:
                take = True
        if take:
            chosen[p.id] = p
            for bk in keys:
                fill[bk] += 1
    return sorted(chosen.values(), key=lambda p: p.id)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--engine", default="stockfish")
    ap.add_argument("--no-engine", action="store_true", help="legality check only; pack is marked unverified")
    ap.add_argument("--workers", type=int, default=max(1, (mp.cpu_count() or 2) - 2))
    ap.add_argument("--version", default=time.strftime("%Y.%m.%d"))
    args = ap.parse_args(argv)

    t0 = time.time()
    print(f"scanning {args.raw} ...", flush=True)
    cands, stats = select_candidates(args.raw)
    print(f"  {stats['rows']} rows -> {len(cands)} candidates in {time.time() - t0:.0f}s", flush=True)

    legal: list[Puzzle] = []
    for p in cands:
        try:
            replay(p)
            legal.append(p)
        except PuzzleFormatError as e:
            stats["illegal"] = stats.get("illegal", 0) + 1
            print("  illegal:", e)

    verification: dict
    reasons: Counter = Counter()
    evidence: dict[str, list] = {}
    if args.no_engine:
        ok_ids = {p.id for p in legal}
        verification = {"engine": None, "policy": "legality-only (UNVERIFIED uniqueness)"}
    else:
        engine_path = subprocess.run(["which", args.engine], capture_output=True, text=True).stdout.strip() or args.engine
        ident = engine_identity(engine_path)
        print(f"verifying {len(legal)} candidates with {ident['name']} @ {ENGINE_NODES} nodes, {args.workers} workers", flush=True)
        ok_ids = set()
        with mp.Pool(args.workers, initializer=_init_worker, initargs=(engine_path,)) as pool:
            for n, (pid, ok, reason, decisions) in enumerate(pool.imap_unordered(_verify, legal, chunksize=8), 1):
                reasons[reason.split(" at ")[0]] += 1
                evidence[pid] = decisions
                if ok:
                    ok_ids.add(pid)
                if n % 1000 == 0:
                    print(f"  {n}/{len(legal)} ({len(ok_ids)} ok) {time.time() - t0:.0f}s", flush=True)
        verification = {
            "engine": ident["name"],
            "limit": {"nodes": ENGINE_NODES},
            "options": {"Threads": 1, "Hash": 32, "MultiPV": 2},
            "policy": (
                "Every solver move must be the engine's first choice and beat the second-best move by "
                f">= {MIN_GAP_WP} expected-score points (Lichess win% sigmoid), or deliver checkmate "
                "(the app accepts any mating move). Puzzles failing this are excluded."
            ),
            "checked": len(legal),
            "passed": len(ok_ids),
            "outcomes": dict(reasons),
        }

    puzzles = assemble(legal, ok_ids)
    body = [p.to_pack_json() for p in puzzles]
    body_bytes = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
    content_hash = hashlib.sha256(body_bytes).hexdigest()

    theme_counts = Counter(t for p in puzzles for t in p.themes if t in set(THEMES))
    opening_counts = Counter(o for p in puzzles for o in OPENINGS if o in p.opening_tags)
    band_counts = Counter(f"{band_of(p.rating)[0]}" for p in puzzles)  # type: ignore[index]

    manifest = {
        "id": PACK_ID,
        "version": args.version,
        "schema": PACK_SCHEMA,
        "file": f"{PACK_ID}.json",
        "bytes": len(body_bytes),
        "contentHash": f"sha256:{content_hash}",
        "count": len(puzzles),
        "buildDate": time.strftime("%Y-%m-%d"),
        "source": {
            "id": "lichess-puzzle-db",
            "title": "Lichess puzzle database",
            "url": "https://database.lichess.org/#puzzles",
            "license": "CC0-1.0",
            "rawFile": args.raw.name,
            "rawSha256": sha256_file(args.raw),
            "rawRows": stats["rows"],
        },
        "selection": {
            "minPopularity": MIN_POPULARITY,
            "minPlays": MIN_PLAYS,
            "maxRatingDeviation": MAX_RD,
            "maxPlies": MAX_PLIES,
            "ratingBands": [BANDS[0][0], BANDS[-1][1]],
            "perThemeBand": PER_BUCKET,
            "perOpeningBand": PER_OPENING_BUCKET,
            "order": "popularity desc, plays desc, id asc",
            "scan": stats,
        },
        "verification": verification,
        "counts": {
            "byTheme": dict(sorted(theme_counts.items())),
            "byOpening": dict(sorted(opening_counts.items())),
            "byBand": dict(sorted(band_counts.items(), key=lambda kv: int(kv[0]))),
        },
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"{PACK_ID}.json").write_bytes(body_bytes)
    (args.out / f"{PACK_ID}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if evidence:
        WORK.mkdir(parents=True, exist_ok=True)
        (WORK / f"{PACK_ID}.verification.json").write_text(json.dumps(evidence))
    print(f"wrote {len(puzzles)} puzzles ({len(body_bytes) / 1e6:.2f} MB) to {args.out} in {time.time() - t0:.0f}s")
    print(json.dumps(manifest["counts"]["byBand"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
