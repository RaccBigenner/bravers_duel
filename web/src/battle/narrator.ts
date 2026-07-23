/**
 * エンジンの型付きイベント（BattleEvent）を「演出イベント（NarrEvent）」に変換する。
 * バトル画面はこのイベント列を1件ずつ順番に再生する。
 *
 * 以前はエンジンの日本語ログを正規表現でパースしていたが、側やキャラ位置の
 * 取り違いバグの温床だったため廃止した。位置・数値はすべてイベントが持っている。
 * ここの仕事は「表示する文とテンポ（duration）を決める」ことだけ。
 */
import { cardById, type BattleEvent, type BattleState, type Card } from '@bravers/engine';

export type FxKind =
  | 'coin' | 'turn' | 'draw' | 'charge' | 'chargeDeck' | 'chargeTrash' | 'chargeAll'
  | 'mill' | 'apTrash' | 'handTrash' | 'trashToDeck' | 'play' | 'guard'
  | 'attack' | 'damage' | 'heal' | 'ko' | 'revive' | 'actor' | 'ability'
  | 'power' | 'powerGuard'
  | 'equip' | 'field' | 'attr' | 'search' | 'lock' | 'unlock' | 'end' | 'info';

export interface NarrEvent {
  key: number;
  kind: FxKind;
  text: string;
  card?: Card; // カットインで見せるカード
  side?: 0 | 1; // 対象キャラの側
  charIndex?: number;
  amount?: number;
  cardName?: string; // 表示状態の更新（リデューサ）用
  charName?: string;
  attr?: string;
  /** ガードなど「AからBへ変化」を伝えるときの変化前の値（amount = 変化後） */
  amountBefore?: number;
  /** 開幕分など、表示状態に適用しないイベント */
  noApply?: boolean;
  duration: number;
}

let uniq = 1;

/** 側つきの名前表示（相手側には「相手の」を付ける） */
function sideName(side: 0 | 1, name: string): string {
  return side === 1 ? `相手の${name}` : name;
}

function safeCard(id: string): Card | undefined {
  try {
    return cardById(id);
  } catch {
    return undefined;
  }
}

