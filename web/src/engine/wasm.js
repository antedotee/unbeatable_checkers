// The only engine binding: all rules and search come from checkers.wasm.
// Build it with `npm run asbuild` (outputs public/checkers.wasm).
//
// The WASM holds the board; we push/pull it through a scalar ABI (no loader).

let ex = null;

export async function initEngine() {
  if (ex) return;
  const resp = await fetch(new URL('checkers.wasm', document.baseURI));
  if (!resp.ok) throw new Error('checkers.wasm not found — run `npm run asbuild`');
  const { instance } = await WebAssembly.instantiate(
    await resp.arrayBuffer(), { env: { abort() {} } });
  ex = instance.exports;
}

function setBoard(sq) { for (let i = 0; i < 32; i++) ex.setSquare(i, sq[i]); }
function getBoard() {
  const a = new Int8Array(32);
  for (let i = 0; i < 32; i++) a[i] = ex.getSquare(i);
  return a;
}

// Legal moves for `side` from board `sq`. Returns [{start, dest, caps}].
export function legalMoves(sq, side) {
  setBoard(sq);
  const n = ex.generate(side);
  const moves = [];
  for (let m = 0; m < n; m++) {
    const caps = [];
    const nc = ex.moveCapCount(m);
    for (let i = 0; i < nc; i++) caps.push(ex.moveCap(m, i));
    moves.push({ start: ex.moveStart(m), dest: ex.moveDest(m), caps });
  }
  return moves;
}

// Apply the move-list entry whose start/dest match; returns the new board.
// (Re-generates internally so the index is always valid for the current board.)
export function applyMove(sq, side, move) {
  setBoard(sq);
  const n = ex.generate(side);
  for (let m = 0; m < n; m++) {
    if (ex.moveStart(m) === move.start && ex.moveDest(m) === move.dest) {
      ex.applyGenerated(m);
      return getBoard();
    }
  }
  return sq; // no match (shouldn't happen)
}

export function hasMoves(sq, side) {
  setBoard(sq);
  return ex.generate(side) > 0;
}

// Best move for `side` at the given depth: {start, dest, caps} or null.
export function search(sq, side, maxDepth) {
  setBoard(sq);
  const len = ex.searchBestPath(side, maxDepth);
  if (len === 0) return null;
  const caps = [];
  const nc = ex.getPathSquare(2);
  for (let i = 0; i < nc; i++) caps.push(ex.getPathSquare(3 + i));
  return { start: ex.getPathSquare(0), dest: ex.getPathSquare(1), caps };
}
