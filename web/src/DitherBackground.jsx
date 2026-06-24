import { onMount, onCleanup } from 'solid-js';

// Cartoon sky rendered with 8x8 Bayer ordered dithering: gradient sky, a soft
// sun, two layers of drifting FBM clouds — quantized into colour bands.
const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const FRAG = `precision highp float;
uniform float u_time; uniform vec2 u_res; uniform sampler2D u_bayer;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;

  vec3 skyTop = vec3(0.09, 0.26, 0.66);
  vec3 skyBot = vec3(0.45, 0.74, 0.95);
  vec3 col = mix(skyBot, skyTop, uv.y);

  vec2 sun = vec2(0.80 * aspect, 0.16);
  col += vec3(0.95, 0.80, 0.50) * smoothstep(0.34, 0.0, distance(p, sun)) * 0.40;

  float cloudFade = smoothstep(1.0, 0.55, uv.y);
  vec3 cloudCol = vec3(0.86, 0.91, 0.98);
  float c1 = fbm(p * 2.2 + vec2(t * 0.025, 0.0));
  col = mix(col, cloudCol, smoothstep(0.50, 0.78, c1) * cloudFade * 0.8);
  float c2 = fbm(p * 4.5 + vec2(t * 0.06, 3.1));
  col = mix(col, cloudCol, smoothstep(0.58, 0.82, c2) * cloudFade * 0.45);

  col *= mix(1.0, 0.80, smoothstep(0.62, 1.0, uv.y));
  col *= mix(0.80, 1.0, smoothstep(1.15, 0.3, length(uv - vec2(0.5, 0.5))));
  col = clamp(col * 0.85, 0.0, 0.82);

  float th = texture2D(u_bayer, gl_FragCoord.xy / 8.0).r;
  col = floor(col * 6.0 + th) / 6.0;
  gl_FragColor = vec4(col, 1.0);
}`;

function bayer8() {
  let m = [[0]], size = 1;
  while (size < 8) {
    const ns = size * 2, nm = Array.from({ length: ns }, () => new Array(ns));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = m[y][x] * 4;
      nm[y][x] = v; nm[y][x + size] = v + 2; nm[y + size][x] = v + 3; nm[y + size][x + size] = v + 1;
    }
    m = nm; size = ns;
  }
  const data = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data[y * 8 + x] = Math.floor((m[y][x] + 0.5) / 64 * 255);
  return data;
}

const mkShader = (gl, type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };

export default function DitherBackground() {
  let canvas;
  onMount(() => {
    const gl = canvas.getContext('webgl', { antialias: false, depth: false });
    if (!gl) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, mkShader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bayer8());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    gl.uniform1i(gl.getUniformLocation(prog, 'u_bayer'), 0);

    const SCALE = 3;
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf, start = performance.now();
    const frame = (now) => {
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    onCleanup(() => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); });
  });

  return <canvas class="dither-bg" ref={canvas} aria-hidden="true" />;
}