/** BattleEvent 1件を演出イベントに変換する。null なら演出なし */
export function narrate(state: BattleState, e: BattleEvent): NarrEvent | null {
  const ev = (x: Omit<NarrEvent, 'key'>): NarrEvent => ({ key: uniq++, ...x });
  const charName = (side: 0 | 1, ci: number) => state.players[side].characters[ci]?.name ?? '';

  switch (e.t) {
    case 'battleStart':
      return ev({ kind: 'coin', text: e.first === 0 ? '先攻はあなた！' : '先攻は相手！', side: e.first, duration: 2200 });
    case 'bonusCharge':
      return ev({
        kind: 'chargeDeck',
        text: e.player === 0 ? `後攻ボーナス！デッキから${e.n}枚チャージ` : `相手は後攻ボーナスで${e.n}枚チャージ`,
        side: e.player, amount: e.n, duration: 1100,
      });
    case 'turnStart':
      return ev({
        kind: 'turn',
        text: e.player === 0 ? `ターン${e.turn} あなたの番！` : `ターン${e.turn} 相手の番`,
        side: e.player, duration: 1400,
      });
    case 'battleEnd':
      return ev({ kind: 'end', text: e.winner === null ? '引き分け…' : 'バトル終了！', duration: 1200 });
    case 'deckout':
      return ev({ kind: 'info', text: e.player === 0 ? '山札切れ！手札を5枚にできない…' : '相手が山札切れ！', duration: 1500 });

    case 'draw':
      return ev({ kind: 'draw', text: e.player === 0 ? `${e.n}枚ドロー！` : `相手が${e.n}枚ドロー`, side: e.player, amount: e.n, duration: 750 });
    case 'chargeHand': {
      const name = safeCard(e.cardId)?.name ?? '';
      return ev({
        kind: 'charge',
        text: e.player === 0 ? `「${name}」をチャージ（AP ${e.ap}）` : `相手がチャージ（AP ${e.ap}）`,
        side: e.player, cardName: name, duration: 550,
      });
    }
    case 'chargeDeck':
      return ev({ kind: 'chargeDeck', text: e.player === 0 ? `デッキから${e.n}枚チャージ（AP ${e.ap}）` : `相手がデッキから${e.n}枚チャージ`, side: e.player, amount: e.n, duration: 850 });
    case 'chargeTrash':
      return ev({ kind: 'chargeTrash', text: e.player === 0 ? `トラッシュから${e.n}枚チャージ！` : `相手がトラッシュから${e.n}枚チャージ`, side: e.player, amount: e.n, duration: 850 });
    case 'chargeAllHand':
      return ev({ kind: 'chargeAll', text: e.player === 0 ? `手札を全てチャージ（${e.n}枚）！` : '相手が手札を全てチャージ', side: e.player, amount: e.n, duration: 900 });
    case 'handTrash':
      return ev({ kind: 'handTrash', text: e.player === 0 ? `手札を全てトラッシュ（${e.n}枚）` : '相手が手札を全てトラッシュ', side: e.player, amount: e.n, duration: 900 });
    case 'mill':
      return ev({ kind: 'mill', text: e.player === 0 ? `自分のデッキから${e.n}枚トラッシュ` : `相手のデッキから${e.n}枚トラッシュ！`, side: e.player, amount: e.n, duration: 850 });
    case 'apTrash':
      return ev({ kind: 'apTrash', text: e.player === 0 ? `APから${e.n}枚トラッシュ！` : `相手のAPから${e.n}枚トラッシュ！`, side: e.player, amount: e.n, duration: 900 });
    case 'trashToDeck':
      return ev({ kind: 'trashToDeck', text: e.player === 0 ? `トラッシュから${e.n}枚をデッキへ` : `相手がトラッシュから${e.n}枚をデッキへ`, side: e.player, amount: e.n, duration: 850 });
    case 'searchToHand': {
      const name = safeCard(e.cardId)?.name ?? '';
      return ev({ kind: 'search', text: `デッキから「${name}」を手札に！`, side: e.player, cardName: name, duration: 1275 });
    }

    case 'skillUsed': {
      const card = safeCard(e.cardId);
      return ev({ kind: 'play', text: `${charName(e.player, e.charIndex)}の「${card?.name}」！`, card, side: e.player, charIndex: e.charIndex, duration: 1600 });
    }
    case 'characterCardUsed': {
      const card = safeCard(e.cardId);
      return ev({ kind: 'play', text: `「${card?.name}」で同名キャラを回復！`, card, side: e.player, duration: 1500 });
    }
    case 'castFromDeck': {
      const card = safeCard(e.cardId);
      return ev({ kind: 'play', text: `デッキから「${card?.name}」が発動！`, card, side: e.player, charIndex: e.charIndex, duration: 1600 });
    }
    case 'attackDeclared': {
      const name = safeCard(e.cardId)?.name ?? '';
      return ev({
        kind: 'attack',
        text: e.noGuard ? `「${name}」はガード不可の攻撃！` : `「${name}」の攻撃！（ダメージ${e.value}）`,
        side: e.player, charIndex: e.charIndex, amount: e.value, duration: 900,
      });
    }
    case 'guardPlayed': {
      const card = safeCard(e.cardId);
      return ev({
        kind: 'guard',
        text: `ガード！「${card?.name}」 ${e.before}→${e.after}`,
        card, side: e.player, charIndex: e.charIndex,
        amountBefore: e.before, amount: e.after, duration: 1500,
      });
    }
    case 'equip': {
      const card = safeCard(e.cardId);
      return ev({ kind: 'equip', text: `${sideName(e.player, charName(e.player, e.charIndex))}に「${card?.name}」を装備`, card, side: e.player, charIndex: e.charIndex, duration: 1500 });
    }
    case 'equipDestroyed': {
      const name = safeCard(e.cardId)?.name ?? '';
      return ev({ kind: 'equip', text: `${sideName(e.player, charName(e.player, e.charIndex))}の装備「${name}」を破壊！`, duration: 1275 });
    }
    case 'fieldSet': {
      const card = safeCard(e.cardId);
      return ev({ kind: 'field', text: `フィールド「${card?.name}」を展開！`, card, side: e.player, duration: 1500 });
    }

    case 'powerUp':
      return ev({ kind: 'power', text: `${sideName(e.player, charName(e.player, e.charIndex))}の攻撃威力+${e.n}！`, side: e.player, charIndex: e.charIndex, amount: e.n, amountBefore: e.total, duration: 950 });
    case 'guardBoost':
      return ev({ kind: 'powerGuard', text: `ガード強化+${e.n}！`, side: e.player, charIndex: state.players[e.player].actorIndex, amount: e.n, amountBefore: e.remain, duration: 950 });
    case 'damage':
      return ev({ kind: 'damage', text: `${sideName(e.player, charName(e.player, e.charIndex))}に${e.n}ダメージ！`, side: e.player, charIndex: e.charIndex, amount: e.n, duration: 1125 });
    case 'standbyImmune':
      return ev({ kind: 'info', text: `${sideName(e.player, charName(e.player, e.charIndex))}は控えのため無傷！`, charName: '無傷', side: e.player, charIndex: e.charIndex, duration: 1200 });
    case 'heal':
      return ev({ kind: 'heal', text: `${sideName(e.player, charName(e.player, e.charIndex))}が${e.n}回復`, side: e.player, charIndex: e.charIndex, amount: e.n, duration: 1125 });
    case 'ko':
      return ev({ kind: 'ko', text: `${sideName(e.player, charName(e.player, e.charIndex))}は戦闘不能！`, side: e.player, charIndex: e.charIndex, duration: 1600 });
    case 'revive':
      return ev({ kind: 'revive', text: `${sideName(e.player, charName(e.player, e.charIndex))}が復活！`, side: e.player, charIndex: e.charIndex, amount: e.hp, duration: 1600 });

    case 'actorChanged': {
      const name = charName(e.player, e.charIndex);
      return ev({
        kind: 'actor',
        text: e.forced
          ? `${e.player === 1 ? '相手の' : ''}アクターは${name}に強制交代`
          : e.player === 0
            ? `アクターが${name}に交代`
            : `相手のアクターが${name}に交代`,
        side: e.player, charIndex: e.charIndex, charName: name,
        duration: e.forced ? 1250 : 1125,
      });
    }
    case 'actorLocked':
      return ev({
        kind: 'lock',
        text: e.player === 0 ? '自分のアクターをロック（交代できない）' : '相手のアクターをロック！（交代できない）',
        side: e.player, charIndex: state.players[e.player].actorIndex, amount: e.untilTurn, duration: 1275,
      });
    case 'actorUnlocked':
      return ev({ kind: 'unlock', text: e.player === 0 ? 'ロック解除！' : '相手のロックが解除された', side: e.player, charIndex: state.players[e.player].actorIndex, duration: 900 });
    case 'lockBlocked':
      return ev({ kind: 'lock', text: 'ロック中で交代できない！', side: e.player, charIndex: state.players[e.player].actorIndex, duration: 1125 });

    case 'attributeAdded':
      return ev({ kind: 'attr', text: `${sideName(e.player, charName(e.player, e.charIndex))}に${e.attr}属性を追加`, attr: e.attr, side: e.player, charIndex: e.charIndex, duration: 1250 });
    case 'abilityTriggered':
      return ev({ kind: 'ability', text: `${e.label}！`, side: e.player, charIndex: e.charIndex, duration: 1100 });
    case 'info':
      return ev({ kind: 'info', text: e.text, duration: 1050 });
    default:
      return null;
  }
}
