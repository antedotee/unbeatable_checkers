import { For, Show } from 'solid-js';

export function rcOf(square) {
  const r = (square - 1) >> 2;
  const idx = (square - 1) & 3;
  return [r, 2 * idx + (r % 2 === 0 ? 1 : 0)];
}

const CELLS = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) CELLS.push([r, c]);

export default function Board(props) {
  const squareAt = (r, c) => ((r + c) % 2 === 1) ? r * 4 + (c >> 1) + 1 : null;
  const selPiece = () => {
    const s = props.selected();
    return s == null ? null : props.pieces.find((p) => p.square === s && !p.captured);
  };
  const ghostCode = () => { const p = selPiece(); return p ? p.code : 0; };

  return (
    <div class="board-frame">
      <div class="board" role="grid" aria-label="Checkers board" ref={props.boardRef}>
        <For each={CELLS}>{([r, c]) => {
          const square = squareAt(r, c);
          const dark = (r + c) % 2 === 1;
          const tabbable = () =>
            square != null && props.interactive() &&
            (props.movable().has(square) || props.targets().has(square));
          return (
            <button
              type="button" class="cell"
              classList={{
                dark, light: !dark,
                sel: square != null && square === props.selected(),
                movable: square != null && props.movable().has(square),
                last: square != null && props.lastSquares().has(square),
              }}
              disabled={square == null || !props.interactive()}
              tabindex={tabbable() ? 0 : -1}
              aria-label={square != null ? `square ${square}` : undefined}
              onClick={() => square != null && props.onClick(square)}
            />
          );
        }}</For>

        <div class="board-grain" aria-hidden="true" />

        <div classList={{ pieces: true, focusing: props.selected() != null }} aria-hidden="true">
          {/* ghost previews of where the selected piece can land */}
          <For each={[...props.targets()]}>{(sq) => {
            const [r, c] = rcOf(sq);
            return (
              <div class="ghost-anchor" style={{ transform: `translate(${c * 100}%, ${r * 100}%)` }}>
                <div classList={{
                  disc: true, ghost: true,
                  black: ghostCode() === 1 || ghostCode() === 2,
                  white: ghostCode() === 3 || ghostCode() === 4,
                }} />
              </div>
            );
          }}</For>

          {/* real pieces (FLIP layer) */}
          <For each={props.pieces}>{(p) => {
            const pos = () => rcOf(p.square);
            return (
              <div class="piece-anchor" style={{ transform: `translate(${pos()[1] * 100}%, ${pos()[0] * 100}%)` }}>
                <div
                  ref={(el) => props.registerDisc(p.id, el)}
                  classList={{
                    disc: true,
                    black: p.code === 1 || p.code === 2,
                    white: p.code === 3 || p.code === 4,
                    king: p.code === 2 || p.code === 4,
                    lifted: props.selected() === p.square,
                  }}
                >
                  <Show when={p.code === 2 || p.code === 4}><span class="crown">♛</span></Show>
                </div>
              </div>
            );
          }}</For>
        </div>
      </div>
    </div>
  );
}
