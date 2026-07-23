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
    // ユーザー操作でオーディオを解禁する（スマホの自動再生制限対策）。
    // 重要: iOSでは pointerdown がユーザー操作として認められないことがあるため、
    // 複数のイベントに張り、resume が実際に成功する（running になる）まで外さない。
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const unlock = () => {
      const c = ctx;
      if (!c) return;
      void c
        .resume()
        .then(() => {
          if (c.state === 'running') {
            for (const evName of events) window.removeEventListener(evName, unlock, true);
          }
        })
        .catch(() => {});
    };
    for (const evName of events) window.addEventListener(evName, unlock, true);
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

// WebAudio が解禁されるまでのフォールバック用（HTMLAudio）
const htmlCache = new Map<string, HTMLAudioElement>();

function playViaHtmlAudio(name: string, volume: number): void {
  try {
    let base = htmlCache.get(name);
    if (!base) {
      base = new Audio(src(name));
      base.preload = 'auto';
      htmlCache.set(name, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = volume;
    void node.play().catch(() => {});
  } catch {
    /* 音は本体機能ではないので失敗しても何もしない */
  }
}

export function playSfx(name: string, volume = 0.5): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, now);

  const c = ensureContext();
  const buf = buffers.get(name);
  if (c && buf && c.state === 'running') {
    // 最良経路: WebAudio（ユーザー操作の外でも確実に鳴る）
    try {
      const source = c.createBufferSource();
      source.buffer = buf;
      const gain = c.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(c.destination);
      source.start();
      return;
    } catch {
      /* fall through */
    }
  }
  // WebAudioがまだ解禁されていない環境では HTMLAudio で鳴らしつつ、解禁を試みる
  if (c && c.state !== 'running') void c.resume();
  playViaHtmlAudio(name, volume);
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


/** デバッグ用: 内部状態を覗く（本番でも害なし） */
export function sfxDebug(): { ctxState: string | null; buffers: string[]; enabled: boolean } {
  return { ctxState: ctx?.state ?? null, buffers: [...buffers.keys()], enabled };
}
