/**
 * WebGLフラグメントシェーダーによる発光エフェクト層。
 * 画面全体に1枚のキャンバスを重ね（mix-blend-mode: screen）、
 * 加算発光だけを描く。黒=透明なのでアルファ合成の問題が起きない。
 * エフェクトが無い間は描画ループを止めて省電力にする。
 */
import { useEffect, useRef } from 'react';

export type ShaderFxType = 'impact' | 'heal' | 'ko' | 'sweep' | 'charge' | 'lock' | 'finale';

const TYPE_ID: Record<ShaderFxType, number> = {
  impact: 0, heal: 1, ko: 2, sweep: 3, charge: 4, lock: 5, finale: 6,
};

/** 各エフェクトの寿命（秒） */
const LIFE: Record<ShaderFxType, number> = {
  impact: 0.6, heal: 1.15, ko: 0.95, sweep: 0.95, charge: 0.65, lock: 1.05, finale: 2.3,
};

const DEFAULT_COLOR: Record<ShaderFxType, [number, number, number]> = {
  impact: [1.0, 0.55, 0.25],
  heal: [0.35, 1.0, 0.55],
  ko: [0.75, 0.35, 1.0],
  sweep: [1.0, 0.85, 0.35],
  charge: [1.0, 0.85, 0.3],
  lock: [0.7, 0.4, 1.0],
  finale: [1.0, 0.85, 0.4],
};

/** スキル属性 → 光の色 */
export const ATTR_RGB: Record<string, [number, number, number]> = {
  炎: [1.0, 0.45, 0.15],
  氷: [0.4, 0.85, 1.0],
  雷: [1.0, 0.95, 0.3],
  水: [0.3, 0.6, 1.0],
  風: [0.5, 1.0, 0.7],
  土: [0.85, 0.65, 0.35],
  光: [1.0, 0.95, 0.7],
  聖: [1.0, 0.9, 0.55],
  闇: [0.7, 0.3, 1.0],
  魔: [0.85, 0.4, 1.0],
  斬: [0.75, 0.85, 1.0],
  打: [1.0, 0.7, 0.4],
  突: [0.9, 0.9, 1.0],
  射: [0.6, 1.0, 0.9],
  獣: [1.0, 0.6, 0.3],
  飛: [0.65, 0.95, 1.0],
  毒: [0.6, 1.0, 0.35],
  守: [0.5, 0.8, 1.0],
};

interface Fx {
  type: number;
  life: number;
  x: number;
  y: number;
  start: number;
  color: [number, number, number];
}

const MAX_FX = 12;
let fxList: Fx[] = [];
let wake: (() => void) | null = null;

