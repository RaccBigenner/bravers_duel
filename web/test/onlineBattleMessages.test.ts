import type { MatchViewerEvent } from '@bravers/protocol';
import { describe, expect, it } from 'vitest';
import {
  ONLINE_BATTLE_MESSAGE_KEYS,
  actionLabel,
  eventLabel,
  onlineBattleMessages,
  phaseLabel,
  terminalMessage,
  unknownCardName,
} from '../src/online/onlineBattleMessages';

describe('online battle message catalog', () => {
  it('ja-JPとenで同じkeyを持ち、空の翻訳を許さない', () => {
    const japanese = onlineBattleMessages('ja-JP');
    const english = onlineBattleMessages('en');
    const japaneseKeys = Object.keys(japanese).sort();
    const englishKeys = Object.keys(english).sort();

    expect(englishKeys).toEqual(japaneseKeys);
    expect([...ONLINE_BATTLE_MESSAGE_KEYS].sort()).toEqual(japaneseKeys);
    for (const key of ONLINE_BATTLE_MESSAGE_KEYS) {
      expect(japanese[key].trim()).not.toBe('');
      expect(english[key].trim()).not.toBe('');
    }
  });

  it('既定の日本語phase/action/result表記を保持する', () => {
    expect(phaseLabel('ja-JP', 'choice')).toBe('先攻・後攻選択');
    expect(actionLabel('ja-JP', { type: 'endPlay' }, new Map())).toEqual({
      title: 'プレイを終える',
    });
    expect(terminalMessage('ja-JP', { state: 'finished', winner: 0, reason: 'wipeout' }, 0))
      .toEqual({ title: '勝利', detail: 'キャラクター全滅' });
    expect(unknownCardName('ja-JP', 'unknown-1')).toBe('未登録カード（unknown-1）');
    expect(onlineBattleMessages('ja-JP').connectionSynced).toBe('同期済み');
    expect(onlineBattleMessages('en').commandSendFailed).toBe(
      'Could not send the action. Check your connection.',
    );
  });

  it('protocol eventをlocale別の表示文へ変換する', () => {
    const event: MatchViewerEvent = { type: 'battleStarted', firstPlayer: 0 };
    const resolveCard = (printingId: string) => printingId;

    expect(eventLabel('ja-JP', event, 0, resolveCard)).toBe('あなたの先攻でバトル開始');
    expect(eventLabel('en', event, 0, resolveCard)).toBe('Battle started with You going first');
    expect(phaseLabel('en', 'guard')).toBe('Guard');
    expect(terminalMessage('en', { state: 'finished', winner: 1, reason: 'deckout' }, 0))
      .toEqual({ title: 'Defeat', detail: 'Deck out' });
  });
});
