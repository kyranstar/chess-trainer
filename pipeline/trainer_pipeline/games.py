"""Own-game import and conservative engine analysis (Mac side).

Input: PGN files the owner downloaded from Chess.com (Game History -> Download, or the
monthly PGN link Chess.com's help centre gives). Nothing here contacts chess.com.

    uv run python -m trainer_pipeline.games --player <username> data/my-games/*.pgn

Output: data/analysis/my-games.json, to be imported in the app (Progress -> Your data).

What the analysis claims, and what it does not:
  * every number comes from Stockfish at a fixed node budget, recorded in the manifest;
  * "expected score" is the Lichess win% sigmoid of the engine score, from the learner's side;
  * a MAJOR ERROR is a move that lowers expected score by >= MAJOR_LOSS points;
  * an error is labelled only when a concrete short line shows it: "allows mate"; "loses
    material" (after the engine's reply line the learner is >= MATERIAL_SWING points down on
    where they stood before the move); "misses material" (the engine's best line ends
    >= MATERIAL_SWING points better than the line after the move played); else "unclassified";
  * a TACTICAL OPPORTUNITY is a position where the engine's best line mates, or ends
    >= MATERIAL_SWING points up on the balance BEFORE the opponent's last move, so that
    simply taking back a piece is not counted as a chance; it is "missed" when the move
    played gave up >= MISS_LOSS points.
No label says why a move was played. Engine evaluation is not a diagnosis.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import multiprocessing as mp
import re
import shutil
import sys
import time
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from .puzzles import win_percent

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "analysis" / "my-games.json"

ANALYSIS_VERSION = "game-analysis-v2"
NODES = 200_000
MAJOR_LOSS = 20.0
MISS_LOSS = 10.0
MATERIAL_SWING = 2
PV_PLIES = 5
UNIQUE_GAP = 20.0  # best move must beat the second by this much for a position to become a drill
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}

_CLK = re.compile(r"\[%clk (\d+):(\d\d):(\d\d(?:\.\d+)?)\]")


def time_class(tc: str) -> str:
    """Chess.com TimeControl tag -> time class (Chess.com's own boundaries: estimated game
    duration = base + 40 * increment; < 3 min bullet, < 10 min blitz, otherwise rapid)."""
    if not tc or tc == "-":
        return "unknown"
    if "/" in tc:
        return "daily"
    base, _, inc = tc.partition("+")
    try:
        est = int(base) + 40 * int(inc or 0)
    except ValueError:
        return "unknown"
    return "bullet" if est < 180 else "blitz" if est < 600 else "rapid"


def game_id(headers: chess.pgn.Headers, moves: list[str]) -> str:
    """Stable identity: the site's game link when present, else players + date + moves."""
    link = headers.get("Link", "")
    basis = link or "|".join([headers.get("White", ""), headers.get("Black", ""), headers.get("UTCDate", headers.get("Date", "")), " ".join(moves)])
    return hashlib.sha256(basis.encode()).hexdigest()[:16]


