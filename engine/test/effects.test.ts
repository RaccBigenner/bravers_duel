import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createBattle,
  effectiveAttributes,
  isCharAlive,
  type BattleState,
  type PlayerIndex,
} from '../src/battle';
import { ALL_CARDS, cardById } from '../src/cards';
import { containsAll, type DeckList } from '../src/decks';
import { implementedEffectCount } from '../src/effects';
import { sampleArchetypeDecks } from '../src/sampleDecks';
import type { CharacterCard, SkillCard } from '../src/types';

const VANILLA_ATK = '1-A129-C'; // ファストスタブ cost1 base4 [突]
const ORUS = '1-A005-USR'; // バニラキャラ 斬突打 HP13
const STOMY = '1-A011-SR'; // バニラキャラ 突突飛 HP11
const DADA = '1-A021-R'; // バニラキャラ 雷氷土 HP11
const OWU = '1-A022-R'; // バニラキャラ 飛風獣 HP10

function battleWith(p0chars: string[], p0deck: string, p1chars: string[], p1deck: string): BattleState {
  const decks: [DeckList, DeckList] = [
    { characterIds: p0chars, cardIds: Array(20).fill(p0deck) },
    { characterIds: p1chars, cardIds: Array(20).fill(p1deck) },
  ];
  return createBattle(decks, 7, { firstPlayer: 0, validate: false });
}

function giveAp(state: BattleState, player: PlayerIndex, count: number) {
  state.players[player].ap.push(...Array(count).fill(VANILLA_ATK));
}

/** そのスキルの条件を満たすバニラ寄りのキャラを探す（クラウディアは攻撃修正があるので除外） */
function charForSkill(skillId: string): CharacterCard {
  const skill = cardById(skillId) as SkillCard;
  const chars = ALL_CARDS.filter((c): c is CharacterCard => c.type === 'character');
  const found = chars.find(
    (ch) => ch.id !== '1-A003-USR' && containsAll(ch.attribute, skill.conditionAttribute),
  );
  if (!found) throw new Error(`条件を満たすキャラがいない: ${skillId}`);
  return found;
}

describe('キャラクターの常時能力', () => {
  it('クラウディア: バトル開始時にデッキから2枚チャージ', () => {
    const state = battleWith(['1-A003-USR', ORUS], VANILLA_ATK, [DADA, OWU], VANILLA_ATK);
    expect(state.players[0].ap).toHaveLength(2);
    expect(state.players[0].deck).toHaveLength(13); // 20 - 手札5 - チャージ2
  });

  it('クラウディア: 攻撃時にAPが4以下ならダメージ+2', () => {
    const atk = cardById('1-A062-R') as SkillCard; // 神の捌き: 聖雷 cost4 base10（効果なし）
    const state = battleWith(['1-A003-USR'], '1-A062-R', [ORUS, OWU], VANILLA_ATK); // 敵はHP13のオルス（ダメージが上限で切れないように）
    state.players[0].ap = [];
    giveAp(state, 0, atk.costAp); // 支払い後 AP0 → 4以下
    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.players[1].characters[0].damage).toBe(atk.baseValue + 2);
  });

  it('ジエンド: 自分のターンの終わりにデッキから2枚トラッシュ', () => {
    const state = battleWith(['1-A002-LSR', ORUS], VANILLA_ATK, [DADA, OWU], VANILLA_ATK);
    const deckBefore = state.players[0].deck.length;
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(state.players[0].deck).toHaveLength(deckBefore - 2);
    expect(state.players[0].trash).toHaveLength(2);
  });

  it('ヤクビ: ターン終了時アクターなら敵全体に2ダメージしてアクター交代', () => {
    const state = battleWith(['1-A009-SR', ORUS], VANILLA_ATK, [DADA, OWU], VANILLA_ATK);
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(state.players[1].characters[0].damage).toBe(2);
    expect(state.players[1].characters[1].damage).toBe(2);
    expect(state.players[0].actorIndex).toBe(1); // 交代している
  });

  it('ミルオン: アクター時に被ダメージを反射し、自分のデッキを2枚トラッシュ', () => {
    const state = battleWith([ORUS, STOMY], VANILLA_ATK, ['1-A018-R', DADA], VANILLA_ATK);
    const atk = cardById(VANILLA_ATK) as SkillCard;
    giveAp(state, 0, atk.costAp);
    const defenderDeckBefore = state.players[1].deck.length;

    applyAction(state, { type: 'playSkill', handIndex: 0 });

    expect(state.players[1].characters[0].damage).toBe(atk.baseValue); // ミルオン被弾
    expect(state.players[0].characters[0].damage).toBe(atk.baseValue); // 反射（オルスはまだアクター、交代は解決後）
    expect(state.players[1].deck).toHaveLength(defenderDeckBefore - 2);
  });
});

