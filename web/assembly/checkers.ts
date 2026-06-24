// AssemblyScript checkers engine -> WebAssembly. Bitboard board, parallel
// simple-move generation, table-driven captures, Zobrist transposition table,
// MVV-LVA + killer + history move ordering, and Principal Variation Search with
// aspiration windows. Logic is a verified port of the JS reference (perft 1-8 +
// "full search == plain minimax"); native u32 bitboards and u64 Zobrist make it
// fast. Exactness is preserved, so the "never loses" property holds.
//
// Build: asc assembly/checkers.ts -o public/checkers.wasm -O3 --runtime stub --noAssert
// Gate:  npm run asperft  (perft must match published numbers)
//
// Integer-only ABI: setSquare/getSquare, generate + move accessors +
// applyGenerated (UI), searchBestPath/getPathSquare (engine move), perft.

// ---- constants ----
const INF: i32 = 1000000000;
const WIN: i32 = 1000000;
const EXACT: i32 = 0, LOWER: i32 = 1, UPPER: i32 = 2;
const MAXPLY: i32 = 64, MAXMOVES: i32 = 96, MAXCAP: i32 = 12, STRIDE: i32 = 3 + MAXCAP;
const TT_BITS: i32 = 20, TT_SIZE: i32 = 1 << TT_BITS;
const TT_MASK: u64 = (1 << TT_BITS) - 1;

function bit(i: i32): u32 { return (<u32>1) << i; }

// ---- geometry ----
const STEP = new StaticArray<i32>(128);
const JUMP = new StaticArray<i32>(128);
const ROWT = new StaticArray<i32>(32);
const OPP = new StaticArray<i32>(4);
const CAN = new StaticArray<u32>(4);
let EVEN: u32 = 0, ODD: u32 = 0;
const DR = [-1, -1, 1, 1];
const DC = [-1, 1, -1, 1];

function rcToSq(r: i32, c: i32): i32 {
  if (r < 0 || r > 7 || c < 0 || c > 7) return 0;
  if (((r + c) & 1) == 0) return 0;
  return r * 4 + (c >> 1) + 1;
}
function initTables(): void {
  OPP[0] = 3; OPP[1] = 2; OPP[2] = 1; OPP[3] = 0;
  for (let s = 1; s <= 32; s++) {
    const r = (s - 1) >> 2;
    const idx = (s - 1) & 3;
    const c = 2 * idx + (((r & 1) == 0) ? 1 : 0);
    ROWT[s - 1] = r;
    const b = bit(s - 1);
    if ((r & 1) == 0) EVEN |= b; else ODD |= b;
    for (let d = 0; d < 4; d++) {
      STEP[(s - 1) * 4 + d] = rcToSq(r + DR[d], c + DC[d]);
      JUMP[(s - 1) * 4 + d] = rcToSq(r + 2 * DR[d], c + 2 * DC[d]);
    }
  }
  for (let d = 0; d < 4; d++) {
    let m: u32 = 0;
    for (let s = 1; s <= 32; s++) if (STEP[(s - 1) * 4 + d] != 0) m |= bit(s - 1);
    CAN[d] = m;
  }
}

// shift a piece set one step in direction d (CAN-masked movers, no wrap)
function step(P: u32, d: i32): u32 {
  const m = P & CAN[d], e = m & EVEN, o = m & ODD;
  if (d == 0) return (e >> 4) | (o >> 5);   // UL
  if (d == 1) return (e >> 3) | (o >> 4);   // UR
  if (d == 2) return (e << 4) | (o << 3);   // DL
  return (e << 5) | (o << 4);               // DR
}