def parse_games(text: str, player: str) -> tuple[list[dict], dict]:
    """Parse a multi-game PGN. Returns importable games and counts of what was left out."""
    games: dict[str, dict] = {}
    stats = {"read": 0, "notPlayer": 0, "variant": 0, "computer": 0, "empty": 0, "duplicates": 0}
    stream = io.StringIO(text)
    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        stats["read"] += 1
        h = game.headers
        white, black = h.get("White", ""), h.get("Black", "")
        if player.lower() not in (white.lower(), black.lower()):
            stats["notPlayer"] += 1
            continue
        if h.get("Variant", "Standard") not in ("Standard", "") or h.get("SetUp") == "1":
            stats["variant"] += 1
            continue
        # Games against Chess.com's coach or bots are untimed practice, not rated play: left out
        # of every game metric, and counted so the omission is visible.
        if h.get("Event", "").startswith("Play vs") or "/game/computer/" in h.get("Link", ""):
            stats["computer"] += 1
            continue
        color = "white" if white.lower() == player.lower() else "black"
        ucis, clocks = [], []
        board = game.board()
        for node in game.mainline():
            ucis.append(node.move.uci())
            m = _CLK.search(node.comment or "")
            clocks.append(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None)
            board.push(node.move)
        if not ucis:
            stats["empty"] += 1
            continue
        gid = game_id(h, ucis)
        if gid in games:
            stats["duplicates"] += 1
            continue
        result = h.get("Result", "*")
        outcome = {"1-0": "win" if color == "white" else "loss", "0-1": "win" if color == "black" else "loss", "1/2-1/2": "draw"}.get(result)
        tc = h.get("TimeControl", "")

        def rating(tag: str):
            v = h.get(tag, "")
            return int(v) if v.isdigit() else None

        date = (h.get("UTCDate") or h.get("Date") or "").replace(".", "-")
        end = (h.get("EndDate") or h.get("UTCDate") or h.get("Date") or "").replace(".", "-")
        games[gid] = {
            "id": gid,
            "source": "chess.com" if "chess.com" in (h.get("Site", "") + h.get("Link", "")).lower() else h.get("Site", "unknown"),
            "url": h.get("Link") or None,
            "date": date,
            "endDate": end,
            "endTime": h.get("EndTime") or h.get("UTCTime") or None,
            "timeControl": tc,
            "timeClass": time_class(tc),
            "color": color,
            "result": outcome,
            "termination": h.get("Termination") or None,
            "playerRating": rating("WhiteElo" if color == "white" else "BlackElo"),
            "opponentRating": rating("BlackElo" if color == "white" else "WhiteElo"),
            "opponent": black if color == "white" else white,
            "moves": ucis,
            "clocks": clocks if any(c is not None for c in clocks) else None,
        }
    return sorted(games.values(), key=lambda g: (g["endDate"], g["endTime"] or "", g["id"])), stats


def material(board: chess.Board, color: chess.Color) -> int:
    return sum(v * (len(board.pieces(p, color)) - len(board.pieces(p, not color))) for p, v in VALUES.items())


def material_after(board: chess.Board, pv: list[chess.Move], color: chess.Color) -> int:
    """Material balance for `color` after the first PV_PLIES plies of `pv` (ending on a
    non-capture where possible, so a recapture in the line is not cut off)."""
    b = board.copy(stack=False)
    last = material(b, color)
    for i, move in enumerate(pv):
        if i >= PV_PLIES and not b.is_capture(move):
            break
        if i >= PV_PLIES + 2:
            break
        b.push(move)
        last = material(b, color)
    return last


def line_swing(board: chess.Board, pv: list[chess.Move], color: chess.Color) -> int:
    """Material change for `color` over the line, measured from `board`."""
    return material_after(board, pv, color) - material(board, color)


def analyse_game(game: dict, engine: chess.engine.SimpleEngine, nodes: int = NODES) -> dict:
    color = chess.WHITE if game["color"] == "white" else chess.BLACK
    board = chess.Board()
    decisions, events = [], []
    limit = chess.engine.Limit(nodes=nodes)
    # Balance after the learner's previous move, i.e. before the opponent's last move.
    before_opponent = material(board, color)
    for ply, uci in enumerate(game["moves"]):
        move = chess.Move.from_uci(uci)
        if board.turn != color:
            board.push(move)
            continue
        legal = board.legal_moves.count()
        infos = engine.analyse(board, limit, multipv=2 if legal > 1 else 1)
        best = infos[0]
        best_move = best["pv"][0]
        best_wp = win_percent(best["score"], color)
        second_wp = win_percent(infos[1]["score"], color) if len(infos) > 1 else None
        after = board.copy(stack=False)
        after.push(move)
        reply_pv: list[chess.Move] = []
        if move == best_move:
            played_wp = best_wp
        elif after.is_checkmate():
            played_wp = 100.0
        elif after.is_game_over():
            played_wp = 50.0
        else:
            ainfo = engine.analyse(after, limit, multipv=1)[0]
            played_wp = win_percent(ainfo["score"], color)
            reply_pv = list(ainfo.get("pv", []))
            reply_mate = ainfo["score"].pov(not color).mate()
        loss = max(0.0, best_wp - played_wp)
        clock = game["clocks"][ply] if game.get("clocks") else None
        decisions.append([ply, round(loss, 1), clock])

        best_score = best["score"].pov(color)
        here = material(board, color)
        best_end = material_after(board, list(best["pv"]), color)
        played_end = material_after(after, reply_pv, color) if reply_pv else material(after, color)
        opportunity = None
        if best_score.is_mate() and (best_score.mate() or 0) > 0:
            opportunity = "mate"
        elif best_end - before_opponent >= MATERIAL_SWING and best_wp >= 60:
            opportunity = "material"
        missed = opportunity is not None and move != best_move and loss >= MISS_LOSS

        label = None
        if move != best_move and loss >= MAJOR_LOSS:
            if not after.is_game_over() and reply_mate is not None and 0 < reply_mate <= 3:
                label = "allows-mate"
            elif played_end - here <= -MATERIAL_SWING:
                label = "loses-material"
            elif best_end - played_end >= MATERIAL_SWING:
                label = "misses-material"
            else:
                label = "unclassified"

        if opportunity or label:
            events.append({
                "ply": ply,
                "fen": board.fen(),
                "played": uci,
                "playedSan": board.san(move),
                "best": best_move.uci(),
                "bestSan": board.san(best_move),
                "bestLine": board.variation_san(list(best["pv"])[:PV_PLIES]),
                "bestWp": round(best_wp, 1),
                "secondWp": round(second_wp, 1) if second_wp is not None else None,
                "playedWp": round(played_wp, 1),
                "loss": round(loss, 1),
                "clock": clock,
                "opportunity": opportunity,
                "missed": missed,
                "majorError": label is not None,
                "errorLabel": label,
                "refutation": after.variation_san(reply_pv[:PV_PLIES]) if reply_pv and label else None,
                "drill": move != best_move and second_wp is not None and best_wp - second_wp >= UNIQUE_GAP and loss >= MISS_LOSS,
            })
        board.push(move)
        before_opponent = material(board, color)
    return {"decisions": decisions, "events": events}