/** エフェクトを発生させる。x/y はCSSピクセル（画面座標） */
export function spawnShaderFx(type: ShaderFxType, x: number, y: number, color?: [number, number, number]): void {
  fxList.push({
    type: TYPE_ID[type],
    life: LIFE[type],
    x,
    y,
    start: performance.now(),
    color: color ?? DEFAULT_COLOR[type],
  });
  if (fxList.length > MAX_FX) fxList.splice(0, fxList.length - MAX_FX);
  wake?.();
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform int uCount;
uniform float uType[${MAX_FX}];
uniform float uT[${MAX_FX}];
uniform vec2 uPos[${MAX_FX}];
uniform vec3 uCol[${MAX_FX}];

float ring(vec2 p, vec2 c, float r, float w) {
  return smoothstep(w, 0.0, abs(length(p - c) - r));
}

void main() {
  // DOM座標系（左上原点）に合わせてYを反転
  vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${MAX_FX}; i++) {
    if (i >= uCount) break;
    float t = uT[i];          // 0..1 に正規化した寿命
    vec2 c = uPos[i];
    vec3 hue = uCol[i];
    float ty = uType[i];
    vec2 d = uv - c;
    float rad = length(d);
    if (ty < 0.5) {
      // impact: 衝撃波リング + 放射スパイク + 中心フラッシュ
      float fade = 1.0 - t;
      float r = mix(6.0, 92.0, pow(t, 0.55));
      col += hue * ring(uv, c, r, 13.0) * fade * 1.6;
      float ang = atan(d.y, d.x);
      float spikes = pow(abs(sin(ang * 5.0 + 1.7)), 16.0);
      col += hue * smoothstep(95.0 * t + 30.0, 0.0, rad) * spikes * fade * 0.9;
      col += (hue * 0.6 + 0.4) * smoothstep(26.0, 0.0, rad) * pow(fade, 2.0) * 1.3;
    } else if (ty < 1.5) {
      // heal: ふわっと上昇する柔らかい光 + 広がる輪
      vec2 cc = c - vec2(0.0, 34.0 * t);
      col += hue * smoothstep(58.0, 0.0, length(uv - cc)) * (1.0 - t) * 0.75;
      col += hue * ring(uv, c, mix(10.0, 58.0, t), 9.0) * (1.0 - t) * 0.6;
    } else if (ty < 2.5) {
      // ko: 一度収縮してから破裂する
      float r = t < 0.4 ? mix(70.0, 8.0, t / 0.4) : mix(8.0, 115.0, (t - 0.4) / 0.6);
      col += hue * ring(uv, c, r, 15.0) * (1.0 - t) * 1.4;
      col += hue * smoothstep(30.0, 0.0, rad) * (1.0 - t) * 0.5;
    } else if (ty < 3.5) {
      // sweep: 横に走る光の帯
      float x = mix(-140.0, uRes.x + 140.0, t);
      float band = smoothstep(100.0, 0.0, abs(uv.x - x)) * smoothstep(150.0, 20.0, abs(uv.y - c.y));
      col += hue * band * (1.0 - t * 0.5) * 0.85;
    } else if (ty < 4.5) {
      // charge: 収束していく光
      col += hue * ring(uv, c, mix(52.0, 4.0, t), 8.0) * t * 1.2;
      col += hue * smoothstep(15.0, 0.0, rad) * pow(t, 3.0) * 1.6;
    } else if (ty < 5.5) {
      // lock: 二重リングのパルス
      col += hue * ring(uv, c, mix(20.0, 62.0, t), 6.0) * (1.0 - t);
      col += hue * ring(uv, c, mix(6.0, 46.0, t), 4.0) * (1.0 - t) * 0.8;
    } else {
      // finale: 画面全体へ広がるきらめき波
      float r = mix(0.0, length(uRes) * 0.95, pow(t, 0.6));
      col += hue * ring(uv, c, r, 100.0) * (1.0 - t) * 0.55;
      col += hue * smoothstep(uRes.y * 0.55, 0.0, rad) * (1.0 - t) * 0.12;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('shader compile error:', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function ShaderFxCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return; // WebGL不可の環境では静かに諦める（DOM演出は生きている）

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const loc = {
      res: gl.getUniformLocation(prog, 'uRes'),
      count: gl.getUniformLocation(prog, 'uCount'),
      type: gl.getUniformLocation(prog, 'uType'),
      t: gl.getUniformLocation(prog, 'uT'),
      pos: gl.getUniformLocation(prog, 'uPos'),
      col: gl.getUniformLocation(prog, 'uCol'),
    };

    const typeArr = new Float32Array(MAX_FX);
    const tArr = new Float32Array(MAX_FX);
    const posArr = new Float32Array(MAX_FX * 2);
    const colArr = new Float32Array(MAX_FX * 3);

    let raf = 0;
    let running = false;

    const resize = () => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const now = performance.now();
      fxList = fxList.filter((f) => now - f.start < f.life * 1000);
      resize();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const n = Math.min(fxList.length, MAX_FX);
      for (let i = 0; i < n; i++) {
        const f = fxList[i];
        typeArr[i] = f.type;
        tArr[i] = Math.min(1, (now - f.start) / (f.life * 1000));
        posArr[i * 2] = f.x;
        posArr[i * 2 + 1] = f.y;
        colArr[i * 3] = f.color[0];
        colArr[i * 3 + 1] = f.color[1];
        colArr[i * 3 + 2] = f.color[2];
      }
      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.uniform1i(loc.count, n);
      gl.uniform1fv(loc.type, typeArr);
      gl.uniform1fv(loc.t, tArr);
      gl.uniform2fv(loc.pos, posArr);
      gl.uniform3fv(loc.col, colArr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (fxList.length > 0) {
        raf = requestAnimationFrame(render);
      } else {
        running = false; // 空になったらループを止める（次のspawnで再開）
      }
    };

    wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };
    // マウント時に残っていたら描き切る
    if (fxList.length > 0) wake();

    return () => {
      wake = null;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="shader-fx" />;
}
