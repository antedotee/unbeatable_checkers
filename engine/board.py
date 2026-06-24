"""Board representation and move generation for American checkers / English draughts.

Rules: men move/capture diagonally forward only; kings any diagonal; captures are
mandatory; multi-jumps are played to completion; a man promotes on the last rank
and a man promoting mid-jump ends its turn.

Squares are the 32 dark squares, numbered 1..32 (standard PDN numbering):

       1   2   3   4        row 0
     5   6   7   8          row 1
       9  10  11  12        row 2
    13  14  15  16          row 3
      17  18  19  20        row 4
    21  22  23  24          row 5
      25  26  27  28        row 6
    29  30  31  32          row 7

Black (side 0) starts on 21..32 and moves up (toward row 0); White (side 1)
starts on 1..12 and moves down. Black moves first.

State = (squares, side): `squares` is a length-32 tuple of piece codes, `side`
is 0 (black) or 1 (white) to move. Immutable so it is hashable for the
transposition table. Written in plain ints/arrays so it ports to AssemblyScript.
"""

# Piece codes.
EMPTY = 0
BLACK_MAN = 1
BLACK_KING = 2
WHITE_MAN = 3
WHITE_KING = 4

BLACK, WHITE = 0, 1

# Diagonal directions as (drow, dcol).
_UP = ((-1, -1), (-1, 1))
_DOWN = ((1, -1), (1, 1))
_ALL = _UP + _DOWN


def _sq_to_rc(s):
    """Square 1..32 -> (row, col), both 0..7."""
    r = (s - 1) // 4
    idx = (s - 1) % 4
    c = 2 * idx + (1 if r % 2 == 0 else 0)
    return r, c


def _rc_to_sq(r, c):
    """(row, col) -> square 1..32, or 0 if off-board / not a dark square."""
    if not (0 <= r < 8 and 0 <= c < 8):
        return 0
    if (r + c) % 2 == 0:  # light square, not playable
        return 0
    return r * 4 + (c // 2) + 1


# Precompute geometry tables (WASM-portable: plain arrays indexed by square-1).
# For each square and direction index, the adjacent square and the landing
# square two steps along (0 = none).
_ROW = [0] * 32
_STEP = [[0, 0, 0, 0] for _ in range(32)]   # neighbour in each of the 4 _ALL dirs
_JUMP = [[0, 0, 0, 0] for _ in range(32)]   # landing square two steps along

for _s in range(1, 33):
    _r, _c = _sq_to_rc(_s)
    _ROW[_s - 1] = _r
    for _d, (_dr, _dc) in enumerate(_ALL):
        _STEP[_s - 1][_d] = _rc_to_sq(_r + _dr, _c + _dc)
        _JUMP[_s - 1][_d] = _rc_to_sq(_r + 2 * _dr, _c + 2 * _dc)

# Which of the 4 _ALL direction indices a piece code may use.
_DIRS = {
    BLACK_MAN: (0, 1),        # up
    WHITE_MAN: (2, 3),        # down
    BLACK_KING: (0, 1, 2, 3),
    WHITE_KING: (0, 1, 2, 3),
}


def _side_of(code):
    return BLACK if code in (BLACK_MAN, BLACK_KING) else WHITE


def initial_state():
    squares = [EMPTY] * 32
    for s in range(1, 13):        # white on top
        squares[s - 1] = WHITE_MAN
    for s in range(21, 33):       # black on bottom
        squares[s - 1] = BLACK_MAN
    return (tuple(squares), BLACK)


def _promoted(code, dest):
    """Code after a man reaches the last rank, else unchanged."""
    if code == BLACK_MAN and _ROW[dest - 1] == 0:
        return BLACK_KING
    if code == WHITE_MAN and _ROW[dest - 1] == 7:
        return WHITE_KING
    return code


def _captures_from(squares, start, code):
    """All maximal capture sequences for the piece at `start`.

    Each returned move is (path, captured): path is the tuple of squares the
    piece visits (start, ..., final landing); captured is the tuple of jumped
    squares.
    """
    moves = []

    def recurse(cur, board, captured, code, path):
        extended = False
        for d in _DIRS[code]:
            mid = _STEP[cur - 1][d]
            land = _JUMP[cur - 1][d]
            if mid == 0 or land == 0:
                continue
            if board[land - 1] != EMPTY:
                continue
            midcode = board[mid - 1]
            if midcode == EMPTY or _side_of(midcode) == _side_of(code):
                continue
            if mid in captured:
                continue
            # Perform the jump on a copy.
            nb = list(board)
            nb[cur - 1] = EMPTY
            nb[mid - 1] = EMPTY
            new_code = _promoted(code, land)
            nb[land - 1] = new_code
            new_path = path + (land,)
            new_captured = captured + (mid,)
            extended = True
            if new_code != code:
                # Man promoted mid-jump: turn ends here, cannot continue.
                moves.append((new_path, new_captured))
            else:
                before = len(moves)
                recurse(land, nb, new_captured, new_code, new_path)
                if len(moves) == before:
                    moves.append((new_path, new_captured))
        return extended

    recurse(start, squares, (), code, (start,))
    return moves


def _simple_moves_from(squares, start, code):
    moves = []
    for d in _DIRS[code]:
        t = _STEP[start - 1][d]
        if t != 0 and squares[t - 1] == EMPTY:
            moves.append(((start, t), ()))
    return moves


def legal_moves(state):
    squares, side = state
    captures = []
    for s in range(1, 33):
        code = squares[s - 1]
        if code == EMPTY or _side_of(code) != side:
            continue
        captures.extend(_captures_from(squares, s, code))
    if captures:        # captures are mandatory
        return captures
    simples = []
    for s in range(1, 33):
        code = squares[s - 1]
        if code == EMPTY or _side_of(code) != side:
            continue
        simples.extend(_simple_moves_from(squares, s, code))
    return simples


def apply_move(state, move):
    squares, side = state
    path, captured = move
    nb = list(squares)
    code = nb[path[0] - 1]
    nb[path[0] - 1] = EMPTY
    for cap in captured:
        nb[cap - 1] = EMPTY
    dest = path[-1]
    nb[dest - 1] = _promoted(code, dest)
    return (tuple(nb), 1 - side)