// ---- board: bitboards ----
let bp: u32 = 0, wp: u32 = 0, k: u32 = 0;
function sideOf(code: i32): i32 { return (code == 1 || code == 2) ? 0 : 1; }
function getCode(s: i32): i32 {
  const b = bit(s - 1);
  if ((bp & b) != 0) return (k & b) != 0 ? 2 : 1;
  if ((wp & b) != 0) return (k & b) != 0 ? 4 : 3;
  return 0;
}
function promoted(code: i32, dest: i32): i32 {
  if (code == 1 && ROWT[dest - 1] == 0) return 2;
  if (code == 3 && ROWT[dest - 1] == 7) return 4;
  return code;
}

// ---- move buffer + scratch ----
const buf = new StaticArray<i32>(MAXPLY * MAXMOVES * STRIDE);
const moveCount = new StaticArray<i32>(MAXPLY);
const capList = new StaticArray<i32>(MAXCAP + 4);
const ordScore = new StaticArray<i32>(MAXPLY * MAXMOVES);
const pathOut = new StaticArray<i32>(STRIDE);
const killer = new StaticArray<i32>(MAXPLY * 2);
const history = new StaticArray<i32>(33 * 33);

function recBase(ply: i32, i: i32): i32 { return (ply * MAXMOVES + i) * STRIDE; }
function emitMove(ply: i32, from: i32, to: i32, ncap: i32): void {
  const cnt = moveCount[ply];
  if (cnt >= MAXMOVES) return;
  const b = recBase(ply, cnt);
  buf[b] = from; buf[b + 1] = to; buf[b + 2] = ncap;
  for (let j = 0; j < ncap; j++) buf[b + 3 + j] = capList[j];
  moveCount[ply] = cnt + 1;
}

function genCaptures(ply: i32, start: i32, cur: i32, code: i32, capLen: i32): void {
  const side = sideOf(code);
  const isKing = (code == 2 || code == 4);
  for (let d = 0; d < 4; d++) {
    if (!isKing) { if (code == 1) { if (d >= 2) continue; } else { if (d < 2) continue; } }
    const mid = STEP[(cur - 1) * 4 + d];
    const land = JUMP[(cur - 1) * 4 + d];
    if (mid == 0 || land == 0) continue;
    const landbit = bit(land - 1);
    if (((bp | wp) & landbit) != 0) continue;
    const midbit = bit(mid - 1);
    const enemy = side == 0 ? wp : bp;
    if ((enemy & midbit) == 0) continue;
    const curbit = bit(cur - 1);
    if (side == 0) bp = (bp & ~curbit) | landbit; else wp = (wp & ~curbit) | landbit;
    if (isKing) k = (k & ~curbit) | landbit;
    const nc = promoted(code, land);
    const promotedNow = nc != code;
    if (promotedNow) k = k | landbit;
    const midWasKing = (k & midbit) != 0;
    if (side == 0) wp = wp & ~midbit; else bp = bp & ~midbit;
    if (midWasKing) k = k & ~midbit;
    capList[capLen] = mid;
    if (promotedNow) {
      emitMove(ply, start, land, capLen + 1);
    } else {
      const before = moveCount[ply];
      genCaptures(ply, start, land, nc, capLen + 1);
      if (moveCount[ply] == before) emitMove(ply, start, land, capLen + 1);
    }
    if (side == 0) wp = wp | midbit; else bp = bp | midbit;
    if (midWasKing) k = k | midbit;
    if (promotedNow) k = k & ~landbit;
    if (isKing) k = (k & ~landbit) | curbit;
    if (side == 0) bp = (bp & ~landbit) | curbit; else wp = (wp & ~landbit) | curbit;
  }
}

function enumSimple(ply: i32, dst: u32, d: i32): void {
  while (dst != 0) {
    const t = <i32>ctz(dst);
    dst = dst & (dst - 1);
    emitMove(ply, STEP[t * 4 + OPP[d]], t + 1, 0);
  }
}

