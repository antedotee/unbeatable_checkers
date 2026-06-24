import { createSignal, createMemo, onMount, Show, For } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import Board, { rcOf } from './Board.jsx';
import DitherBackground from './DitherBackground.jsx';
import Loading from './Loading.jsx';
import Menu from './Menu.jsx';
import { initEngine, legalMoves, applyMove, hasMoves, search } from './engine/wasm.js';
import { liftPlace, liftOff, landRing, winCelebration, endCard } from './motionfx.js';

const BLACK = 0, WHITE = 1;
const DEPTH = { Easy: 6, Medium: 10, Hard: 14 };
const THEMES = ['latte', 'walnut', 'slate', 'forest'];
const MOVE_MS = 320;

const initialBoard = () => {
  const sq = new Int8Array(32);
  for (let i = 0; i < 12; i++) sq[i] = 3;
  for (let i = 20; i < 32; i++) sq[i] = 1;
  return sq;
};
const initialPieces = () => {
  const list = [];
  let id = 0;
  for (let s = 1; s <= 12; s++) list.push({ id: id++, square: s, code: 3, captured: false });
  for (let s = 21; s <= 32; s++) list.push({ id: id++, square: s, code: 1, captured: false });
  return list;
};
const counts = (sq) => { let p = 0, k = 0; for (const c of sq) if (c) { p++; if (c === 2 || c === 4) k++; } return [p, k]; };
const manPromotes = (code, dest) => (code === 1 && rcOf(dest)[0] === 0) || (code === 3 && rcOf(dest)[0] === 7);