_engine: chess.engine.SimpleEngine | None = None


def _init(path: str):
    global _engine
    _engine = chess.engine.SimpleEngine.popen_uci(path)
    _engine.configure({"Threads": 1, "Hash": 64})


def _work(game: dict):
    assert _engine is not None
    return game["id"], analyse_game(game, _engine)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn", nargs="+", type=Path)
    ap.add_argument("--player", required=True, help="your username exactly as it appears in the PGN")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--no-engine", action="store_true", help="import only; games are marked unanalysed")
    ap.add_argument("--workers", type=int, default=max(1, (mp.cpu_count() or 2) - 2))
    args = ap.parse_args()
    text = "\n\n".join(p.read_text(encoding="utf-8", errors="replace") for p in args.pgn)
    games, stats = parse_games(text, args.player)
    print(f"{stats['read']} games read, {len(games)} importable ({stats})", flush=True)
    engine_name = None
    path = None if args.no_engine else shutil.which("stockfish")
    if path:
        with chess.engine.SimpleEngine.popen_uci(path) as e:
            engine_name = e.id.get("name")
    previous = {}
    if args.out.exists():
        old = json.loads(args.out.read_text())
        om = old["manifest"]
        # Reuse earlier analyses only if they were made by this exact analysis version, engine and node budget.
        same = om.get("analysisVersion") == ANALYSIS_VERSION and (om.get("engine") or {}).get("nodes") == NODES and (om.get("engine") or {}).get("name") == engine_name
        if same and engine_name:
            previous = {g["id"]: g["analysis"] for g in old["games"] if g.get("analysis")}
    todo = [g for g in games if g["id"] not in previous and g["timeClass"] != "unknown"]
    results = dict(previous)
    if not args.no_engine and todo:
        if not path:
            print("native Stockfish not found", file=sys.stderr)
            return 2
        t0 = time.time()
        with mp.Pool(args.workers, initializer=_init, initargs=(path,)) as pool:
            for n, (gid, analysis) in enumerate(pool.imap_unordered(_work, todo), 1):
                results[gid] = analysis
                if n % 10 == 0:
                    print(f"  analysed {n}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    for g in games:
        g["analysis"] = results.get(g["id"])
    manifest = {
        "format": "chess-trainer-games",
        "schema": 1,
        "analysisVersion": ANALYSIS_VERSION,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "player": args.player,
        "engine": {"name": engine_name, "nodes": NODES, "threads": 1, "multipv": 2} if results else None,
        "rules": {"majorLoss": MAJOR_LOSS, "missLoss": MISS_LOSS, "materialSwing": MATERIAL_SWING, "pvPlies": PV_PLIES, "uniqueGap": UNIQUE_GAP,
                  "expectedScore": "Lichess win% sigmoid of the engine score, learner's point of view"},
        "counts": {"games": len(games), "analysed": sum(1 for g in games if g["analysis"]), **stats},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"manifest": manifest, "games": games}, separators=(",", ":")))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e3:.0f} kB): {manifest['counts']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
