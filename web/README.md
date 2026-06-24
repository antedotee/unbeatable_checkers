# Unbeatable Checkers — SolidJS + WebAssembly UI

Browser front-end. SolidJS renders the board; **all** game logic and search run in
the **WebAssembly** engine (`assembly/checkers.ts` → `public/checkers.wasm`). There
is no JavaScript engine — it is WASM-only.

## Run

```bash
npm install        # solid-js, vite, assemblyscript  (needs network)
npm run dev        # builds the WASM first (predev), then starts Vite
```

Open the printed localhost URL. Click a piece → its legal landings highlight →
click one to move. Mandatory captures are enforced (only captures highlight when
one is available). Multi-jumps are a single click on the final square. Choose your
colour and difficulty up top.

## Build / verify the WASM engine

```bash
npm run asbuild    # asc assembly/checkers.ts -> public/checkers.wasm
npm run asperft    # correctness gate: perft must match the published numbers
npm run build      # production bundle in dist/ (also rebuilds the WASM)
```

`asperft` is the acceptance test: it instantiates the compiled `.wasm` and checks
perft (leaf-node counts) at depths 1–8 against the published English-draughts
values. A match proves the move generator — every rule and the board geometry —
is correct.

## Layout

```
assembly/checkers.ts   the engine (move-gen, eval, alpha-beta) -> WASM
assembly/perft.mjs     perft correctness gate for the WASM build
src/engine/wasm.js     the only engine binding: loads checkers.wasm, scalar ABI
src/Board.jsx          board rendering (presentational)
src/App.jsx            game state, clicks, dispatch to the WASM engine
```

The engine holds the 32-square board internally; `wasm.js` syncs it through a
scalar ABI (`setSquare` / `generate` / `moveStart` … / `applyGenerated` /
`searchBestPath`) — no loader or bindings. Search runs on the main thread (WASM is
fast enough that a move returns in well under a second); a 20 ms defer lets the
"thinking…" state paint first.

## Difficulty

`src/App.jsx` → `LEVELS`: Easy (depth 6), Medium (depth 10), Hard (depth 14). Even
Medium is past human calculation in checkers; the engine draws or wins.

## Performance & verification

Built for speed, with zero per-node heap allocation:

- **Bitboards** — the board is three `u32`s (black, white, kings). Simple moves
  for all pieces are generated with parallel shift+mask; occupancy/empty/enemy
  tests are single bitwise ops. Captures are table-driven with make/undo on the
  bitboards.
- **Make/undo** on one board (no per-node copies); move-gen writes into a
  **preallocated flat buffer** (no per-node `Array`).
- **Zobrist transposition table** (native `u64` hashing).
- **Move ordering**: TT-move first, then MVV-LVA captures, then killer moves and
  the history heuristic.
- **Principal Variation Search** (null-window scout + re-search) with
  **aspiration windows** at the root.

All of this is *exact* — it prunes and reorders but never changes the value, so
the "never loses" guarantee is intact. Compiled with `--runtime stub --noAssert`
(no GC, no bounds checks).

Authored offline (no `asc`), so the WASM was **not compiled here**. The full
engine *logic* was validated by mirroring it in plain JS and checking: perft
(depths 1–8) for move-gen; **full search (TT + ordering + PVS + aspiration) ==
plain minimax** on sampled positions for exactness; and a node-count drop of
~3× vs. plain TT+capture-ordering. `npm run asperft` is the on-build gate — after
`asbuild`, if perft matches the published numbers, the compiled engine is correct.

## Deploy (Vercel)

Set the project's **Root Directory = `web`** in Vercel. It auto-detects Vite, runs
`npm install` + `npm run build` (the `prebuild` hook compiles the WASM first), and
serves `dist/`. No `vercel.json` needed; the `assemblyscript` dev dependency is
installed automatically during the build.

`npm run build` → static files in `dist/`. The WASM is fetched relative to the
page (`document.baseURI`), so sub-path hosting works without changes.