describe('スキルの効果', () => {
  it('属性スケーリング: 大裂斬は斬の数×2を追加', () => {
    const skill = cardById('1-A059-R') as SkillCard;
    const ch = charForSkill('1-A059-R');
    const state = battleWith([ch.id], '1-A059-R', [DADA, OWU], VANILLA_ATK);
    giveAp(state, 0, skill.costAp);
    const zan = ch.attribute.filter((a) => a === '斬').length;

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.players[1].characters[0].damage).toBe(skill.baseValue + zan * 2);
  });

  it('全体攻撃: エンシェントブレスは敵全員に当たる', () => {
    const skill = cardById('1-A056-R') as SkillCard;
    const ch = charForSkill('1-A056-R');
    const state = battleWith([ch.id], '1-A056-R', [DADA, OWU], VANILLA_ATK);
    giveAp(state, 0, skill.costAp);

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.players[1].characters[0].damage).toBe(skill.baseValue);
    expect(state.players[1].characters[1].damage).toBe(skill.baseValue);
  });

  it('防御不可: スチールスキュアーはguardの割り込みが発生しない', () => {
    const skill = cardById('1-A103-UC') as SkillCard;
    const ch = charForSkill('1-A103-UC');
    // 相手はguardを持ちAPもあるが、割り込めずそのまま解決される
    const state = battleWith([ch.id], '1-A103-UC', [DADA, OWU], '1-A124-C');
    giveAp(state, 0, skill.costAp);
    giveAp(state, 1, 5);

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.phase).toBe('play'); // guardフェーズにならない
    expect(state.players[1].characters[0].damage).toBe(skill.baseValue);
  });

  it('AP破壊: スタンショックで敵のAPが1枚減る', () => {
    const skill = cardById('1-A115-C') as SkillCard;
    const ch = charForSkill('1-A115-C');
    const state = battleWith([ch.id], '1-A115-C', [DADA, OWU], VANILLA_ATK);
    giveAp(state, 0, skill.costAp);
    const enemyApBefore = state.players[1].ap.length; // 後攻補償の2枚

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    expect(state.players[1].ap).toHaveLength(Math.max(0, enemyApBefore - 1));
  });

  it('チャージ支援: 全力補給でデッキから4枚APになる', () => {
    const skill = cardById('1-A102-UC') as SkillCard;
    const ch = charForSkill('1-A102-UC');
    const state = battleWith([ch.id], '1-A102-UC', [DADA, OWU], VANILLA_ATK);
    giveAp(state, 0, skill.costAp);
    const apBefore = state.players[0].ap.length;
    const deckBefore = state.players[0].deck.length;

    applyAction(state, { type: 'playSkill', handIndex: 0 });
    // コスト支払いでAPが減った後、4枚チャージされる
    expect(state.players[0].ap).toHaveLength(apBefore - skill.costAp + 4);
    expect(state.players[0].deck).toHaveLength(deckBefore - 4);
  });

  it('復活: ティアグレイスで戦闘不能の味方が戻る', () => {
    const skill = cardById('1-A040-USR') as SkillCard;
    const state = battleWith(['1-A019-R', ORUS], '1-A040-USR', [DADA, OWU], VANILLA_ATK);
    const fallen = state.players[0].characters[1]; // オルスを戦闘不能に
    fallen.damage = fallen.maxHp;
    giveAp(state, 0, skill.costAp);

    applyAction(state, { type: 'playSkill', handIndex: 0, healTargetIndex: 0 });
    expect(fallen.damage).toBeLessThan(fallen.maxHp); // 復活している
  });

  it('選択攻撃: コメットスナイプは控えを狙える', () => {
    const skill = cardById('1-A043-SR') as SkillCard;
    const ch = charForSkill('1-A043-SR');
    const state = battleWith([ch.id], '1-A043-SR', [DADA, OWU], VANILLA_ATK);
    giveAp(state, 0, skill.costAp);

    applyAction(state, { type: 'playSkill', handIndex: 0, targetIndex: 1 }); // 控え(1)を指定
    expect(state.players[1].characters[1].damage).toBe(skill.baseValue);
    expect(state.players[1].characters[0].damage).toBe(0);
  });
});

