/**
 * カード効果システムの型定義。
 *
 * 設計方針（社長指示: カードが増えてもメモリに影響せず、安全に動くこと）:
 * - 効果は「カードID → 効果定義」の静的レジストリ。モジュール読み込み時に1回だけ作られ、
 *   バトル状態には効果オブジェクトを一切持たない（何万回バトルしてもメモリは増えない）。
 * - 効果は BattleState を直接さわれない。検証付きの EffectApi 経由でのみ操作する。
 * - 効果の実行はスナップショット保護付き（エラー時は巻き戻してバトル続行）。
 */
import type { Attribute } from '../types';

/** 効果がバトルを操作するための唯一の窓口（battle.ts が実装する） */
export interface EffectApi {
  // ---- 情報の読み取り ----
  /** 今のターン数 */
  turn(): number;
  /** 自分のAP枚数 */
  myApCount(): number;
  /** 自分のトラッシュ枚数 */
  myTrashCount(): number;
  /** 効果の持ち主キャラの属性の個数（追加属性・味方付与込み） */
  myAttrCount(attr: Attribute): number;
  /** 攻撃対象（最初の対象）の属性の個数 */
  targetAttrCount(attr: Attribute): number;
  /** 攻撃対象の残りHP */
  targetHp(): number;
  /** 攻撃対象の最大HP */
  targetMaxHp(): number;
  /** 効果の持ち主キャラの受けているダメージ */
  myDamage(): number;
  /** 自分の戦闘不能キャラの数 */
  myKoCount(): number;
  /** このターン自分が使ったスキルの数（このスキルを含む） */
  skillsUsedThisTurn(): number;

  // ---- 攻撃の修正（攻撃宣言のタイミングだけ有効） ----
  addDamage(n: number): void;
  /** ダメージを直接この値にする（ディメンションエッジ等） */
  setDamage(n: number): void;

  // ---- ガードの修正（ガード割り込みのタイミングだけ有効） ----
  addGuardValue(n: number): void;

  // ---- 操作（すべて検証付き・範囲外は安全に丸める） ----
  chargeFromDeck(who: 'me' | 'enemy', n: number): void;
  chargeAllHand(): void;
  chargeFromTrashBottom(n: number): void;
  drawCards(who: 'me' | 'enemy', n: number): void;
  discardHandAll(): void;
  millDeck(who: 'me' | 'enemy', n: number): void;
  discardEnemyAp(n: number): void;
  /** 効果ダメージ（ガード割り込み不可）。敵アクターへ */
  damageEnemyActor(n: number): void;
  /** 効果ダメージ。敵全員へ */
  damageAllEnemies(n: number): void;
  /** 攻撃対象に追加の効果ダメージ */
  damageTarget(n: number): void;
  /** 効果の持ち主キャラを回復 */
  healSelf(n: number): void;
  healMyActor(n: number): void;
  healAllAllies(n: number): void;
  /** 戦闘不能の味方1枚を復活させ、HPをnにする（最もHPの高いカードを選ぶ） */
  reviveAlly(hp: number): void;
  /** 効果の持ち主キャラに属性を追加（バトル中ずっと） */
  addAttributeToSelf(attr: Attribute, n?: number): void;
  addAttributeToAllAllies(attr: Attribute): void;
  /** トラッシュの下からn枚をデッキに戻してシャッフル */
  returnTrashBottomToDeck(n: number): void;
  /** 敵アクターを（敵の次のターン終了時まで）ロック */
  lockEnemyActor(): void;
  /** 自分のアクターを（次の自分ターン開始時まで）ロック */
  lockMyActor(): void;
  unlockMyActor(): void;
  forceChangeEnemyActor(): void;
  /** 自分のアクターを変更（skip=1で1枚飛ばし） */
  changeMyActor(skip?: number): void;
  /** 効果の持ち主キャラをアクターにする */
  becomeActor(): void;
  /** 次に使うスキルのコストを変更 */
  reduceNextSkillCost(n: number): void;
  /** 敵の次のドローフェーズの枚数を減らす */
  reduceEnemyNextDraw(n: number): void;
  /** 次の自分ターン開始時まで、味方が受けるダメージを-n */
  reduceIncomingDamage(n: number): void;
  /** デッキから条件に合うカードを1枚手札に加える（見つかればシャッフル） */
  searchDeckToHand(filter: (cardId: string) => boolean): boolean;
  /** 自分のAPを全てトラッシュし、その枚数を返す（無双乱撃） */
  consumeAllMyAp(): number;
  /** 効果の持ち主キャラが装備を持っているか（ロッソ） */
  selfHasEquipment(): boolean;
  /** 攻撃対象の装備をトラッシュする（ポイントブレイク） */
  destroyTargetEquipment(): void;
  /** 手札のスキルのうち、属性条件を満たせる枚数を数える（AP無視。アニマの判断用） */
  handUsableSkillCount(by: 'self' | 'actor'): number;
  /** 効果の持ち主キャラ自身へのダメージ（邪神の呪い） */
  damageSelf(n: number): void;
  /** 「デッキから使用」: 条件に合うスキルを1枚探し、コストなしで本当に使用する
   * （効果・スケーリング込み。奇襲扱いでguard割り込みは不可） */
  castFromDeck(opts: { maxCost: number; attr: import('../types').Attribute }): void;
  /** ログを出す */
  log(message: string): void;
}

