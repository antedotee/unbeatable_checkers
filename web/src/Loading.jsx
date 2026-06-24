import { Show } from 'solid-js';

export default function Loading(props) {
  return (
    <div class="screen title-screen">
      <div class="title-stack">
        <h1 class="arcade-title">
          <span class="t-line">UNBEATABLE</span>
          <span class="t-line t-accent">CHECKERS</span>
        </h1>
        <p class="arcade-sub">[ TACTICAL CHECKERS ENGINE · 8×8 ]</p>
      </div>

      <dl class="tele">
        <dt>ENGINE</dt><span class="dots" /><dd class="on">{props.ready() ? 'ONLINE' : 'BOOT'}</dd>
        <dt>SEARCH</dt><span class="dots" /><dd>ALPHA-BETA</dd>
        <dt>OUTCOME</dt><span class="dots" /><dd>DRAW / WIN</dd>
        <dt>BUILD</dt><span class="dots" /><dd>REV 2.6 · D-01</dd>
      </dl>

      <Show
        when={props.ready()}
        fallback={
          <div class="load-block">
            <div class="load-bar"><span class="load-fill" /></div>
            <p class="load-text">INITIALIZING ENGINE…</p>
          </div>
        }
      >
        <button class="press-start" onClick={props.onStart}>&gt;&gt; PRESS START</button>
      </Show>

      <p class="credit">ALPHA-BETA · WEBASSEMBLY · UNIT D-01</p>
    </div>
  );
}
