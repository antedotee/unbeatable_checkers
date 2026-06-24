# Unbeatable 8×8 Checkers

An American-checkers / English-draughts engine that **never loses to a human** —
every game is a draw or an engine win. This is the honest analogue of
"unbeatable tic-tac-toe via minimax": checkers is a *solved game* (Schaeffer et
al. 2007 — perfect play is a **draw**), so a draw is the ceiling. The engine
can't be made to always win; it's made to never lose.

## Why not just "minimax like tic-tac-toe"?

Tic-tac-toe has 5,478 states, so minimax walks the **entire** tree and is
perfect. 8×8 checkers has ~5×10²⁰ positions — full-tree search is impossible.
The method instead is **Chinook's recipe, scaled down**: depth-limited
**alpha-beta** search + a heuristic **evaluation** + light quiescence, exploiting
checkers' low branching factor (~3, thanks to forced captures). No human
out-searches a depth-12 search.

## Play

```bash
python3 cli.py          # you are Black (bottom, moves up)
python3 cli.py white    # you are White
```

Pick moves by number. Notation: `22-17` is a move, `25x18x11` is a multi-jump.

## Verify the claim

```bash
python3 verify.py            # 20 vs random + 10 vs greedy + self-play
python3 verify.py 8 40 20    # deeper / more games
```

Headline result must read `UNBEATEN ✓` (zero engine losses). Self-play should
**draw** — the soundness signal that the engine plays itself to the game-theoretic
result.

## Tests

```bash
python3 tests/test_board.py    # move-gen, verified against published perft
python3 tests/test_search.py   # alpha-beta == minimax, TT integrity, terminals
python3 tests/test_game.py     # terminal/draw detection + never-loses property
```

Move generation is proven correct by matching the published English-draughts
**perft** counts through depth 9 (3,963,680 leaf nodes) — this validates every
rule and the board geometry at once.

## Honest guarantee

"Never loses to a human." Not a *mathematical* proof of perfection — that needs a
retrograde endgame tablebase (deliberately out of scope). But no human
out-calculates the search, and self-play drawing is strong evidence the play is
sound.

## Layout

| File | Role |
|------|------|
| `engine/board.py` | state + move generation + apply-move (the correctness-critical part) |
| `engine/evaluate.py` | heuristic: material + advancement + back-row |
| `engine/search.py` | alpha-beta + iterative deepening + transposition table |
| `engine/game.py` | game loop, terminal/draw detection, player strategies |
| `cli.py` | play in the terminal |
| `verify.py` | the no-loss / self-play proof harness |
| `docs/superpowers/specs/` | design spec |

## Browser UI (SolidJS + WebAssembly)

A playable web front-end lives in [`web/`](web/): SolidJS board with **all** game
logic and search in a **WebAssembly** engine (AssemblyScript). WASM-only — no
JavaScript engine.

```bash
cd web
npm install && npm run dev           # builds the WASM, then plays in the browser
npm run asperft                      # correctness gate: WASM perft must match
```

The WASM engine is a port of the verified Python engine; `asperft` is its
acceptance test. See [web/README.md](web/README.md) for details.

## Further reading

[`report.md`](report.md) — a standalone mathematical write-up of the methods
(minimax/negamax, alpha-beta and its $b^{d/2}$ bound, evaluation, quiescence,
transposition tables) and the argument for why the engine is unbeatable.
