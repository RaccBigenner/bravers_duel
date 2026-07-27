/**
 * 画面内ログ。
 *
 * スマホで起きる不具合は開発者ツールが使えず原因が追えないので、
 * 処理の途中経過をここに溜めて画面から読めるようにする。
 * localStorage に残すので、失敗したあとに画面を閉じても後から確認できる。
 */

const KEY = 'bd-admin-log';
const MAX_LINES = 300;

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

let lines: string[] = load();

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // 容量超過などは記録できなくても本処理を止めない
  }
}

/** 1行記録する。時刻は端末の時計 */
export function logLine(message: string): void {
  const time = new Date().toTimeString().slice(0, 8);
  lines = [...lines, `${time} ${message}`].slice(-MAX_LINES);
  persist();
  listeners.forEach((l) => l());
  console.log('[bd-admin]', message); // PCで見る時用
}

export function getLog(): string[] {
  return lines;
}

export function clearLog(): void {
  lines = [];
  persist();
  listeners.forEach((l) => l());
}

export function subscribeLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 起動したプログラムの版を記録する。
 * 「直したはずなのに直っていない」時、**古いプログラムが端末に残っているだけ**なのか
 * 本当に直っていないのかを、ログだけで区別できるようにするため。
 */
export function logAppVersion(): void {
  const src = document.querySelector<HTMLScriptElement>('script[type=module][src]')?.src ?? '不明';
  logLine(`起動: ${src.split('/').pop()}`);
}

/** 想定外のエラーも取りこぼさないように、画面全体の例外も拾う */
export function installGlobalErrorLog(): void {
  window.addEventListener('error', (e) => {
    logLine(`【画面エラー】${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    logLine(`【未処理の失敗】${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
  });
}