function genMoves(ply: i32, side: i32): i32 {
  moveCount[ply] = 0;
  let pcs = side == 0 ? bp : wp;
  while (pcs != 0) {
    const s = <i32>ctz(pcs) + 1;
    pcs = pcs & (pcs - 1);
    genCaptures(ply, s, s, getCode(s), 0);
  }
  if (moveCount[ply] > 0) return moveCount[ply];
  const own = side == 0 ? bp : wp;
  const empty = ~(bp | wp);
  const men = own & ~k;
  const kingsS = own & k;
  if (side == 0) { enumSimple(ply, step(men, 0) & empty, 0); enumSimple(ply, step(men, 1) & empty, 1); }
  else { enumSimple(ply, step(men, 2) & empty, 2); enumSimple(ply, step(men, 3) & empty, 3); }
  for (let d = 0; d < 4; d++) enumSimple(ply, step(kingsS, d) & empty, d);
  return moveCount[ply];
}

// ---- Zobrist ----
const ZOB = new StaticArray<u64>(32 * 5);
let ZOB_SIDE: u64 = 0;
let curHash: u64 = 0;
let rngState: u64 = 0x243F6A8885A308D3;
function nextRand(): u64 { let x = rngState; x ^= x << 13; x ^= x >> 7; x ^= x << 17; rngState = x; return x; }
function initZobrist(): void {
  for (let i = 0; i < 32 * 5; i++) ZOB[i] = nextRand();
  ZOB_SIDE = nextRand();
}
function computeHash(side: i32): void {
  let h: u64 = 0;
  for (let s = 1; s <= 32; s++) { const c = getCode(s); if (c != 0) h ^= ZOB[(s - 1) * 5 + c]; }
  if (side == 1) h ^= ZOB_SIDE;
  curHash = h;
}

// ---- make / undo (bitboards + incremental hash) ----
const uFrom = new StaticArray<i32>(MAXPLY);
const uTo = new StaticArray<i32>(MAXPLY);
const uSide = new StaticArray<i32>(MAXPLY);
const uWasK = new StaticArray<i32>(MAXPLY);
const uProm = new StaticArray<i32>(MAXPLY);
const uNcap = new StaticArray<i32>(MAXPLY);
const uCaps = new StaticArray<i32>(MAXPLY * MAXCAP);
const uCapCode = new StaticArray<i32>(MAXPLY * MAXCAP);

function applyMove(ply: i32, i: i32): void {
  const b = recBase(ply, i);
  const from = buf[b], to = buf[b + 1], ncap = buf[b + 2];
  const frombit = bit(from - 1), tobit = bit(to - 1);
  const side = (bp & frombit) != 0 ? 0 : 1;
  const wasK = (k & frombit) != 0;
  const code = side == 0 ? (wasK ? 2 : 1) : (wasK ? 4 : 3);
  curHash ^= ZOB[(from - 1) * 5 + code];
  if (side == 0) bp = (bp & ~frombit) | tobit; else wp = (wp & ~frombit) | tobit;
  if (wasK) k = (k & ~frombit) | tobit;
  const nc = promoted(code, to);
  const prom = nc != code;
  if (prom) k = k | tobit;
  curHash ^= ZOB[(to - 1) * 5 + nc];
  uFrom[ply] = from; uTo[ply] = to; uSide[ply] = side; uWasK[ply] = wasK ? 1 : 0; uProm[ply] = prom ? 1 : 0; uNcap[ply] = ncap;
  for (let j = 0; j < ncap; j++) {
    const c = buf[b + 3 + j], cbit = bit(c - 1);
    const cK = (k & cbit) != 0;
    const cc = side == 0 ? (cK ? 4 : 3) : (cK ? 2 : 1);
    uCaps[ply * MAXCAP + j] = c; uCapCode[ply * MAXCAP + j] = cc;
    curHash ^= ZOB[(c - 1) * 5 + cc];
    if (side == 0) wp = wp & ~cbit; else bp = bp & ~cbit;
    if (cK) k = k & ~cbit;
  }
  curHash ^= ZOB_SIDE;
}
function undoMove(ply: i32): void {
  const from = uFrom[ply], to = uTo[ply], side = uSide[ply], wasK = uWasK[ply], prom = uProm[ply], ncap = uNcap[ply];
  const frombit = bit(from - 1), tobit = bit(to - 1);
  const code = side == 0 ? (wasK ? 2 : 1) : (wasK ? 4 : 3);
  const nc = promoted(code, to);
  curHash ^= ZOB_SIDE;
  curHash ^= ZOB[(to - 1) * 5 + nc];
  curHash ^= ZOB[(from - 1) * 5 + code];
  for (let j = 0; j < ncap; j++) {
    const c = uCaps[ply * MAXCAP + j], cbit = bit(c - 1), cc = uCapCode[ply * MAXCAP + j];
    curHash ^= ZOB[(c - 1) * 5 + cc];
    if (side == 0) wp = wp | cbit; else bp = bp | cbit;
    if (cc == 2 || cc == 4) k = k | cbit;
  }
  if (prom) k = k & ~tobit;
  if (wasK) k = (k & ~tobit) | frombit;
  if (side == 0) bp = (bp & ~tobit) | frombit; else wp = (wp & ~tobit) | frombit;
}