export default function App() {
  const [screen, setScreen] = createSignal('loading');
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [board, setBoard] = createSignal({ sq: initialBoard(), side: BLACK });
  const [pieces, setPieces] = createStore(initialPieces());
  const [humanColor, setHumanColor] = createSignal(BLACK);
  const [selected, setSelected] = createSignal(null);
  const [thinking, setThinking] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [result, setResult] = createSignal(null);
  const [theme, setTheme] = createSignal('latte');
  const [level, setLevel] = createSignal('Hard');
  const [lastMove, setLastMove] = createSignal(null);
  let noProgress = 0, pendingEngine = null, boardEl, cardEl;
  const discEls = new Map();
  const registerDisc = (id, el) => { if (el) discEls.set(id, el); };

  const humanTurn = () =>
    ready() && screen() === 'game' && !paused() && board().side === humanColor() && !result() && !thinking();
  const moves = createMemo(() =>
    screen() === 'game' && board().side === humanColor() && !result() ? legalMoves(board().sq, board().side) : []);
  const movable = createMemo(() => new Set(moves().map((m) => m.start)));
  const targets = createMemo(() => {
    const f = selected();
    return new Set(f == null ? [] : moves().filter((m) => m.start === f).map((m) => m.dest));
  });
  const lastSquares = createMemo(() => {
    const m = lastMove();
    return new Set(m ? [m.start, m.dest] : []);
  });

  onMount(async () => {
    const t0 = performance.now();
    try { await initEngine(); }
    catch (e) { setError(e.message); return; }
    setTimeout(() => setReady(true), Math.max(0, 1100 - (performance.now() - t0)));
  });

  function showResult(r) {
    setResult(r);
    if (r.kind === 'win') winCelebration(cardEl);
    else endCard(cardEl, boardEl, r.kind === 'lose');
  }

  function advance(move) {
    const s = board();
    const nsq = applyMove(s.sq, s.side, move);
    const [p0, k0] = counts(s.sq);
    const [p1, k1] = counts(nsq);
    noProgress = (p1 < p0 || k1 > k0) ? 0 : noProgress + 1;

    // identify pieces for animation BEFORE mutating the store
    const moving = pieces.find((pc) => pc.square === move.start && !pc.captured);
    const movingId = moving ? moving.id : -1;
    const willPromote = moving ? manPromotes(moving.code, move.dest) : false;
    const capIds = move.caps
      .map((cap) => { const pc = pieces.find((p) => p.square === cap && !p.captured); return pc ? pc.id : null; })
      .filter((x) => x != null);

    setPieces(produce((list) => {
      for (const cap of move.caps) { const cp = list.find((pc) => pc.square === cap && !pc.captured); if (cp) cp.captured = true; }
      const mp = list.find((pc) => pc.square === move.start && !pc.captured);
      if (mp) { mp.square = move.dest; if (manPromotes(mp.code, move.dest)) mp.code = mp.code === 1 ? 2 : 4; }
    }));

    liftPlace(discEls.get(movingId), willPromote);
    setTimeout(() => landRing(boardEl, move.dest), MOVE_MS);
    if (capIds.length) {
      const capDiscs = capIds.map((id) => discEls.get(id)).filter(Boolean);
      setTimeout(() => capDiscs.forEach(liftOff), MOVE_MS * 0.45);
      setTimeout(() => setPieces((l) => l.filter((pc) => !pc.captured)), MOVE_MS * 0.45 + 380);
    }

    setBoard({ sq: nsq, side: 1 - s.side });
    setSelected(null);
    setLastMove({ start: move.start, dest: move.dest });

    const ns = 1 - s.side;
    if (!hasMoves(nsq, ns)) {
      showResult(ns === humanColor() ? { kind: 'lose', text: 'ENGINE WINS' } : { kind: 'win', text: 'YOU WIN!' });
      return;
    }
    if (noProgress >= 80) { showResult({ kind: 'draw', text: 'DRAW' }); return; }
    if (ns !== humanColor()) engineMove({ sq: nsq, side: ns });
  }

  function engineMove(s) {
    setThinking(true);
    setTimeout(() => {
      if (paused()) { pendingEngine = s; setThinking(false); return; }
      const mv = search(s.sq, s.side, DEPTH[level()]);
      setThinking(false);
      if (mv) advance(mv);
    }, MOVE_MS + 40);
  }

  function resume() {
    setPaused(false);
    if (pendingEngine) { const s = pendingEngine; pendingEngine = null; engineMove(s); }
  }

  function onClick(square) {
    if (!humanTurn()) return;
    const f = selected();
    if (f != null) {
      const mv = moves().find((m) => m.start === f && m.dest === square);
      if (mv) { advance(mv); return; }
    }
    setSelected(movable().has(square) ? square : null);
  }

  function newGame(color) {
    noProgress = 0; pendingEngine = null;
    setHumanColor(color);
    setSelected(null); setResult(null); setLastMove(null); setThinking(false); setPaused(false);
    setPieces(initialPieces());
    const s = { sq: initialBoard(), side: BLACK };
    setBoard(s);
    if (s.side !== color) engineMove(s);
  }

  const startGame = () => { newGame(humanColor()); setScreen('game'); };
  const turnLabel = () => result() ? 'GAME OVER' : thinking() ? 'ENGINE…' : (board().side === humanColor() ? 'YOUR TURN' : 'ENGINE');

  return (
    <div class="app" data-theme={theme()}>
      <DitherBackground />

      <Show when={error()}><div class="screen"><div class="panel error-panel">{error()}</div></div></Show>

      <Show when={!error() && screen() === 'loading'}>
        <Loading ready={ready} onStart={() => setScreen('menu')} />
      </Show>

      <Show when={screen() === 'menu'}>
        <Menu level={level} onLevel={setLevel} color={humanColor} onColor={setHumanColor}
          theme={theme} onTheme={setTheme} onPlay={startGame} />
      </Show>

      <Show when={screen() === 'game'}>
        <div class="screen game-screen">
          <div class="hud">
            <span class="hud-turn" classList={{ live: board().side === humanColor() && !result() }}>{turnLabel()}</span>
            <span class="hud-tele">DEPTH<b>{DEPTH[level()]}</b></span>
            <div class="hud-right">
              <div class="hud-themes" role="group" aria-label="Board">
                <For each={THEMES}>{(t) => (
                  <button class="hud-swatch" classList={{ on: theme() === t }} data-theme={t}
                    aria-label={`${t} board`} onClick={() => setTheme(t)}><span class="swatch-chip" /></button>
                )}</For>
              </div>
              <button class="hud-btn" onClick={() => setPaused(true)} disabled={!!result()}>HALT</button>
              <button class="hud-btn" onClick={() => setScreen('menu')}>ABORT</button>
            </div>
          </div>

          <div class="board-wrap">
            <Board boardRef={(el) => (boardEl = el)} pieces={pieces} selected={selected}
              targets={targets} movable={movable} lastSquares={lastSquares}
              interactive={humanTurn} onClick={onClick} registerDisc={registerDisc} />

            <Show when={paused() && !result()}>
              <div class="overlay">
                <div class="panel result-card">
                  <h2 class="panel-title">[ HALTED ]</h2>
                  <div class="result-actions">
                    <button class="play-btn" onClick={resume}>▶ RESUME</button>
                    <button class="opt-color" onClick={() => { setPaused(false); setScreen('menu'); }}>ABORT</button>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={result()}>
              <div class="overlay">
                <div class="panel result-card" ref={(el) => (cardEl = el)}
                  classList={{ win: result().kind === 'win', lose: result().kind === 'lose' }}>
                  <div class="result-emoji">{result().kind === 'win' ? '🏆' : result().kind === 'lose' ? '🛡' : '🤝'}</div>
                  <h2 class="panel-title">{result().text}</h2>
                  <div class="result-actions">
                    <button class="play-btn" onClick={() => newGame(humanColor())}>▶ REMATCH</button>
                    <button class="opt-color" onClick={() => setScreen('menu')}>ABORT</button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
