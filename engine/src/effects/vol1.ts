/**
 * 第1弾カードの効果定義（全113枚 = キャラ16 + スキル85 + 装備8 + フィールド4）。
 * ここは「カードID → 効果」の静的な表。バトル状態への参照は持たない。
 *
 * 暫定・解釈で実装しているもの:
 * - 1-A006 アニマ: AI自動判断（自分の方が使える手札スキルが多ければアクターになる）
 * - 1-A054 炎霊召喚 / 1-A099 風を集める: デッキから本当に使用する（奇襲扱いでguard割り込み不可）
 * - 1-A106 オールグレイス: 味方全体を基本値ぶん回復と解釈
 * - 1-A083 神速剣: 「2ターン目以内」= 通しターン4以内と解釈
 */
import { cardById } from '../cards';
import type { CardEffect } from './types';

export const VOL1_EFFECTS: Record<string, CardEffect> = {
  // ================================================== キャラクター
  '1-A001-LSR': { kind: 'character', handRefillBonus: 1 },
  '1-A002-LSR': {
    kind: 'character',
    onOwnTurnEnd: (api) => api.millDeck('me', 2),
  },
  '1-A003-USR': {
    kind: 'character',
    onBattleStart: (api) => api.chargeFromDeck('me', 2),
    onAttackDeclare: (api) => {
      if (api.myApCount() <= 4) api.addDamage(2);
    },
  },
  '1-A004-USR': { kind: 'character', skillCostDelta: 2 },
  '1-A006-USR': {
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
  '1-A007-SSR': {
    kind: 'character',
    onAllyKo: (api) => api.damageEnemyActor(3),
  },
  '1-A008-SSR': { kind: 'character', grantAllyAttribute: '氷' },
  '1-A009-SR': {
    kind: 'character',
    onOwnTurnEnd: (api, isActor) => {
      if (isActor) {
        api.damageAllEnemies(2);
        api.changeMyActor();
      }
    },
  },
  '1-A010-SR': {
    kind: 'character',
    onHealed: (api) => api.returnTrashBottomToDeck(2),
  },
  '1-A013-SR': {
    kind: 'character',
    onDamaged: (api, amount, isActor) => {
      if (isActor) api.chargeFromTrashBottom(amount);
    },
  },
  '1-A014-SR': {
    kind: 'character',
    onOwnTurnEnd: (api) => api.addAttributeToSelf('闇', 1),
  },
  '1-A015-SR': {
    kind: 'character',
    maxHpBonus: (api) => Math.min(api.myTrashCount(), 15), // HP5 + 最大15 = 上限20
  },
  '1-A017-R': { kind: 'character', standbyImmune: true },
  '1-A018-R': {
    kind: 'character',
    onDamaged: (api, amount, isActor) => {
      if (isActor) {
        api.damageAttacker(amount); // 攻撃してきた使用キャラ本人に跳ね返す
        api.millDeck('me', 2);
      }
    },
  },
  '1-A023-R': {
    kind: 'character',
    onAllyKo: (api) => api.healAllAllies(2),
  },
  '1-A024-R': {
    kind: 'character',
    maxHpBonus: (api) => (api.selfHasEquipment() ? 3 : 0),
  },

  // ================================================== 装備
  '1-A025-SR': { kind: 'equipment', skillCostDelta: 1 },
  '1-A026-SR': { kind: 'equipment', maxHpDelta: 1 },
  '1-A027-R': { kind: 'equipment', maxHpDelta: -2 },
  '1-A028-R': { kind: 'equipment' }, // 属性追加のみ
  '1-A029-C': {
    kind: 'equipment',
    onOwnTurnEnd: (api) => api.healSelf(1),
  },
  '1-A030-C': { kind: 'equipment', maxHpDelta: 2 },
  '1-A031-C': { kind: 'equipment' }, // 属性追加のみ
  '1-A032-C': { kind: 'equipment' }, // 属性追加のみ

  // ================================================== フィールド
  '1-A033-SR': { kind: 'field', skillCostDeltaAll: -1 },
  '1-A034-SR': { kind: 'field', rotationSkipWhenFullAlive: true },
  '1-A035-R': { kind: 'field', grantAttrAll: '斬' },
  '1-A036-R': { kind: 'field', drawBonusAll: 1 },

  // ================================================== スキル: USR/SSR/SR
  '1-A037-USR': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myTrashCount()),
  },
  '1-A038-USR': {
    kind: 'skill',
    targeting: 'all',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('闇')),
  },
  '1-A039-USR': {
    kind: 'skill',
    onAttackDeclare: (api) => api.setDamage(Math.floor(api.targetMaxHp() / 2)),
  },
  '1-A040-USR': {
    kind: 'skill',
    onPlay: (api) => api.reviveAlly(1),
  },
  '1-A041-SR': {
    kind: 'skill',
    onAttackResolved: (api) => api.millDeck('enemy', api.myAttrCount('炎')),
  },
  '1-A042-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('竜')),
  },
  '1-A043-SR': { kind: 'skill', targeting: 'choose' },
  '1-A044-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('突') * 3),
    onPlay: (api) => api.addAttributeToSelf('突', 1),
  },
  '1-A045-SR': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A046-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myDamage()),
  },
  '1-A047-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      // 対象の属性の合計数 ×1
      const attrs = ['斬', '突', '打', '射', '飛', '炎', '氷', '雷', '風', '土', '木', '聖', '闇', '竜', '獣', '補', '守'] as const;
      let total = 0;
      for (const a of attrs) total += api.targetAttrCount(a);
      api.addDamage(total);
    },
  },
  '1-A048-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      if (api.targetAttrCount('闇') > 0) api.addDamage(2);
    },
  },
  '1-A049-SR': {
    kind: 'skill',
    onPlay: (api) => {
      api.healAllAllies(api.myAttrCount('聖') * 2);
      api.forceChangeEnemyActor();
    },
  },
  '1-A050-SR': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeAllHand();
      api.chargeFromDeck('me', 4);
    },
  },
  '1-A051-SR': {
    kind: 'skill',
    onPlay: (api) => {
      api.discardHandAll();
      api.drawCards('me', 5);
    },
  },
  '1-A052-SR': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      const n = api.consumeAllMyAp();
      api.addDamage(n);
    },
  },
  '1-A053-R': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A054-R': {
    kind: 'skill',
    onPlay: (api) => api.castFromDeck({ maxCost: 4, attr: '炎' }),
  },

  // ================================================== スキル: R
  '1-A055-R': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api) => api.lockEnemyActor(),
  },
  '1-A056-R': { kind: 'skill', targeting: 'all' },
  '1-A057-R': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('打')),
    onAttackResolved: (api, dealt) => {
      if (dealt > 0) api.chargeFromDeck('me', api.myAttrCount('打'));
    },
  },
  '1-A058-R': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A059-R': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('斬') * 2),
  },
  '1-A061-R': { kind: 'skill', targeting: 'all' },
  '1-A063-R': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(1),
  },
  '1-A064-R': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myKoCount() * 2),
  },
  '1-A065-R': { kind: 'skill', targeting: 'choose' },
  '1-A066-R': {
    kind: 'skill',
    onGuardDeclare: (api) => api.addGuardValue(api.myAttrCount('氷') * 2),
  },
  '1-A067-R': {
    kind: 'skill',
    targeting: 'all',
    onAttackResolved: (api, _dealt, damagedCount) => {
      api.discardEnemyAp(damagedCount ?? 0); // ダメージを与えたキャラの数だけ減少
    },
  },
  '1-A069-R': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => {
      if (dealt > 0) api.lockEnemyActor();
    },
  },
  '1-A070-R': { kind: 'skill', noGuard: true },
  '1-A072-R': { kind: 'skill', targeting: 'standby' },
  '1-A073-R': {
    kind: 'skill',
    onAttackResolved: (api) => api.destroyTargetEquipment(),
  },
  '1-A074-R': {
    kind: 'skill',
    onPlay: (api) => {
      api.addAttributeToSelf('木', 1);
      api.healSelf(4);
    },
  },
  '1-A076-R': { kind: 'skill', anyCharacterCanUse: true },
  '1-A077-R': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => api.healSelf(dealt),
  },
  '1-A078-R': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      if (api.targetHp() <= 5) api.addDamage(2);
    },
  },
  '1-A079-R': {
    kind: 'skill',
    onPlay: (api) => {
      api.lockMyActor();
      api.reduceIncomingDamage(2);
    },
  },
  '1-A080-R': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(2),
  },
  '1-A081-R': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('竜', 1),
  },
  '1-A082-R': {
    kind: 'skill',
    onPlay: (api) => {
      api.addAttributeToSelf('闇', 2);
      api.damageSelf(2);
    },
  },
  '1-A083-R': {
    kind: 'skill',
    costDelta: (api) => (api.turn() <= 4 ? -1 : 0), // 2ターン目以内（通しターン4まで）ならコスト0
  },
  '1-A084-R': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.targetAttrCount('闇')),
  },
  '1-A085-R': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('斬', 1),
  },

  // ================================================== スキル: UC
  '1-A087-UC': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('獣', 1),
  },
  '1-A088-UC': {
    kind: 'skill',
    onGuardDeclare: (api) => api.chargeFromDeck('me', 1),
  },
  '1-A089-UC': { kind: 'skill', targeting: 'all' },
  '1-A092-UC': {
    kind: 'skill',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A093-UC': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('突') * 2),
  },
  '1-A095-UC': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('獣')),
  },
  '1-A096-UC': {
    kind: 'skill',
    onPlay: (api) => api.millDeck('enemy', 4),
  },
  '1-A097-UC': {
    kind: 'skill',
    onAttackResolved: (api) => {
      if (api.targetHp() >= 8) api.damageTarget(4);
    },
  },
  '1-A098-UC': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A099-UC': {
    kind: 'skill',
    onPlay: (api) => api.castFromDeck({ maxCost: 3, attr: '風' }),
  },
  '1-A100-UC': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('木')),
    onAttackResolved: (api, dealt) => api.returnTrashBottomToDeck(dealt),
  },
  '1-A102-UC': {
    kind: 'skill',
    onPlay: (api) => api.chargeFromDeck('me', 4),
  },
  '1-A103-UC': { kind: 'skill', noGuard: true },
  '1-A106-UC': {
    kind: 'skill',
    onPlay: (api) => api.healAllAllies(2),
  },
  '1-A107-UC': {
    kind: 'skill',
    onPlay: (api) => api.drawCards('me', 3),
  },
  '1-A108-UC': {
    kind: 'skill',
    onAttackResolved: (api) => api.reduceEnemyNextDraw(1),
  },
  '1-A109-UC': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeFromDeck('me', 2);
      api.chargeFromDeck('enemy', 2);
    },
  },
  '1-A110-UC': {
    kind: 'skill',
    onPlay: (api) => {
      api.chargeFromDeck('me', 1);
      api.healSelf(1);
    },
  },
  '1-A111-UC': {
    kind: 'skill',
    onPlay: (api) =>
      api.searchDeckToHand((id) => {
        const card = cardById(id);
        return card.type === 'skill' && card.valueType === 'attack' && card.costAp <= 2;
      }),
  },

  // ================================================== スキル: C
  '1-A112-C': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToAllAllies('聖'),
  },
  '1-A113-C': {
    kind: 'skill',
    onAttackResolved: (api) => api.millDeck('enemy', 2),
  },
  '1-A114-C': {
    kind: 'skill',
    onAttackResolved: (api) => api.lockEnemyActor(),
  },
  '1-A115-C': {
    kind: 'skill',
    onAttackResolved: (api) => api.discardEnemyAp(1),
  },
  '1-A117-C': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('闇') * 2),
  },
  '1-A118-C': { kind: 'skill', targeting: 'all' },
  '1-A120-C': {
    kind: 'skill',
    onAttackDeclare: (api) => {
      if (api.skillsUsedThisTurn() >= 2) api.addDamage(1);
    },
  },
  '1-A121-C': {
    kind: 'skill',
    onAttackResolved: (api, dealt) => api.healSelf(dealt),
  },
  '1-A126-C': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A127-C': {
    kind: 'skill',
    onAttackResolved: (api) => api.forceChangeEnemyActor(),
  },
  '1-A128-C': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('斬')),
  },
  '1-A131-C': {
    kind: 'skill',
    onPlay: (api) => api.addAttributeToSelf('炎', 1),
  },
  '1-A133-C': {
    kind: 'skill',
    onPlay: (api) => {
      api.reduceNextSkillCost(2);
      api.unlockMyActor();
    },
  },
  '1-A134-C': {
    kind: 'skill',
    onGuardDeclare: (api) => api.discardEnemyAp(2),
  },
  '1-A135-C': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => {
      api.becomeActor();
      api.lockMyActor();
    },
  },
  '1-A136-C': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => {
      api.becomeActor();
      api.drawCards('me', 4);
    },
  },
  '1-A137-C': {
    kind: 'skill',
    onGuardDeclare: (api) => api.changeMyActor(),
  },
  '1-A139-C': {
    kind: 'skill',
    onPlay: (api) => api.chargeFromDeck('me', 1),
  },
  '1-A141-C': {
    kind: 'skill',
    anyCharacterCanUse: true,
    onPlay: (api) => api.becomeActor(),
  },
  '1-A142-C': {
    kind: 'skill',
    onAttackDeclare: (api) => api.addDamage(api.myAttrCount('獣')),
  },
  '1-A143-C': {
    kind: 'skill',
    onPlay: (api) => api.drawCards('me', 1),
  },
  '1-A144-C': {
    kind: 'skill',
    onPlay: (api) => api.changeMyActor(1),
  },
};
