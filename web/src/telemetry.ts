/**
 * 匿名テレメトリ（公開βのログ収集）。
 *
 * - 送信先は Google Apps Script のWebアプリ（無料・スプレッドシートに追記）。
 *   デプロイ手順は docs/TELEMETRY_SETUP.md。URLを下の ENDPOINT に貼るだけで有効になる。
 * - 同一人物の識別のため、匿名ID（ランダムUUID）だけを localStorage に保存する。
 *   個人情報・ゲームデータは一切保存しない。
 * - 送信は fire-and-forget。失敗してもゲームには一切影響しない。
 */

// ここに Google Apps Script のWebアプリURLを貼ると送信が有効になる
const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbymeqyPV4ligt_D0kdFkDidVHOe4TGN_gC0xmRuf9LFZwR5zbpNPwIu39TCj6gzrzXXtw/exec';

const UID_KEY = 'bd-anon-id';

/** 匿名ユーザーID（初回に生成してlocalStorageに保存） */
export function getUid(): string {
  try {
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return 'no-storage';
  }
}

export function logEvent(type: string, payload: Record<string, unknown>): void {
  if (!ENDPOINT) return;
  try {
    const body = JSON.stringify({ v: 1, uid: getUid(), type, at: new Date().toISOString(), ...payload });
    // sendBeacon はページ遷移中でも送れる。使えない環境は keepalive fetch
    const ok = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    if (!ok) {
      void fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, body });
    }
  } catch {
    /* ログはベストエフォート */
  }
}
