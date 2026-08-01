export type OnlineLocale = 'ja-JP' | 'en';

const messages = {
  'ja-JP': {
    checking: '進行中の対戦を確認しています…',
    provisioning: '対戦を準備しています。少し待ってからもう一度確認します。',
    activeTitle: '進行中の対戦があります',
    activeBody: 'リロード前の続きから、安全に再開できます。',
    resume: '試合に戻る',
    openBattle: '試合画面を開く',
    connecting: '対戦へ接続しています…',
    syncing: '最新の盤面を同期しています…',
    retry: 'もう一度試す',
    offline: '通信を確認できません。通信回復後にもう一度お試しください。',
    temporary: '接続が混み合っています。少し待ってからもう一度お試しください。',
    sessionExpired: 'この対戦のセッション期限が切れました。ホームから始め直してください。',
    unavailable: '対戦を確認できませんでした。ホームへ戻ってもう一度お試しください。',
    protocol: 'ゲームの更新が必要です。安全のため接続を停止しました。',
    terminalLoading: '前回の対戦結果を確認しています…',
    terminalTitle: '前回の対戦結果',
    terminalPending: '結果を確定しています。少し待ってからもう一度確認してください。',
    terminalWin: '勝利',
    terminalLose: '敗北',
    terminalDraw: '引き分け',
    terminalCancelled: '対戦は取り消されました',
    dismiss: '閉じる',
  },
  en: {
    checking: 'Checking for an active match…',
    provisioning: 'Preparing the match. We will check again shortly.',
    activeTitle: 'A match is in progress',
    activeBody: 'Resume safely from where you left off.',
    resume: 'Return to match',
    openBattle: 'Open match',
    connecting: 'Connecting to the match…',
    syncing: 'Syncing the latest board…',
    retry: 'Try again',
    offline: 'You appear to be offline. Reconnect and try again.',
    temporary: 'The service is busy. Wait a moment and try again.',
    sessionExpired: 'This match session expired. Return home and start again.',
    unavailable: 'The match could not be verified. Return home and try again.',
    protocol: 'A game update is required. The connection was stopped for safety.',
    terminalLoading: 'Checking the previous match result…',
    terminalTitle: 'Previous match result',
    terminalPending: 'The result is being finalized. Check again shortly.',
    terminalWin: 'Victory',
    terminalLose: 'Defeat',
    terminalDraw: 'Draw',
    terminalCancelled: 'The match was cancelled',
    dismiss: 'Close',
  },
} as const;

export type RecoveryMessageKey = keyof (typeof messages)['ja-JP'];

export function resolveOnlineLocale(language?: string): OnlineLocale {
  return language?.toLowerCase().startsWith('ja') === false ? 'en' : 'ja-JP';
}

export function recoveryMessage(locale: OnlineLocale, key: RecoveryMessageKey): string {
  return messages[locale][key];
}
