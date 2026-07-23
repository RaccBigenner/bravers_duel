/**
 * バトルの「型付きイベントストリーム」。
 *
 * これまで UI はエンジンの日本語ログを正規表現でパースして演出していたが、
 * 文言変更のたびに壊れ、側（P1/P2）やキャラ位置の取り違いバグの温床だった。
 * エンジンは状態変化のたびに BattleEvent を emit し、UI はこれだけを読む。
 * `state.log` は人間用の読み物（デバッグ・観戦ログ）としてのみ残る。
 *
 * 新しい演出を足す時は、ここに型を1つ足し、エンジンで emit し、
 * web 側の narrator に表示方法を書く。文字列の取り決めは一切不要。
 */
import type { PlayerIndex } from './battle';

export type BattleEvent =
  // 進行
  | { t: 'battleStart'; first: PlayerIndex }
  | { t: 'bonusCharge'; player: PlayerIndex; n: number } // 後攻補償
  | { t: 'turnStart'; turn: number; player: PlayerIndex }
  | { t: 'battleEnd'; winner: PlayerIndex | null; reason: string }
  | { t: 'deckout'; player: PlayerIndex }
  // カードの移動
  | { t: 'draw'; player: PlayerIndex; n: number }
  | { t: 'chargeHand'; player: PlayerIndex; cardId: string; ap: number }
  | { t: 'chargeDeck'; player: PlayerIndex; n: number; ap: number }
  | { t: 'chargeTrash'; player: PlayerIndex; n: number; ap: number }
  | { t: 'chargeAllHand'; player: PlayerIndex; n: number }
  | { t: 'handTrash'; player: PlayerIndex; n: number }
  | { t: 'mill'; player: PlayerIndex; n: number }
  | { t: 'apTrash'; player: PlayerIndex; n: number }
  | { t: 'searchToHand'; player: PlayerIndex; cardId: string }
  // カードの使用
  | { t: 'skillUsed'; player: PlayerIndex; charIndex: number; cardId: string }
  | { t: 'characterCardUsed'; player: PlayerIndex; cardId: string }
  | { t: 'castFromDeck'; player: PlayerIndex; charIndex: number; cardId: string }
  | { t: 'attackDeclared'; player: PlayerIndex; cardId: string; value: number; noGuard: boolean }
  | { t: 'guardPlayed'; player: PlayerIndex; charIndex: number; cardId: string; before: number; after: number }
  | { t: 'equip'; player: PlayerIndex; charIndex: number; cardId: string; removedCardId?: string }
  | { t: 'equipDestroyed'; player: PlayerIndex; charIndex: number; cardId: string }
  | { t: 'fieldSet'; player: PlayerIndex; cardId: string; replacedCardId?: string }
  // 戦闘の変化
  | { t: 'powerUp'; player: PlayerIndex; charIndex: number; n: number; total: number }
  | { t: 'guardBoost'; player: PlayerIndex; n: number; remain: number }
  | { t: 'damage'; player: PlayerIndex; charIndex: number; n: number; hpLeft: number }
  | { t: 'standbyImmune'; player: PlayerIndex; charIndex: number }
  | { t: 'heal'; player: PlayerIndex; charIndex: number; n: number }
  | { t: 'ko'; player: PlayerIndex; charIndex: number }
  | { t: 'revive'; player: PlayerIndex; charIndex: number; hp: number }
  // アクター
  | { t: 'actorChanged'; player: PlayerIndex; charIndex: number; forced: boolean }
  | { t: 'actorLocked'; player: PlayerIndex; untilTurn: number }
  | { t: 'actorUnlocked'; player: PlayerIndex }
  | { t: 'lockBlocked'; player: PlayerIndex }
  // その他
  | { t: 'attributeAdded'; player: PlayerIndex; charIndex: number; attr: string }
  | { t: 'abilityTriggered'; label: string; player?: PlayerIndex; charIndex?: number }
  | { t: 'info'; text: string };