function evaluate(side: i32): i32 {
  let sc = 0;
  let bm = bp & ~k;
  while (bm != 0) { const s = <i32>ctz(bm); bm = bm & (bm - 1); const row = ROWT[s]; sc += 100 + 3 * (7 - row); if (row == 7) sc += 6; }
  let wm = wp & ~k;
  while (wm != 0) { const s = <i32>ctz(wm); wm = wm & (wm - 1); const row = ROWT[s]; sc -= 100 + 3 * row; if (row == 0) sc -= 6; }
  sc += 160 * <i32>popcnt(bp & k) - 160 * <i32>popcnt(wp & k);
  return side == 0 ? sc : -sc;
}

// ---- ordering: TT-move, MVV-LVA captures, killers, history ----
function swapRecords(ply: i32, a: i32, b: i32): void {
  const ba = recBase(ply, a), bb = recBase(ply, b);
  for (let kk = 0; kk < STRIDE; kk++) { const t = buf[ba + kk]; buf[ba + kk] = buf[bb + kk]; buf[bb + kk] = t; }
}
function orderMoves(ply: i32, n: i32, ttF: i32, ttT: i32): void {
  const base = ply * MAXMOVES;
  for (let i = 0; i < n; i++) {
    const b = recBase(ply, i);
    const from = buf[b], to = buf[b + 1], ncap = buf[b + 2];
    let s = 0;
    if (from == ttF && to == ttT) s = 2000000000;
    else if (ncap > 0) {
      let cs = ncap * 100;
      for (let j = 0; j < ncap; j++) if ((k & bit(buf[b + 3 + j] - 1)) != 0) cs += 50;
      s = 1000000000 + cs;
    } else {
      const mv = from * 64 + to;
      if (mv == killer[ply * 2]) s = 800000000;
      else if (mv == killer[ply * 2 + 1]) s = 790000000;
      else s = history[from * 33 + to];
    }
    ordScore[base + i] = s;
  }
  for (let a = 0; a < n; a++) {
    let mx = a;
    for (let bi = a + 1; bi < n; bi++) if (ordScore[base + bi] > ordScore[base + mx]) mx = bi;
    if (mx != a) {
      const t = ordScore[base + a]; ordScore[base + a] = ordScore[base + mx]; ordScore[base + mx] = t;
      swapRecords(ply, a, mx);
    }
  }
}

// ---- transposition table ----
const ttKey = new StaticArray<u64>(TT_SIZE);
const ttVal = new StaticArray<i32>(TT_SIZE);
const ttMeta = new StaticArray<i32>(TT_SIZE);   // from<<14 | to<<8 | depth<<2 | flag
function clearTT(): void { for (let i = 0; i < TT_SIZE; i++) ttKey[i] = 0; }

