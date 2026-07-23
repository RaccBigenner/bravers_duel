/**
 * 効果音（SE）マネージャ。
 * 素材は Ludo で生成した mp3（web/public/se/）。
 * - 同じ音の連続再生に耐えるよう cloneNode で多重再生する
 * - 短時間に同じ音が重なりすぎないよう、音ごとに最小間隔を設ける
 * - ミュートはバトルをまたいで記憶（リロードで戻る）
 */

let enabled = true;
const lastPlayed = new Map<string, number>();
const cache = new Map<string, HTMLAudioElement>();

const MIN_INTERVAL_MS = 90; // 同じ音の最短再生間隔

function src(name: string): string {
  return `${import.meta.env.BASE_URL}se/${name}.mp3`;
}

export function isSfxEnabled(): boolean {
  return enabled;
}

export function setSfxEnabled(v: boolean): void {
  enabled = v;
}

export function playSfx(name: string, volume = 0.5): void {
  if (!enabled) return;
  const now = performance.now();
  const last = lastPlayed.get(name) ?? -Infinity;
  if (now - last < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, now);
  try {
    let base = cache.get(name);
    if (!base) {
      base = new Audio(src(name));
      base.preload = 'auto';
      cache.set(name, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = volume;
    // 自動再生ブロックなどの失敗は静かに無視する
    void node.play().catch(() => {});
  } catch {
    /* 音は本体機能ではないので失敗しても何もしない */
  }
}

/** バトル開始時にまとめて読み込んでおく */
export function preloadSfx(names: string[]): void {
  for (const name of names) {
    if (cache.has(name)) continue;
    const a = new Audio(src(name));
    a.preload = 'auto';
    cache.set(name, a);
  }
}

export const ALL_SFX = [
  'se_card', 'se_draw', 'se_play', 'se_attack', 'se_damage', 'se_guard', 'se_heal',
  'se_ko', 'se_ability', 'se_actor', 'se_turn', 'se_coin', 'se_end', 'se_lock', 'se_equip',
];
