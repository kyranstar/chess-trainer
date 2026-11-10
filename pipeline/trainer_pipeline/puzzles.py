"""Lichess puzzle CSV semantics and verification.

Source: https://database.lichess.org/#puzzles (CC0).

CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags[,DailyDate]

Semantics (documented by Lichess, and enforced by `parse_row` + tests):
  * FEN is the position BEFORE the opponent's move.
  * Moves[0] is the opponent's move that sets up the puzzle. The position after
    Moves[0] is what the solver sees; the solver is the side to move there.
  * Moves[1], Moves[3], ... are solver moves; Moves[2], Moves[4], ... are forced replies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import chess
import chess.engine


@dataclass(frozen=True)
class Puzzle:
    id: str
    fen: str  # position before the opponent's setup move
    moves: tuple[str, ...]  # UCI; moves[0] is the setup move
    rating: int
    rd: int
    popularity: int
    plays: int
    themes: tuple[str, ...]
    game_url: str
    opening_tags: tuple[str, ...]

    @property
    def solver_color(self) -> chess.Color:
        return not chess.Board(self.fen).turn

    def to_pack_json(self) -> dict:
        game = self.game_url.replace("https://lichess.org/", "")
        out = {
            "id": self.id,
            "fen": self.fen,
            "moves": " ".join(self.moves),
            "rating": self.rating,
            "rd": self.rd,
            "pop": self.popularity,
            "plays": self.plays,
            "themes": list(self.themes),
            "game": game,
        }
        if self.opening_tags:
            out["opening"] = list(self.opening_tags)
        return out


class PuzzleFormatError(ValueError):
    pass


def parse_row(row: dict[str, str]) -> Puzzle:
    moves = tuple(row["Moves"].split())
    if len(moves) < 2 or len(moves) % 2 != 0:
        raise PuzzleFormatError(f"{row['PuzzleId']}: expected an even number (>=2) of moves, got {len(moves)}")
    return Puzzle(
        id=row["PuzzleId"],
        fen=row["FEN"],
        moves=moves,
        rating=int(row["Rating"]),
        rd=int(row["RatingDeviation"]),
        popularity=int(row["Popularity"]),
        plays=int(row["NbPlays"]),
        themes=tuple(row["Themes"].split()),
        game_url=row["GameUrl"],
        opening_tags=tuple((row.get("OpeningTags") or "").split()),
    )


def replay(p: Puzzle) -> list[chess.Board]:
    """Replay every move with python-chess; raise if any is illegal.

    Returns the board before each move (index i = position in which moves[i] is played),
    plus the final board.
    """
    board = chess.Board(p.fen)
    if not board.is_valid():
        raise PuzzleFormatError(f"{p.id}: invalid FEN ({board.status()!r})")
    boards = []
    for i, uci in enumerate(p.moves):
        boards.append(board.copy(stack=False))
        try:
            move = chess.Move.from_uci(uci)
        except ValueError as e:
            raise PuzzleFormatError(f"{p.id}: bad UCI {uci!r}") from e
        if move not in board.legal_moves:
            raise PuzzleFormatError(f"{p.id}: illegal move {uci} at ply {i} in {board.fen()}")
        board.push(move)
    boards.append(board.copy(stack=False))
    return boards


def win_percent(score: chess.engine.PovScore, pov: chess.Color) -> float:
    """Expected score in [0, 100] from `pov`, using the Lichess accuracy sigmoid for
    centipawns (https://lichess.org/page/accuracy) and 0/100 for forced mates."""
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate()
        assert m is not None
        return 100.0 if m > 0 else 0.0
    cp = s.score()
    assert cp is not None
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp)) - 1.0)


@dataclass
class DecisionCheck:
    ply: int
    fen: str
    solution: str
    verdict: str  # "mate-move" | "unique" | "not-best" | "ambiguous" | "only-legal"
    best: str | None = None
    best_wp: float | None = None
    second: str | None = None
    second_wp: float | None = None


@dataclass
class Verification:
    puzzle_id: str
    ok: bool
    reason: str
    decisions: list[DecisionCheck] = field(default_factory=list)


#: A solver move is treated as the single correct answer only when the engine's best
#: alternative is at least this many expected-score points worse.
MIN_GAP_WP = 20.0


def verify_unique(p: Puzzle, engine: chess.engine.SimpleEngine, nodes: int) -> Verification:
    """Check with the engine that every solver move is the only good move.

    Policy (mirrored by the app's answer checker):
      * a solver move that delivers checkmate is always fine: the app accepts ANY mating
        move at that point, so alternatives cannot be mis-scored;
      * otherwise the source move must be the engine's first choice and the second-best
        move must be >= MIN_GAP_WP expected-score points worse; if not, the puzzle is
        excluded from the pack (never shipped with a possibly-sound move marked wrong).
    """
    boards = replay(p)
    solver = p.solver_color
    out = Verification(p.id, True, "ok")
    for ply in range(1, len(p.moves), 2):
        board = boards[ply]
        assert board.turn == solver
        sol = chess.Move.from_uci(p.moves[ply])
        after = board.copy(stack=False)
        after.push(sol)
        if after.is_checkmate():
            out.decisions.append(DecisionCheck(ply, board.fen(), sol.uci(), "mate-move"))
            continue
        if board.legal_moves.count() == 1:
            out.decisions.append(DecisionCheck(ply, board.fen(), sol.uci(), "only-legal"))
            continue
        infos = engine.analyse(board, chess.engine.Limit(nodes=nodes), multipv=2)
        best, second = infos[0], infos[1]
        best_move, second_move = best["pv"][0], second["pv"][0]
        d = DecisionCheck(
            ply,
            board.fen(),
            sol.uci(),
            "unique",
            best_move.uci(),
            round(win_percent(best["score"], solver), 1),
            second_move.uci(),
            round(win_percent(second["score"], solver), 1),
        )
        if best_move != sol:
            d.verdict = "not-best"
        elif d.best_wp - d.second_wp < MIN_GAP_WP:  # type: ignore[operator]
            d.verdict = "ambiguous"
        out.decisions.append(d)
        if d.verdict != "unique":
            out.ok = False
            out.reason = f"{d.verdict} at ply {ply}"
            break
    return out