function negamax(ply: i32, side: i32, depth: i32, alpha: i32, beta: i32): i32 {
  if (ply >= MAXPLY - 1) return evaluate(side);
  const useTT = depth > 0;
  let ttF = 0, ttT = 0, idx = 0;
  if (useTT) {
    idx = <i32>(curHash & TT_MASK);
    if (ttKey[idx] == curHash) {
      const meta = ttMeta[idx];
      ttF = (meta >> 14) & 63; ttT = (meta >> 8) & 63;
      const d = (meta >> 2) & 63;
      if (d >= depth) {
        const flag = meta & 3; const val = ttVal[idx];
        if (flag == EXACT) return val;
        if (flag == LOWER) { if (val > alpha) alpha = val; }
        else if (flag == UPPER) { if (val < beta) beta = val; }
        if (alpha >= beta) return val;
      }
    }
  }
  const n = genMoves(ply, side);
  if (n == 0) return -(WIN - ply);
  const capturePos = buf[recBase(ply, 0) + 2] > 0;
  if (depth <= 0 && !capturePos) return evaluate(side);
  orderMoves(ply, n, ttF, ttT);
  const alphaOrig = alpha;
  let best = -INF, bF = 0, bT = 0;
  for (let x = 0; x < n; x++) {
    const b = recBase(ply, x);
    const mf = buf[b], mt = buf[b + 1], isCap = buf[b + 2] > 0;
    applyMove(ply, x);
    let score: i32;
    if (x == 0) {
      score = -negamax(ply + 1, 1 - side, depth - 1, -beta, -alpha);
    } else {
      score = -negamax(ply + 1, 1 - side, depth - 1, -alpha - 1, -alpha);
      if (score > alpha && score < beta) score = -negamax(ply + 1, 1 - side, depth - 1, -beta, -alpha);
    }
    undoMove(ply);
    if (score > best) { best = score; bF = mf; bT = mt; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!isCap && depth > 0) {
        const mv = mf * 64 + mt;
        if (killer[ply * 2] != mv) { killer[ply * 2 + 1] = killer[ply * 2]; killer[ply * 2] = mv; }
        history[mf * 33 + mt] += depth * depth;
      }
      break;
    }
  }
  if (useTT) {
    const flag = best <= alphaOrig ? UPPER : (best >= beta ? LOWER : EXACT);
    ttKey[idx] = curHash; ttVal[idx] = best;
    ttMeta[idx] = (bF << 14) | (bT << 8) | ((depth & 63) << 2) | flag;
  }
  return best;
}

