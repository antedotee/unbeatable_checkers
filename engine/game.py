"""Game loop, terminal/draw detection, and player strategies.

A "chooser" is a function state -> move. play_game pits two choosers and returns
'black', 'white', or 'draw'.
"""
from engine.board import BLACK, EMPTY, WHITE, apply_move, initial_state, legal_moves
from engine.search import best_move

# Pieces that are kings (codes 2 and 4); used for no-progress detection.
_KINGS = (2, 4)


def _counts(squares):
    pieces = kings = 0
    for c in squares:
        if c != EMPTY:
            pieces += 1
            if c in _KINGS:
                kings += 1
    return pieces, kings


def play_game(black_chooser, white_chooser, state=None,
              no_progress_limit=80, max_plies=400):
    """Play a full game. Returns 'black', 'white', or 'draw'.

    A capture or a promotion resets the no-progress counter; reaching the limit
    (default 80 plies = the 40-move rule) is a draw, as is hitting max_plies.
    """
    if state is None:
        state = initial_state()
    choosers = (black_chooser, white_chooser)
    no_progress = 0
    for _ in range(max_plies):
        side = state[1]
        if not legal_moves(state):
            return 'white' if side == BLACK else 'black'   # side to move loses
        move = choosers[side](state)
        nxt = apply_move(state, move)
        p0, k0 = _counts(state[0])
        p1, k1 = _counts(nxt[0])
        no_progress = 0 if (p1 < p0 or k1 > k0) else no_progress + 1
        state = nxt
        if no_progress >= no_progress_limit:
            return 'draw'
    return 'draw'


def engine_chooser(depth=8, time_limit=None):
    return lambda state: best_move(state, max_depth=depth, time_limit=time_limit)


def random_chooser(rng):
    return lambda state: rng.choice(legal_moves(state))


def greedy_chooser(rng):
    """Weak baseline: grab the most material available, else move at random."""
    def choose(state):
        moves = legal_moves(state)
        most = max(len(m[1]) for m in moves)
        return rng.choice([m for m in moves if len(m[1]) == most])
    return choose