/** スキルカードの効果 */
export interface SkillEffect {
  kind: 'skill';
  /** 攻撃対象: 省略=敵アクター / all=敵全体 / choose=選択 / standby=敵の控え全て */
  targeting?: 'all' | 'choose' | 'standby';
  /** この攻撃にはguardで割り込めない */
  noGuard?: boolean;
  /** 条件属性を（アクターでなく）生きている味方の誰かが満たせばよい。使用キャラはその味方になる */
  anyCharacterCanUse?: boolean;
  /** コストの修正（神速剣など）。効果APIで現在の状況を見て差分を返す */
  costDelta?(api: EffectApi): number;
  /** 攻撃の宣言時（ダメージ修正はここで） */
  onAttackDeclare?(api: EffectApi): void;
  /** 攻撃の解決後。dealt = 実際に与えた合計ダメージ、damagedCount = ダメージを与えたキャラの数 */
  onAttackResolved?(api: EffectApi, dealt: number, damagedCount?: number): void;
  /** プレイ時の追加処理（支援・回復・攻撃の付随効果） */
  onPlay?(api: EffectApi): void;
  /** guardとして割り込んだ時（軽減値の修正や追加処理） */
  onGuardDeclare?(api: EffectApi): void;
}

/** キャラクターの常時能力 */
export interface CharacterEffect {
  kind: 'character';
  /** ドローフェーズの手札上限を増やす（アイ） */
  handRefillBonus?: number;
  /** このキャラが使うスキルのコスト修正（トランザード） */
  skillCostDelta?: number;
  /** 生存中、味方全体に属性を付与（セレーナ） */
  grantAllyAttribute?: Attribute;
  /** 控えにいる間ダメージを受けない（ビコウ） */
  standbyImmune?: boolean;
  /** 最大HPの修正（ドッソ）。apiで状況を見て差分を返す */
  maxHpBonus?(api: EffectApi): number;
  onBattleStart?(api: EffectApi): void;
  /** 自分のターンの最初に（ドロー後。このキャラが生きていれば） */
  onOwnTurnStart?(api: EffectApi, isActor: boolean): void;
  /** 自分のターンの終わりに（このキャラが生きていれば） */
  onOwnTurnEnd?(api: EffectApi, isActor: boolean): void;
  /** このキャラが攻撃する時のダメージ修正 */
  onAttackDeclare?(api: EffectApi): void;
  /** このキャラがダメージを受けた時 */
  onDamaged?(api: EffectApi, amount: number, isActor: boolean): void;
  /** 味方（自分含む）が戦闘不能になった時 */
  onAllyKo?(api: EffectApi): void;
  /** このキャラが回復した時 */
  onHealed?(api: EffectApi, amount: number): void;
}

/** 装備カードの効果（属性追加はカードデータの addAttribute から自動で効く） */
export interface EquipmentEffect {
  kind: 'equipment';
  /** 付けたキャラの最大HP修正 */
  maxHpDelta?: number;
  /** 付けたキャラが使うスキルのコスト修正 */
  skillCostDelta?: number;
  /** 自分のターンの終わりに（付けたキャラが生きていれば） */
  onOwnTurnEnd?(api: EffectApi): void;
}

/** フィールドカードの効果（場に1枚、両プレイヤーに効く） */
export interface FieldEffect {
  kind: 'field';
  /** 全てのキャラクターが使うスキルのコスト修正 */
  skillCostDeltaAll?: number;
  /** 全てのキャラクターに属性を追加 */
  grantAttrAll?: import('../types').Attribute;
  /** 全てのプレイヤーのドローフェーズの枚数を増やす */
  drawBonusAll?: number;
  /** キャラクター3枚生存中のプレイヤーは、アクター変更時に1枚飛ばす（大乱戦） */
  rotationSkipWhenFullAlive?: boolean;
}

export type CardEffect = SkillEffect | CharacterEffect | EquipmentEffect | FieldEffect;