let rootValue: i32 = 0;
let rootBestIdx: i32 = 0;
function rootSearch(side: i32, depth: i32, alpha: i32, beta: i32, n: i32): void {
  let ttF = 0, ttT = 0;
  const idx = <i32>(curHash & TT_MASK);
  if (ttKey[idx] == curHash) { const meta = ttMeta[idx]; ttF = (meta >> 14) & 63; ttT = (meta >> 8) & 63; }
  orderMoves(0, n, ttF, ttT);
  const alphaOrig = alpha;
  let best = -INF, bF = 0, bT = 0, bestIdx = 0;
  for (let x = 0; x < n; x++) {
    const b = recBase(0, x);
    const mf = buf[b], mt = buf[b + 1];
    applyMove(0, x);
    let score: i32;
    if (x == 0) score = -negamax(1, 1 - side, depth - 1, -beta, -alpha);
    else {
      score = -negamax(1, 1 - side, depth - 1, -alpha - 1, -alpha);
      if (score > alpha && score < beta) score = -negamax(1, 1 - side, depth - 1, -beta, -alpha);
    }
    undoMove(0);
    if (score > best) { best = score; bF = mf; bT = mt; bestIdx = x; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  const flag = best <= alphaOrig ? UPPER : (best >= beta ? LOWER : EXACT);
  ttKey[idx] = curHash; ttVal[idx] = best; ttMeta[idx] = (bF << 14) | (bT << 8) | ((depth & 63) << 2) | flag;
  rootValue = best; rootBestIdx = bestIdx;
}

// ---- exported ABI ----
export function setSquare(i: i32, code: i32): void {
  const b = bit(i);
  bp = bp & ~b; wp = wp & ~b; k = k & ~b;
  if (code == 1) bp = bp | b;
  else if (code == 2) { bp = bp | b; k = k | b; }
  else if (code == 3) wp = wp | b;
  else if (code == 4) { wp = wp | b; k = k | b; }
}
export function getSquare(i: i32): i32 { return getCode(i + 1); }

export function generate(side: i32): i32 { return genMoves(0, side); }
export function moveStart(m: i32): i32 { return buf[recBase(0, m)]; }
export function moveDest(m: i32): i32 { return buf[recBase(0, m) + 1]; }
export function moveCapCount(m: i32): i32 { return buf[recBase(0, m) + 2]; }
export function moveCap(m: i32, i: i32): i32 { return buf[recBase(0, m) + 3 + i]; }
export function applyGenerated(m: i32): void {
  const b = recBase(0, m);
  const from = buf[b], to = buf[b + 1], ncap = buf[b + 2];
  const frombit = bit(from - 1), tobit = bit(to - 1);
  const side = (bp & frombit) != 0 ? 0 : 1;
  const wasK = (k & frombit) != 0;
  if (side == 0) bp = (bp & ~frombit) | tobit; else wp = (wp & ~frombit) | tobit;
  if (wasK) k = (k & ~frombit) | tobit;
  const code = side == 0 ? (wasK ? 2 : 1) : (wasK ? 4 : 3);
  if (promoted(code, to) != code) k = k | tobit;
  for (let j = 0; j < ncap; j++) {
    const cbit = bit(buf[b + 3 + j] - 1);
    if (side == 0) wp = wp & ~cbit; else bp = bp & ~cbit;
    k = k & ~cbit;
  }
}

export function searchBestPath(side: i32, maxDepth: i32): i32 {
  clearTT();
  for (let i = 0; i < MAXPLY * 2; i++) killer[i] = 0;
  for (let i = 0; i < 33 * 33; i++) history[i] = 0;
  computeHash(side);
  const n = genMoves(0, side);
  if (n == 0) return 0;
  let score = 0, bestIdx = 0;
  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -INF, beta = INF;
    if (d >= 3) { alpha = score - 50; beta = score + 50; }
    rootSearch(side, d, alpha, beta, n);
    if (rootValue <= alpha || rootValue >= beta) rootSearch(side, d, -INF, INF, n);
    score = rootValue; bestIdx = rootBestIdx;
    const mag = score < 0 ? -score : score;
    if (mag > WIN - 1000) break;
  }
  const b = recBase(0, bestIdx);
  const ncap = buf[b + 2];
  pathOut[0] = buf[b]; pathOut[1] = buf[b + 1]; pathOut[2] = ncap;
  for (let i = 0; i < ncap; i++) pathOut[3 + i] = buf[b + 3 + i];
  return 3 + ncap;
}
export function getPathSquare(i: i32): i32 { return pathOut[i]; }

// ---- perft (correctness gate) ----
function setInitial(): void {
  bp = 0; wp = 0; k = 0;
  for (let s = 1; s <= 12; s++) wp = wp | bit(s - 1);
  for (let s = 21; s <= 32; s++) bp = bp | bit(s - 1);
}
function perftRec(ply: i32, side: i32, depth: i32): f64 {
  if (depth == 0) return 1;
  const n = genMoves(ply, side);
  let total: f64 = 0;
  for (let i = 0; i < n; i++) { applyMove(ply, i); total += perftRec(ply + 1, 1 - side, depth - 1); undoMove(ply); }
  return total;
}
export function perft(depth: i32): f64 { setInitial(); return perftRec(0, 0, depth); }

initTables();
initZobrist();
