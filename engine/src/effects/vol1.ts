/**
 * 第1弾カードの効果定義（全113枚 = キャラ16 + スキル85 + 装備8 + フィールド4）。
 * キーはゲーム上不変のoracleId。元printingの公開状態に依存せず再録へ継承する。
 * バトル状態への参照は持たない。
 *
 * 暫定・解釈で実装しているもの:
 * - 1-A006 アニマ: AI自動判断（自分の方が使える手札スキルが多ければアクターになる）
 * - 1-A054 炎霊召喚 / 1-A099 風を集める: デッキから本当に使用する（奇襲扱いでguard割り込み不可）
 * - 1-A106 オールグレイス: 味方全体を基本値ぶん回復と解釈
 * - 1-A083 神速剣: 「2ターン目以内」= 通しターン4以内と解釈
 */
import { cardByPrintingId } from '../cards';
import type { CardEffect } from './types';

export const VOL1_EFFECTS: Record<string, CardEffect> = {
  // ================================================== キャラクター
  '1-A001': { kind: 'character', handRefillBonus: 1 },
  '1-A002': {
    kind: 'character',
    onOwnTurnEnd: (api) => api.millDeck('me', 2),
  },
  // 2026-07-25 社長判断: 攻撃ダメージ+2を削除（アイとの組み合わせが強すぎたβの結果）
  '1-A003': {
    kind: 'character',
    onBattleStart: (api) => api.chargeFromDeck('me', 2),
  },
  '1-A004': { kind: 'character', skillCostDelta: 2 },
  '1-A006': {
    // アニマ「自分のターンの最初に、このキャラクターをアクターにできる」
    // 人間プレイヤー: turnStartAction をボタンから任意発動 / AI: onOwnTurnStart の自動判断
    kind: 'character',
    onOwnTurnStart: (api, isActor) => {
      if (isActor) return;
      if (api.handUsableSkillCount('self') > api.handUsableSkillCount('actor')) {
        api.becomeActor();
      }
    },
    turnStartAction: (api) => {
      api.becomeActor();
    },
  },
  '1-A007': {
    kind: 'character',
    onAllyKo: (api) => api.damageEnemyActor(3),
  },
  '1-A008': { kind: 'character', grantAllyAttribute: '氷' },
  '1-A009': {
    kind: 'character',
    onOwnTurnEnd: (api, isActor) => {
      // 交代できる控えがいない（生存が自分だけ）なら発動しない（2026-07-23 社長決定）
      if (isActor && api.myAliveCount() > 1) {
        api.damageAllEnemies(2);
        api.changeMyActor();
      }
    },
  },
  '1-A010': {
    kind: 'character',
    onHealed: (api) => api.returnTrashBottomToDeck(2),
  },
  '1-A013': {
    kind: 'character',
    onDamaged: (api, amount, isActor) => {
      if (isActor) api.chargeFromTrashBottom(amount);
    },
  },
  '1-A014': {
    kind: 'character',
    onOwnTurnEnd: (api) => api.addAttributeToSelf('闇', 1),
  },
  '1-A015': {
    kind: 'character',
    maxHpBonus: (api) => Math.min(api.myTrashCount(), 15), // HP5 + 最大15 = 上限20
  },
  '1-A017': { kind: 'character', standbyImmune: true },
  '1-A018': {
    kind: 'character',
    onDamaged: (api, amount, isActor) => {
      if (isActor) {
        api.damageAttacker(amount); // 攻撃してきた使用キャラ本人に跳ね返す
        api.millDeck('me', 2);
      }
    },
  },
  '1-A023': {
    kind: 'character',
    onAllyKo: (api) => api.healAllAllies(2),
  },
  '1-A024': {
    kind: 'character',
    maxHpBonus: (api) => (api.selfHasEquipment() ? 3 : 0),
  },

  // ================================================== 装備
  '1-A025': { kind: 'equipment', skillCostDelta: 1 },
  '1-A026': { kind: 'equipment', maxHpDelta: 1 },
  '1-A027': { kind: 'equipment', maxHpDelta: -2 },
  '1-A028': { kind: 'equipment' }, // 属性追加のみ
  '1-A029': {
    kind: 'equipment',
    onOwnTurnEnd: (api) => api.healSelf(1),
  },
  '1-A030': { kind: 'equipment', maxHpDelta: 2 },
  '1-A031': { kind: 'equipment' }, // 属性追加のみ
  '1-A032': { kind: 'equipment' }, // 属性追加のみ

  // ================================================== フィールド
  '1-A033': { kind: 'field', skillCostDeltaAll: -1 },
  '1-A034': { kind: 'field', rotationSkipWhenFullAlive: true },
  '1-A035': { kind: 'field', grantAttrAll: '斬' },
  '1-A036': { kind: 'field', drawBonusAll: 1 },

  // ================================================== スキル: USR/SSR/SR
  '1-A037': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myTrashCount()),
  },
  '1-A038': {
    kind: 'skill',
    targeting: 'all',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('闇')),
  },
  '1-A039': {
    kind: 'skill',
    onAttackDeclare: (api) => api.setDamage(Math.floor(api.targetMaxHp() / 2)),
  },
  '1-A040': {
    kind: 'skill',
    healTargeting: 'ko', // 対象は戦闘不能の味方だけ。選んだキャラを復活させる
  },
  '1-A041': {
    kind: 'skill',
    onAttackResolved: (api) => api.millDeck('enemy', api.myAttrCount('炎')),
  },
  '1-A042': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('竜')),
  },
  '1-A043': { kind: 'skill', targeting: 'choose' },
  '1-A044': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('突') * 3),
    onPlay: (api) => api.addAttributeToSelf('突', 1),
  },
  '1-A045': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A046': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myDamage()),
  },
  '1-A047': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      // 対象の属性の合計数 ×1
      const attrs = ['斬', '突', '打', '射', '飛', '炎', '氷', '雷', '風', '土', '木', '聖', '闇', '竜', '獣', '補', '守'] as const;
      let total = 0;
      for (const a of attrs) total += api.targetAttrCount(a);
      api.addDamage(total);
    },
  },
  '1-A048': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      if (api.targetAttrCount('闇') > 0) api.addDamage(2);
    },
  },
  '1-A049': {
    kind: 'skill',
    healTargeting: 'none', // 全体回復なので対象選択なし
    onPlay: (api) => {
      api.healAllAllies(api.myAttrCount('聖') * 2);
      api.forceChangeEnemyActor();
    },
  },
  '1-A050': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeAllHand();
      api.chargeFromDeck('me', 4);
    },
  },
  '1-A051': {
    kind: 'skill',
    onPlay: (api) => {
      api.discardHandAll();
      api.drawCards('me', 5);
    },
  },
  '1-A052': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      const n = api.consumeAllMyAp();
      api.addDamage(n);
    },
  },
  '1-A053': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A054': {
    kind: 'skill',
    onPlay: (api) => api.castFromDeck({ maxCost: 4, attr: '炎' }),
  },

  // ================================================== スキル: R
  '1-A055': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.lockEnemyActor(),
  },
  '1-A056': { kind: 'skill', targeting: 'all' },
  '1-A057': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('打')),
    onAttackResolved: (api, dealt) => {
      if (dealt > 0) api.chargeFromDeck('me', api.myAttrCount('打'));
    },
  },
  '1-A058': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A059': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('斬') * 2),
  },
  '1-A061': { kind: 'skill', targeting: 'all' },
  '1-A063': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(1),
  },
  '1-A064': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myKoCount() * 2),
  },
  '1-A065': { kind: 'skill', targeting: 'choose' },
  '1-A066': {
    kind: 'skill',
    onGuardDeclare: (api) => api.addGuardValue(api.myAttrCount('氷') * 2),
  },
  '1-A067': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api, _dealt, damagedCount) => {
      api.discardEnemyAp(damagedCount ?? 0); // ダメージを与えたキャラの数だけ減少
    },
  },
  '1-A069': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => {
      if (dealt > 0) api.lockEnemyActor();
    },
  },
  '1-A070': { kind: 'skill', noGuard: true },
  '1-A072': { kind: 'skill', targeting: 'standby' },
  '1-A073': {
    kind: 'skill',
    onAttackResolved: (api) => api.destroyTargetEquipment(),
  },
  '1-A074': {
    kind: 'skill',
    onPlay: (api) => {
      api.addAttributeToSelf('木', 1);
      api.healSelf(4);
    },
  },
  '1-A076': { kind: 'skill', anyCharacterCanUse: true },
  '1-A077': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => api.healSelf(dealt),
  },
  '1-A078': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      if (api.targetHp() <= 5) api.addDamage(2);
    },
  },
  '1-A079': {
    kind: 'skill',
    onPlay: (api) => {
      api.lockMyActor();
      api.reduceIncomingDamage(2);
    },
  },
  '1-A080': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A081': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('竜', 1),
  },
  '1-A082': {
    kind: 'skill',
    onPlay: (api) => {
      api.addAttributeToSelf('闇', 2);
      api.damageSelf(2);
    },
  },
  '1-A083': {
    kind: 'skill',
    costDelta: (api) => (api.turn() <= 4 ? -1 : 0), // 2ターン目以内（通しターン4まで）ならコスト0
  },
  '1-A084': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.targetAttrCount('闇')),
  },
  '1-A085': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('斬', 1),
  },

  // ================================================== スキル: UC
  '1-A087': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('獣', 1),
  },
  '1-A088': {
    kind: 'skill',
    onGuardDeclare: (api) => api.chargeFromDeck('me', 1),
  },
  '1-A089': { kind: 'skill', targeting: 'all' },
  '1-A092': {
    kind: 'skill',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A093': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('突') * 2),
  },
  '1-A095': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('獣')),
  },
  '1-A096': {
    kind: 'skill',
    onPlay: (api) => api.millDeck('enemy', 4),
  },
  '1-A097': {
    kind: 'skill',
    onAttackResolved: (api) => {
      if (api.targetHp() >= 8) api.damageTarget(4);
    },
  },
  '1-A098': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A099': {
    kind: 'skill',
    onPlay: (api) => api.castFromDeck({ maxCost: 3, attr: '風' }),
  },
  '1-A100': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('木')),
    onAttackResolved: (api, dealt) => api.returnTrashBottomToDeck(dealt),
  },
  '1-A102': {
    kind: 'skill',
    onPlay: (api) => api.chargeFromDeck('me', 4),
  },
  '1-A103': { kind: 'skill', noGuard: true },
  '1-A106': {
    kind: 'skill',
    healTargeting: 'none', // 全体回復なので対象選択なし
    onPlay: (api) => api.healAllAllies(2),
  },
  '1-A107': {
    kind: 'skill',
    onPlay: (api) => api.drawCards('me', 3),
  },
  '1-A108': {
    kind: 'skill',
    onAttackResolved: (api) => api.reduceEnemyNextDraw(1),
  },
  '1-A109': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeFromDeck('me', 2);
      api.chargeFromDeck('enemy', 2);
    },
  },
  '1-A110': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeFromDeck('me', 1);
      api.healSelf(1);
    },
  },
  '1-A111': {
    kind: 'skill',
    onPlay: (api) =>
      api.searchDeckToHand((id) => {
        const card = cardByPrintingId(id);
        return card.type === 'skill' && card.valueType === 'attack' && card.costAp <= 2;
      }),
  },

  // ================================================== スキル: C
  '1-A112': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToAllAllies('聖'),
  },
  '1-A113': {
    kind: 'skill',
    onAttackResolved: (api) => api.millDeck('enemy', 2),
  },
  '1-A114': {
    kind: 'skill',
    onAttackResolved: (api) => api.lockEnemyActor(),
  },
  '1-A115': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(1),
  },
  '1-A117': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('闇') * 2),
  },
  '1-A118': { kind: 'skill', targeting: 'all' },
  '1-A120': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      // コンボスタブ: このターン既にスキルを使っていれば+4（2026-07-23 社長調整）
      if (api.skillsUsedThisTurn() >= 2) api.addDamage(4);
    },
  },
  '1-A121': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => api.healSelf(dealt),
  },
  '1-A126': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A127': {
    kind: 'skill',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A128': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('斬')),
  },
  '1-A131': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('炎', 1),
  },
  '1-A133': {
    kind: 'skill',
    onPlay: (api) => {
      api.reduceNextSkillCost(2);
      api.unlockMyActor();
    },
  },
  '1-A134': {
    kind: 'skill',
    onGuardDeclare: (api) => api.discardEnemyAp(2),
  },
  '1-A135': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => {
      api.becomeActor();
      api.lockMyActor();
    },
  },
  '1-A136': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => {
      api.becomeActor();
      api.drawCards('me', 4);
    },
  },
  '1-A137': {
    kind: 'skill',
    onGuardDeclare: (api) => api.changeMyActor(),
  },
  '1-A139': {
    kind: 'skill',
    onPlay: (api) => api.chargeFromDeck('me', 1),
  },
  '1-A141': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A142': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('獣')),
  },
  '1-A143': {
    kind: 'skill',
    onPlay: (api) => api.drawCards('me', 1),
  },
  '1-A144': {
    kind: 'skill',
    onPlay: (api) => api.changeMyActor(1),
  },
};
