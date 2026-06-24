"""Heuristic position evaluation.

Deliberately modest: material + advancement + back-row defense. Deep search
does the heavy lifting; a coarse eval that points the right way is enough to be
unbeatable by humans. Returns a score relative to the side to move (positive =
side to move is better), so the search can use plain negamax.

`// ponytail: add mobility/king-trap terms only if the no-loss harness shows the
engine drifting in quiet positions.`
"""
from engine.board import (
    BLACK,
    BLACK_KING,
    BLACK_MAN,
    EMPTY,
    WHITE_KING,
    WHITE_MAN,
    _ROW,
)

MAN = 100
KING = 160
ADVANCE = 3      # per row a man has advanced toward promotion
BACK_ROW = 6     # bonus per man still guarding its own back rank


def evaluate(state):
    squares, side = state
    score = 0  # from Black's perspective
    for s in range(32):
        code = squares[s]
        if code == EMPTY:
            continue
        row = _ROW[s]
        if code == BLACK_MAN:
            score += MAN + ADVANCE * (7 - row)
            if row == 7:
                score += BACK_ROW
        elif code == WHITE_MAN:
            score -= MAN + ADVANCE * row
            if row == 0:
                score -= BACK_ROW
        elif code == BLACK_KING:
            score += KING
        elif code == WHITE_KING:
            score -= KING
    return score if side == BLACK else -score