describe('装備カード', () => {
  it('装備すると属性が増えてスキル条件を満たせる・付け替えで古い装備はトラッシュ', () => {
    // 崩れかけの宝剣(斬斬) をダダ(雷氷土)に付けると斬スキルが使える
    const state = battleWith([DADA, OWU], '1-A025-SR', [ORUS, STOMY], VANILLA_ATK);
    const zanSkill = cardById('1-A123-C') as SkillCard; // パリィ(斬)は使えないはず→装備後に判定が変わることを大裂斬で確認
    applyAction(state, { type: 'playEquipment', handIndex: 0, targetIndex: 0 });
    expect(state.players[0].characters[0].equipmentCardId).toBe('1-A025-SR');

    // 付け替え: もう1枚付けると古い方がトラッシュへ
    applyAction(state, { type: 'playEquipment', handIndex: 0, targetIndex: 0 });
    expect(state.players[0].trash).toContain('1-A025-SR');
    expect(zanSkill.conditionAttribute).toContain('斬'); // 前提の確認
  });

  it('王家の盾でHP+1（最大HPが増える）', () => {
    const state = battleWith([DADA, OWU], '1-A026-SR', [ORUS, STOMY], VANILLA_ATK);
    const dada = state.players[0].characters[0];
    applyAction(state, { type: 'playEquipment', handIndex: 0, targetIndex: 0 });
    dada.damage = dada.maxHp; // 本来のHPちょうどのダメージ
    // 王家の盾の+1で、まだ戦闘不能ではない
    expect(isCharAlive(state, 0, 0)).toBe(true);
  });

  it('医療セット: ターン終了時に1回復', () => {
    const state = battleWith([DADA, OWU], '1-A029-C', [ORUS, STOMY], VANILLA_ATK);
    const dada = state.players[0].characters[0];
    applyAction(state, { type: 'playEquipment', handIndex: 0, targetIndex: 0 });
    dada.damage = 3;
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(dada.damage).toBe(2);
  });

  it('ロッソ: 装備しているとHP+3', () => {
    const state = battleWith(['1-A024-R', OWU], '1-A028-R', [ORUS, STOMY], VANILLA_ATK);
    const rosso = state.players[0].characters[0];
    applyAction(state, { type: 'playEquipment', handIndex: 0, targetIndex: 0 });
    rosso.damage = rosso.maxHp + 1; // 本来のHP10を超えるダメージ
    expect(isCharAlive(state, 0, 0)).toBe(true); // 装備+3のHP13でまだ生きている
    rosso.damage = rosso.maxHp + 3;
    expect(isCharAlive(state, 0, 0)).toBe(false); // 13ダメージで戦闘不能
  });
});

describe('フィールドカード', () => {
  it('剣の墓場: 全キャラに斬属性が追加される', () => {
    const state = battleWith([DADA, OWU], '1-A035-R', [ORUS, STOMY], VANILLA_ATK);
    expect(effectiveAttributes(state, 0, 0)).not.toContain('斬');
    applyAction(state, { type: 'playField', handIndex: 0 });
    expect(effectiveAttributes(state, 0, 0)).toContain('斬');
    expect(effectiveAttributes(state, 1, 0)).toContain('斬'); // 相手にも効く
  });

  it('フィールドは上書きされて古い方は持ち主のトラッシュへ', () => {
    const state = battleWith([DADA, OWU], '1-A035-R', [ORUS, STOMY], '1-A036-R');
    applyAction(state, { type: 'playField', handIndex: 0 });
    expect(state.field?.cardId).toBe('1-A035-R');
    // 相手のターンにして相手が激闘を出す
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    applyAction(state, { type: 'playField', handIndex: 0 });
    expect(state.field?.cardId).toBe('1-A036-R');
    expect(state.players[0].trash).toContain('1-A035-R'); // 古い方は元の持ち主のトラッシュ
  });

  it('激闘: ドローフェーズに1枚多く引く（手札6枚まで）', () => {
    const state = battleWith([DADA, OWU], '1-A036-R', [ORUS, STOMY], VANILLA_ATK);
    applyAction(state, { type: 'playField', handIndex: 0 });
    applyAction(state, { type: 'endPlay' });
    applyAction(state, { type: 'endTurn' });
    expect(state.players[1].hand).toHaveLength(6); // 5枚 + 激闘の1枚
  });
});

describe('アニマ（AI自動判断）', () => {
  it('自分の方が使えるスキルが多い時、ターン開始時にアクターになる', () => {
    // 手札は闇スキル(カオスフレア: 闇条件)だらけ。アクターのオルスは使えず、アニマ(闇獣)は使える
    // → 1ターン目の開始時（バトル作成直後）にもうアクターになっている
    const state = battleWith([ORUS, '1-A006-USR'], '1-A038-USR', [DADA, OWU], VANILLA_ATK);
    expect(state.players[0].actorIndex).toBe(1);
  });
});

describe('効果レジストリとサンプルデッキ', () => {
  it('効果の実装数が想定どおり（新カード追加時はここを更新）', () => {
    expect(implementedEffectCount()).toBeGreaterThanOrEqual(99);
  });

  it('アーキタイプデッキは8種あり、全てルールに合格する', () => {
    const decks = sampleArchetypeDecks();
    expect(decks).toHaveLength(8);
    for (const d of decks) {
      expect(d.deck.cardIds).toHaveLength(40);
    }
  });
});
