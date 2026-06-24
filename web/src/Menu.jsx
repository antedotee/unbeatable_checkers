import { For } from 'solid-js';

const LEVELS = [
  { id: 'Easy', blurb: 'depth 6 · still sharp' },
  { id: 'Medium', blurb: 'depth 10 · beyond most' },
  { id: 'Hard', blurb: 'depth 14 · merciless' },
];
const THEMES = ['latte', 'walnut', 'slate', 'forest'];

// Pre-game setup. Pure selection UI; App owns the signals.
export default function Menu(props) {
  return (
    <div class="screen">
      <div class="panel menu-panel">
      <h2 class="panel-title">[ NEW GAME ]</h2>

      <div class="menu-group">
        <span class="menu-label">[ DIFFICULTY ]</span>
        <div class="opt-col">
          <For each={LEVELS}>{(l) => (
            <button class="opt-row" classList={{ on: props.level() === l.id }}
              aria-pressed={props.level() === l.id} onClick={() => props.onLevel(l.id)}>
              <span class="opt-name">{l.id}</span>
              <span class="opt-blurb">{l.blurb}</span>
            </button>
          )}</For>
        </div>
      </div>

      <div class="menu-group">
        <span class="menu-label">[ YOUR UNIT ]</span>
        <div class="opt-pair">
          <button class="opt-color" classList={{ on: props.color() === 0 }}
            aria-pressed={props.color() === 0} onClick={() => props.onColor(0)}>
            <span class="disc-mini black" /> DARK
          </button>
          <button class="opt-color" classList={{ on: props.color() === 1 }}
            aria-pressed={props.color() === 1} onClick={() => props.onColor(1)}>
            <span class="disc-mini white" /> LIGHT
          </button>
        </div>
      </div>

      <div class="menu-group">
        <span class="menu-label">[ SUBSTRATE ]</span>
        <div class="opt-pair">
          <For each={THEMES}>{(t) => (
            <button class="opt-swatch" classList={{ on: props.theme() === t }} data-theme={t}
              aria-label={`${t} board`} aria-pressed={props.theme() === t} onClick={() => props.onTheme(t)}>
              <span class="swatch-chip" />
              <span class="opt-swatch-name">{t}</span>
            </button>
          )}</For>
        </div>
      </div>

      <button class="play-btn" onClick={props.onPlay}>▶ ENGAGE</button>
      </div>
    </div>
  );
}
