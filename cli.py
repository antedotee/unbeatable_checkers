"""Play checkers against the engine in the terminal.

Run: python3 cli.py            (you are Black, moving up the board)
     python3 cli.py white      (you are White)

Pieces:  b/B = black man/king   w/W = white man/king
Black (b) sits at the bottom and moves up; White (w) at the top, moving down.
"""
import sys

from engine.board import (
    BLACK,
    WHITE,
    _sq_to_rc,
    apply_move,
    initial_state,
    legal_moves,
)
from engine.game import _counts
from engine.search import best_move

_GLYPH = {0: ' . ', 1: ' b ', 2: ' B ', 3: ' w ', 4: ' W '}

ENGINE_DEPTH = 12
ENGINE_TIME = 3.0   # seconds per move; whichever (depth/time) hits first


def render(state):
    squares = state[0]
    grid = [['   '] * 8 for _ in range(8)]   # light squares blank
    for s in range(1, 33):
        r, c = _sq_to_rc(s)
        code = squares[s - 1]
        grid[r][c] = _GLYPH[code] if code else f'{s:2d} '
    print()
    print("      White (w) side")
    for r in range(8):
        print(f"   {''.join(grid[r])}")
    print("      Black (b) side\n")


def fmt(move):
    path, captured = move
    return ('x' if captured else '-').join(str(p) for p in path)


def human_move(state):
    moves = legal_moves(state)
    print("Your legal moves:")
    for i, m in enumerate(moves):
        print(f"  [{i}] {fmt(m)}")
    while True:
        raw = input("Pick a move number (or 'q' to quit): ").strip()
        if raw.lower() == 'q':
            sys.exit(0)
        if raw.isdigit() and int(raw) < len(moves):
            return moves[int(raw)]
        print("  invalid — enter one of the listed numbers.")


def main():
    human = WHITE if (len(sys.argv) > 1 and sys.argv[1].lower() == 'white') else BLACK
    print(f"You are {'White' if human == WHITE else 'Black'}. "
          f"Engine searches to depth {ENGINE_DEPTH} (max {ENGINE_TIME}s/move).")

    state = initial_state()
    no_progress = 0
    while True:
        render(state)
        side = state[1]
        if not legal_moves(state):
            print(f"{'White' if side == WHITE else 'Black'} has no moves — "
                  f"{'Black' if side == WHITE else 'White'} wins!")
            return
        if side == human:
            move = human_move(state)
        else:
            print("Engine thinking...")
            move = best_move(state, max_depth=ENGINE_DEPTH, time_limit=ENGINE_TIME)
            print(f"Engine plays {fmt(move)}")

        nxt = apply_move(state, move)
        p0, k0 = _counts(state[0])
        p1, k1 = _counts(nxt[0])
        no_progress = 0 if (p1 < p0 or k1 > k0) else no_progress + 1
        state = nxt
        if no_progress >= 80:
            render(state)
            print("Draw — 40 moves with no capture or promotion.")
            return


if __name__ == "__main__":
    main()
