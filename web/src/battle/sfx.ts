/**
 * 効果音（SE）マネージャ。素材は Ludo で生成した mp3（web/public/se/）。
 *
 * HTMLAudio ではなく WebAudio を使う。スマホ（特にiOS）の HTMLAudio は
 * 「ユーザー操作の外」での play() がブロックされるため、相手ターンの
 * ダメージ音やドロー音が鳴らない。WebAudio は最初のタップで AudioContext を
 * 起こしておけば、以降はいつでもプログラムから鳴らせる。
 */

let enabled = true;
let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const lastPlayed = new Map<string, number>();

const MIN_INTERVAL_MS = 90; // 同じ音の最短再生間隔

function src(name: string): string {
  return `${import.meta.env.BASE_URL}se/${name}.mp3`;
}

function ensureContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    // 最初のユーザー操作でオーディオを解禁する（スマホの自動再生制限対策）
    const unlock = () => {
      void ctx?.resume();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
  }
  return ctx;
}

export function isSfxEnabled(): boolean {
  return enabled;
}

export function setSfxEnabled(v: boolean): void {
  enabled = v;
  if (v) void ensureContext()?.resume();
}

export function playSfx(name: string, volume = 0.5): void {
  if (!enabled) return;
  const c = ensureContext();
  const buf = buffers.get(name);
  if (!c || !buf || c.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, now);
  try {
    const source = c.createBufferSource();
    source.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(c.destination);
    source.start();
  } catch {
    /* 音は本体機能ではないので失敗しても何もしない */
  }
}

/** バトル開始時にまとめて読み込み・デコードしておく */
export function preloadSfx(names: string[]): void {
  const c = ensureContext();
  if (!c) return;
  for (const name of names) {
    if (buffers.has(name)) continue;
    fetch(src(name))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => c.decodeAudioData(ab))
      .then((buf) => buffers.set(name, buf))
      .catch(() => {});
  }
}

export const ALL_SFX = [
  'se_card', 'se_draw', 'se_play', 'se_attack', 'se_damage', 'se_guard', 'se_heal',
  'se_ko', 'se_ability', 'se_actor', 'se_turn', 'se_lock', 'se_equip', 'se_break',
];
