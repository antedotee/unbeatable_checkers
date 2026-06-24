"""Alpha-beta search: negamax + iterative deepening + transposition table.

This is the engine's brain. Checkers' forced-capture rule keeps the branching
factor near 3, so alpha-beta reaches human-unbeatable depths cheaply. A light
quiescence (never stop searching while captures are pending) removes the
horizon effect on hanging captures.

`// ponytail: dict-keyed-by-state TT, not Zobrist — the state tuple is already
hashable. Zobrist is for the WASM port.`
"""
import time

from engine.board import apply_move, legal_moves
from engine.evaluate import evaluate

INF = 10 ** 9
WIN = 10 ** 6   # terminal score magnitude; eval terms stay far below this

# Transposition-table entry flags.
_EXACT, _LOWER, _UPPER = 0, 1, 2


class _TimeUp(Exception):
    pass


def _ordered(moves):
    # Captures first and longer capture chains first; cheap and effective.
    return sorted(moves, key=lambda m: -len(m[1]))


def negamax(state, depth, alpha, beta, ply=0, tt=None, deadline=None):
    if deadline is not None and time.time() > deadline:
        raise _TimeUp

    alpha_orig = alpha
    if tt is not None:
        hit = tt.get(state)
        if hit is not None and hit[0] >= depth:
            _, flag, value = hit
            if flag == _EXACT:
                return value
            if flag == _LOWER and value > alpha:
                alpha = value
            elif flag == _UPPER and value < beta:
                beta = value
            if alpha >= beta:
                return value

    moves = legal_moves(state)
    if not moves:
        return -(WIN - ply)            # side to move has no move -> loss

    capture_pos = bool(moves[0][1])    # captures are mandatory -> all moves capture
    if depth <= 0 and not capture_pos:
        return evaluate(state)

    best = -INF
    for m in _ordered(moves):
        score = -negamax(apply_move(state, m), depth - 1, -beta, -alpha,
                         ply + 1, tt, deadline)
        if score > best:
            best = score
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break

    if tt is not None:
        if best <= alpha_orig:
            flag = _UPPER
        elif best >= beta:
            flag = _LOWER
        else:
            flag = _EXACT
        tt[state] = (depth, flag, best)
    return best


def _root_search(state, depth, tt, deadline):
    best_score = -INF
    best_mv = None
    alpha = -INF
    for m in _ordered(legal_moves(state)):
        score = -negamax(apply_move(state, m), depth - 1, -INF, -alpha,
                         1, tt, deadline)
        if score > best_score:
            best_score = score
            best_mv = m
        if score > alpha:
            alpha = score
    return best_score, best_mv


def best_move(state, max_depth=12, time_limit=None):
    """Iterative-deepening search. Returns the chosen move, or None if no move.

    time_limit (seconds) caps thinking time; None searches to max_depth fully.
    """
    moves = legal_moves(state)
    if not moves:
        return None
    if len(moves) == 1:
        return moves[0]

    deadline = time.time() + time_limit if time_limit else None
    tt = {}
    best = moves[0]
    for depth in range(1, max_depth + 1):
        try:
            score, mv = _root_search(state, depth, tt, deadline)
        except _TimeUp:
            break
        if mv is not None:
            best = mv
        if abs(score) > WIN - 1000:     # forced result found; deeper won't change it
            break
    return best
