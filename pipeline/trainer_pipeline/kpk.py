"""Exact king-and-pawn-versus-king table by retrograde analysis.

White has the pawn. For every legal position the table says whether White wins with best
play (otherwise it is a draw; Black can never win). This is the same information a
tablebase gives for this ending, computed here from the rules alone with python-chess as
the move generator, and cross-checked against Stockfish in the tests.

Index: side to move (0 = White) x pawn square (files a-d, ranks 2-7: 24) x white king (64)
x black king (64); one byte each. Positions with the pawn on files e-h are looked up through their mirror
image. Output: content/kpk.json with the bits base64-encoded, plus drill start positions
in which exactly one move keeps the theoretical result.

    uv run python -m trainer_pipeline.kpk
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import time
from pathlib import Path

import chess

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "content" / "kpk.json"

PAWN_SQUARES = [chess.square(f, r) for f in range(4) for r in range(1, 7)]
PAWN_INDEX = {sq: i for i, sq in enumerate(PAWN_SQUARES)}
SIZE = 2 * 24 * 64 * 64
DRILLS_PER_KIND = 240


def index(stm: int, pawn: int, wk: int, bk: int) -> int:
    return ((stm * 24 + PAWN_INDEX[pawn]) * 64 + wk) * 64 + bk


def mirror_file(sq: int) -> int:
    return chess.square(7 - chess.square_file(sq), chess.square_rank(sq))


def board_of(stm: int, pawn: int, wk: int, bk: int) -> chess.Board | None:
    if len({pawn, wk, bk}) < 3:
        return None
    b = chess.Board(None)
    b.set_piece_at(wk, chess.Piece(chess.KING, chess.WHITE))
    b.set_piece_at(bk, chess.Piece(chess.KING, chess.BLACK))
    b.set_piece_at(pawn, chess.Piece(chess.PAWN, chess.WHITE))
    b.turn = chess.WHITE if stm == 0 else chess.BLACK
    return b if b.is_valid() else None


def lookup_key(b: chess.Board) -> int | None:
    """Table index of a KPK position (White has the pawn), mirroring files e-h onto a-d."""
    pawns = list(b.pieces(chess.PAWN, chess.WHITE))
    if len(pawns) != 1 or len(b.piece_map()) != 3:
        return None
    pawn, wk, bk = pawns[0], b.king(chess.WHITE), b.king(chess.BLACK)
    if chess.square_file(pawn) > 3:
        pawn, wk, bk = mirror_file(pawn), mirror_file(wk), mirror_file(bk)
    return index(0 if b.turn == chess.WHITE else 1, pawn, wk, bk)


WIN, DRAW = 1, 0


def promotion_result(b: chess.Board, move: chess.Move) -> int:
    """Result of a promotion: a win unless Black can take the new piece at once or the
    position is stalemate (promoting to a rook instead of a queen is tried for that case)."""
    for piece in (chess.QUEEN, chess.ROOK):
        after = b.copy(stack=False)
        after.push(chess.Move(move.from_square, move.to_square, promotion=piece))
        if after.is_checkmate():
            return WIN
        if after.is_stalemate():
            continue
        if any(after.is_capture(m) for m in after.legal_moves):
            continue
        return WIN
    return DRAW


def generate() -> bytearray:
    """Returns a byte per index: 0 = draw or illegal; k > 0 = White wins, and with best play
    on both sides the pawn promotes safely in k half-moves."""
    legal = bytearray(SIZE)
    # successors[i] = list of table indexes, or fixed results as negative codes (-1 draw, -2 win)
    successors: list[list[int] | None] = [None] * SIZE
    for stm in (0, 1):
        for pawn in PAWN_SQUARES:
            for wk in range(64):
                for bk in range(64):
                    b = board_of(stm, pawn, wk, bk)
                    if b is None:
                        continue
                    i = index(stm, pawn, wk, bk)
                    legal[i] = 1
                    succ: list[int] = []
                    seen_promo = False
                    for m in b.legal_moves:
                        if m.promotion:
                            if not seen_promo:
                                succ.append(-2 if promotion_result(b, m) == WIN else -1)
                                seen_promo = True
                            continue
                        after = b.copy(stack=False)
                        after.push(m)
                        key = lookup_key(after)
                        succ.append(-1 if key is None else key)  # pawn captured: draw
                    successors[i] = succ  # empty list for Black = stalemate (never checkmate here)
    # Level-synchronous retrograde pass: a position found in pass k is a forced win in exactly
    # k half-moves to a safe promotion (shortest for White, longest defence for Black).
    dist = bytearray(SIZE)
    pending = [i for i in range(SIZE) if legal[i]]
    k = 0
    while True:
        k += 1
        found = []
        for i in pending:
            succ = successors[i]
            assert succ is not None
            vals = [True if s == -2 else False if s == -1 else dist[s] > 0 for s in succ]
            if any(vals) if i < SIZE // 2 else (len(vals) > 0 and all(vals)):
                found.append(i)
        if not found:
            break
        assert k < 255
        won = set(found)
        for i in found:
            dist[i] = k
        pending = [i for i in pending if i not in won]
    return dist


def probe(table: bytearray, b: chess.Board) -> int | None:
    key = lookup_key(b)
    return None if key is None else (WIN if table[key] else DRAW)


def keeping_moves(table: bytearray, b: chess.Board) -> list[chess.Move]:
    """Moves that keep the theoretical result for the side to move (the win for White,
    the draw for Black). Empty when the side to move has nothing to keep."""
    current = probe(table, b)
    out = []
    for m in b.legal_moves:
        if m.promotion and m.promotion not in (chess.QUEEN, chess.ROOK):
            continue
        after = b.copy(stack=False)
        after.push(m)
        if m.promotion:
            value = WIN if not after.is_stalemate() and not any(after.is_capture(x) for x in after.legal_moves) else DRAW
        else:
            p = probe(table, after)
            value = DRAW if p is None else p
        if b.turn == chess.WHITE and current == WIN and value == WIN:
            out.append(m)
        if b.turn == chess.BLACK and current == DRAW and value == DRAW:
            out.append(m)
    return out


def drill_starts(table: bytearray) -> dict[str, list[str]]:
    """Start positions where exactly one move keeps the result, pieces close together and
    the pawn not yet far advanced, in a fixed pseudo-random order."""
    win, hold = [], []
    for stm in (0, 1):
        for pawn in PAWN_SQUARES:
            if not 1 <= chess.square_rank(pawn) <= 4:
                continue
            for wk in range(64):
                for bk in range(64):
                    b = board_of(stm, pawn, wk, bk)
                    if b is None or b.is_check():
                        continue
                    if chess.square_distance(wk, pawn) > 2 or chess.square_distance(bk, pawn) > 3 or chess.square_rank(bk) < chess.square_rank(pawn):
                        continue
                    value = WIN if table[index(stm, pawn, wk, bk)] else DRAW
                    if stm == 0 and value == WIN and len(keeping_moves(table, b)) == 1:
                        win.append(b.fen())
                    if stm == 1 and value == DRAW and b.legal_moves.count() >= 3:
                        keep = keeping_moves(table, b)
                        # Taking a loose pawn is not an endgame lesson; leave those out.
                        if len(keep) == 1 and not b.is_capture(keep[0]):
                            hold.append(b.fen())
    order = lambda fens: sorted(fens, key=lambda f: hashlib.sha256(f.encode()).hexdigest())[:DRILLS_PER_KIND]
    return {"win": order(win), "hold": order(hold)}


def main() -> int:
    t0 = time.time()
    table = generate()
    wins = sum(1 for v in table if v)
    drills = drill_starts(table)
    doc = {
        "id": "kpk",
        "version": 1,
        "description": "King and pawn versus king, exact result for the side with the pawn (retrograde analysis)",
        "index": "((stm*24 + pawnIndex)*64 + whiteKing)*64 + blackKing; stm 0 = side with the pawn to move; pawnIndex = file(0-3)*6 + rank-2; squares a1=0..h8=63; files e-h mirrored",
        "wins": wins,
        "maxDistance": max(table),
        "distance": "one byte per index: 0 = draw or illegal; k = the pawn's side wins and promotes safely in k half-moves with best play",
        "sha256": hashlib.sha256(bytes(table)).hexdigest(),
        "distanceBase64": base64.b64encode(bytes(table)).decode(),
        "drills": drills,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"{wins} winning positions, longest win {max(table)} half-moves; drills: {len(drills['win'])} win, {len(drills['hold'])} hold; {OUT.stat().st_size / 1e3:.0f} kB; {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
