// Motion (motion.dev) — Emil's recommended library. Vanilla `animate` works in
// Solid. Choreographed piece motion: pick-up → carry → firm place, and a
// pluck-off on capture. Confetti stays on canvas-confetti.
import { animate } from 'motion';
import confetti from 'canvas-confetti';

const reduce = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cell(boardEl, square) {
  const r = (square - 1) >> 2;
  const idx = (square - 1) & 3;
  const c = 2 * idx + (r % 2 === 0 ? 1 : 0);
  const size = boardEl.clientWidth / 8;
  return { x: (c + 0.5) * size, y: (r + 0.5) * size, size };
}

// pick the piece up, carry it (the anchor slides under it), set it down firmly
export function liftPlace(disc, promoted) {
  if (!disc || reduce()) return;
  const a = animate(disc,
    { y: [0, -10, -10, 3, 0], scale: [1, 1.12, 1.12, 0.97, 1] },
    { duration: 0.34, ease: 'easeInOut' });
  if (promoted) {
    a.finished.then(() =>
      animate(disc, { scale: [1, 1.3, 1], rotate: [0, -8, 0] }, { duration: 0.42, ease: 'backOut' })
    ).catch(() => {});
  }
}

// captured: plucked up off the board, then removed
export function liftOff(disc) {
  if (!disc || reduce()) return Promise.resolve();
  return animate(disc, { y: -26, scale: 1.32, opacity: 0, rotate: 10 }, { duration: 0.36, ease: 'easeIn' }).finished;
}

// a pulse ring where a piece is set down
export function landRing(boardEl, square) {
  if (!boardEl || reduce()) return;
  const { x, y, size } = cell(boardEl, square);
  const ring = document.createElement('span');
  ring.className = 'fx-ring';
  ring.style.width = ring.style.height = size * 0.9 + 'px';
  ring.style.left = x - size * 0.45 + 'px';
  ring.style.top = y - size * 0.45 + 'px';
  boardEl.appendChild(ring);
  animate(ring, { scale: [0.55, 1.12], opacity: [0.75, 0] }, { duration: 0.42, ease: 'easeOut' })
    .finished.then(() => ring.remove()).catch(() => {});
}

function cardPop(card, big) {
  if (!card) return;
  animate(card,
    big ? { scale: [0.8, 1], opacity: [0, 1], rotate: [-3, 0] } : { scale: [0.86, 1], opacity: [0, 1] },
    { duration: reduce() ? 0 : (big ? 0.5 : 0.4), ease: 'backOut' });
}

export function winCelebration(card) {
  cardPop(card, true);
  if (reduce()) return;
  const colors = ['#f3c14b', '#56d364', '#6aa9ff', '#ff7ab6', '#ffffff'];
  confetti({ particleCount: 130, spread: 95, startVelocity: 48, origin: { y: 0.55 }, colors });
  confetti({ particleCount: 60, angle: 60, spread: 70, origin: { x: 0, y: 0.75 }, colors });
  confetti({ particleCount: 60, angle: 120, spread: 70, origin: { x: 1, y: 0.75 }, colors });
  setTimeout(() => confetti({ particleCount: 90, spread: 120, startVelocity: 38, origin: { y: 0.5 }, colors }), 260);
}

export function endCard(card, boardEl, isLoss) {
  cardPop(card, false);
  if (reduce()) return;
  if (isLoss && boardEl) animate(boardEl, { x: [0, -7, 7, -5, 5, 0] }, { duration: 0.45, ease: 'easeInOut' });
  if (!isLoss) return;
  const grays = ['#9aa0a8', '#6b7280', '#4b5563', '#cbd5e1'];
  const end = Date.now() + 1400;
  (function fall() {
    confetti({ particleCount: 3, angle: 270, startVelocity: 12, gravity: 0.55, spread: 70, ticks: 220, scalar: 0.9, origin: { x: Math.random(), y: -0.1 }, colors: grays });
    if (Date.now() < end) requestAnimationFrame(fall);
  })();
}
