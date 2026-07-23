/**
 * エンジンのログ1行を「演出イベント」に変換するナレーター。
 * バトル画面はこのイベント列を1件ずつ順番に再生する。
 */
import { ALL_CARDS, type BattleState, type Card } from '@bravers/engine';

export type FxKind =
  | 'coin' | 'turn' | 'draw' | 'charge' | 'chargeDeck' | 'chargeTrash' | 'chargeAll'
  | 'mill' | 'apTrash' | 'handTrash' | 'play' | 'guard'
  | 'attack' | 'damage' | 'heal' | 'ko' | 'revive' | 'actor' | 'ability'
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
  /** 開幕分など、表示状態に適用しないイベント */
  noApply?: boolean;
  duration: number;
}

const CARD_BY_NAME = new Map<string, Card>(ALL_CARDS.map((c) => [c.name, c]));

let uniq = 1;

/** キャラ名から (side, index) を探す。両側にいる場合は preferSide を優先 */
function findChar(state: BattleState, name: string, preferSide: 0 | 1): [0 | 1, number] | null {
  const hits: [0 | 1, number][] = [];
  state.players.forEach((p, si) => {
    p.characters.forEach((c, ci) => {
      if (c.name === name) hits.push([si as 0 | 1, ci]);
    });
  });
  if (hits.length === 0) return null;
  const preferred = hits.find(([s]) => s === preferSide);
  return preferred ?? hits[0];
}

/** 側が確定しているログ（P1/P2つき）からキャラ位置を引く */
function charOnSide(state: BattleState, side: 0 | 1, name: string): number | undefined {
  const i = state.players[side].characters.findIndex((c) => c.name === name);
  return i >= 0 ? i : undefined;
}

/** 側つきの名前表示（相手側には「相手の」を付ける） */
function sideName(side: 0 | 1, name: string): string {
  return side === 1 ? `相手の${name}` : name;
}

/**
 * ログ1行を演出イベントに変換する。null なら表示しない。
 * actor = この行動を起こした側（ダメージの対象側の推定などに使う）
 */
export function classify(state: BattleState, line: string, actor: 0 | 1): NarrEvent | null {
  const ev = (e: Omit<NarrEvent, 'key'>): NarrEvent => ({ key: uniq++, ...e });
  let m: RegExpMatchArray | null;

  // 表示しないもの
  if (line.startsWith('※') || line.startsWith('効果でエラー') || line.startsWith('効果の連鎖')) return null;

  if ((m = line.match(/^--- ターン(\d+): プレイヤー(\d) ---$/))) {
    const side = (Number(m[2]) - 1) as 0 | 1;
    return ev({ kind: 'turn', text: side === 0 ? `ターン${m[1]} あなたの番！` : `ターン${m[1]} 相手の番`, side, duration: 1400 });
  }
  if ((m = line.match(/^プレイヤー(\d)が(\d+)枚ドロー$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'draw', text: side === 0 ? `${m[2]}枚ドロー！` : `相手が${m[2]}枚ドロー`, side, amount: Number(m[2]), duration: 750 });
  }
  if ((m = line.match(/^(.+)が(.+)を使用$/))) {
    const card = CARD_BY_NAME.get(m[2]);
    const who = findChar(state, m[1], actor);
    return ev({ kind: 'play', text: `${m[1]}の「${m[2]}」！`, card, side: who?.[0] ?? actor, duration: 1600 });
  }
  if ((m = line.match(/^(.+)のカードを使用$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'play', text: `「${m[1]}」で同名キャラを回復！`, card, side: actor, duration: 1500 });
  }
  if ((m = line.match(/^デッキから(.+)をコストなしで使用$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'play', text: `デッキから「${m[1]}」が発動！`, card, side: actor, duration: 1600 });
  }
  if ((m = line.match(/^(.+)で割り込み（(.+)）$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'guard', text: `ガード！「${m[1]}」（${m[2]}）`, card, side: actor, duration: 1400 });
  }
  if ((m = line.match(/^(.+)で攻撃 → 相手は割り込みできる（ダメージ(\d+)）$/))) {
    return ev({ kind: 'attack', text: `「${m[1]}」の攻撃！（ダメージ${m[2]}）`, amount: Number(m[2]), duration: 900 });
  }
  if ((m = line.match(/^(.+)は防御で割り込めない攻撃$/))) {
    return ev({ kind: 'attack', text: `「${m[1]}」はガード不可の攻撃！`, duration: 900 });
  }
  if ((m = line.match(/^P(\d)の(.+)に(\d+)ダメージ（残りHP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({
      kind: 'damage',
      text: `${sideName(side, m[2])}に${m[3]}ダメージ！`,
      side, charIndex: charOnSide(state, side, m[2]), amount: Number(m[3]), duration: 1125,
    });
  }
  if ((m = line.match(/^P(\d)の(.+)を(\d+)回復$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'heal', text: `${sideName(side, m[2])}が${m[3]}回復`, side, charIndex: charOnSide(state, side, m[2]), amount: Number(m[3]), duration: 1125 });
  }
  if ((m = line.match(/^P(\d)の(.+)は戦闘不能$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'ko', text: `${sideName(side, m[2])}は戦闘不能！`, side, charIndex: charOnSide(state, side, m[2]), duration: 1600 });
  }
  if ((m = line.match(/^P(\d)の(.+)が復活（HP(\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'revive', text: `${sideName(side, m[2])}が復活！`, side, charIndex: charOnSide(state, side, m[2]), amount: Number(m[3]), duration: 1600 });
  }
  if ((m = line.match(/^P(\d)のアクターが(.+)（(\d)番手）に強制交代$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'actor', text: `${side === 1 ? '相手の' : ''}アクターは${m[2]}に強制交代`, charName: m[2], side, charIndex: Number(m[3]) - 1, duration: 1250 });
  }
  if ((m = line.match(/^P(\d)のアクターが(.+)に強制交代$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'actor', text: `${side === 1 ? '相手の' : ''}アクターは${m[2]}に強制交代`, charName: m[2], side, charIndex: charOnSide(state, side, m[2]), duration: 1250 });
  }
  if ((m = line.match(/^プレイヤー(\d)のアクターが(.+)（(\d)番手）に交代$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'actor', text: side === 0 ? `アクターが${m[2]}に交代` : `相手のアクターが${m[2]}に交代`, side, charName: m[2], charIndex: Number(m[3]) - 1, duration: 1125 });
  }
  if ((m = line.match(/^プレイヤー(\d)のアクターが(.+)に交代$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    const hit = findChar(state, m[2], side);
    return ev({ kind: 'actor', text: side === 0 ? `アクターが${m[2]}に交代` : `相手のアクターが${m[2]}に交代`, side, charName: m[2], charIndex: hit?.[1], duration: 1125 });
  }
  if ((m = line.match(/^P(\d)のアクターが(.+)（(\d)番手）に変更$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'actor', text: side === 1 ? `相手のアクターが${m[2]}に変更された！` : `アクターが${m[2]}に変更された！`, charName: m[2], side, charIndex: Number(m[3]) - 1, duration: 1125 });
  }
  if ((m = line.match(/^相手のアクターが(.+)に変更$/))) {
    const hit = findChar(state, m[1], (1 - actor) as 0 | 1);
    return ev({ kind: 'actor', text: `相手のアクターが${m[1]}に変更された！`, charName: m[1], side: hit?.[0], charIndex: hit?.[1], duration: 1125 });
  }
  if ((m = line.match(/^発動:(.+)$/))) {
    return ev({ kind: 'ability', text: `${m[1]}！`, duration: 1000 });
  }
  if ((m = line.match(/^P(\d)の(.+)に(.+)を装備$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    const card = CARD_BY_NAME.get(m[3]);
    return ev({ kind: 'equip', text: `${sideName(side, m[2])}に「${m[3]}」を装備`, card, charName: m[2], side, charIndex: charOnSide(state, side, m[2]), duration: 1500 });
  }
  if ((m = line.match(/^P(\d)の(.+)の(.+)を外してトラッシュ$/))) {
    return ev({ kind: 'info', text: `${m[2]}の「${m[3]}」は外れた`, duration: 1050 });
  }
  if ((m = line.match(/^P(\d)の(.+)の装備(.+)を破壊$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'equip', text: `${sideName(side, m[2])}の装備「${m[3]}」を破壊！`, duration: 1275 });
  }
  if ((m = line.match(/^フィールド(.+)を展開$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'field', text: `フィールド「${m[1]}」を展開！`, card, side: actor, duration: 1500 });
  }
  if ((m = line.match(/^(.+)は上書きされてトラッシュへ$/))) {
    return ev({ kind: 'info', text: `「${m[1]}」は上書きされた`, duration: 1050 });
  }
  if ((m = line.match(/^プレイヤー(\d)が(.+)をチャージ（AP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'charge', text: side === 0 ? `「${m[2]}」をチャージ（AP ${m[3]}）` : `相手がチャージ（AP ${m[3]}）`, side, cardName: m[2], duration: 550 });
  }
  if ((m = line.match(/^後攻のP(\d)はデッキから(\d+)枚チャージ（AP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'chargeDeck', text: side === 0 ? `後攻ボーナス！デッキから${m[2]}枚チャージ` : `相手は後攻ボーナスで${m[2]}枚チャージ`, side, amount: Number(m[2]), duration: 1100 });
  }
  if ((m = line.match(/^P(\d)はデッキから(\d+)枚チャージ（AP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'chargeDeck', text: side === 0 ? `デッキから${m[2]}枚チャージ（AP ${m[3]}）` : `相手がデッキから${m[2]}枚チャージ`, side, amount: Number(m[2]), duration: 850 });
  }
  if ((m = line.match(/^デッキから(\d+)枚チャージ（AP: (\d+)）$/))) {
    return ev({ kind: 'chargeDeck', text: `デッキから${m[1]}枚チャージ（AP ${m[2]}）`, amount: Number(m[1]), duration: 850 });
  }
  if ((m = line.match(/^P(\d)はトラッシュから(\d+)枚チャージ（AP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'chargeTrash', text: side === 0 ? `トラッシュから${m[2]}枚チャージ！` : `相手がトラッシュから${m[2]}枚チャージ`, side, amount: Number(m[2]), duration: 850 });
  }
  if ((m = line.match(/^P(\d)は手札を全てチャージ（(\d+)枚）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'chargeAll', text: side === 0 ? `手札を全てチャージ（${m[2]}枚）！` : `相手が手札を全てチャージ`, side, amount: Number(m[2]), duration: 900 });
  }
  if ((m = line.match(/^P(\d)は手札を全てトラッシュ（(\d+)枚）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'handTrash', text: side === 0 ? `手札を全てトラッシュ（${m[2]}枚）` : `相手が手札を全てトラッシュ`, side, amount: Number(m[2]), duration: 900 });
  }
  if ((m = line.match(/^P(\d)のデッキから(\d+)枚トラッシュ$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'mill', text: side === 0 ? `自分のデッキから${m[2]}枚トラッシュ` : `相手のデッキから${m[2]}枚トラッシュ！`, side, amount: Number(m[2]), duration: 850 });
  }
  if ((m = line.match(/^デッキから(\d+)枚トラッシュ$/))) {
    return ev({ kind: 'mill', text: `デッキから${m[1]}枚トラッシュ`, amount: Number(m[1]), duration: 850 });
  }
  if ((m = line.match(/^P(\d)のAPから(\d+)枚トラッシュ$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'apTrash', text: side === 0 ? `APから${m[2]}枚トラッシュ！` : `相手のAPから${m[2]}枚トラッシュ！`, side, amount: Number(m[2]), duration: 900 });
  }
  if ((m = line.match(/^P(\d)の(.+)に(.)属性を追加$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'attr', text: `${sideName(side, m[2])}に${m[3]}属性を追加`, charName: m[2], attr: m[3], side, charIndex: charOnSide(state, side, m[2]), duration: 1250 });
  }
  if ((m = line.match(/^デッキから(.+)を手札に加えた$/))) {
    return ev({ kind: 'search', text: `デッキから「${m[1]}」を手札に！`, duration: 1275 });
  }
  if ((m = line.match(/^P(\d)のアクターをロック（ターン(\d+)終了まで）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({
      kind: 'lock',
      text: side === 0 ? '自分のアクターをロック（交代できない）' : '相手のアクターをロック！（交代できない）',
      side, charIndex: state.players[side].actorIndex, amount: Number(m[2]), duration: 1275,
    });
  }
  if ((m = line.match(/^P(\d)のアクターのロックを解除$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'unlock', text: side === 0 ? 'ロック解除！' : '相手のロックが解除された', side, charIndex: state.players[side].actorIndex, duration: 900 });
  }
  if (line.includes('アクターをロック')) {
    const targetSide = (1 - actor) as 0 | 1;
    return ev({ kind: 'lock', text: 'アクターをロック！（交代できない）', side: targetSide, charIndex: state.players[targetSide].actorIndex, duration: 1275 });
  }
  if (line.includes('ロックされていて変更できない')) {
    return ev({ kind: 'lock', text: 'ロック中で交代できない！', duration: 1125 });
  }
  if ((m = line.match(/^P(\d)の(.+)は控えのためダメージを受けない$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'info', text: `${sideName(side, m[2])}は控えのため無傷！`, duration: 1200 });
  }
  if ((m = line.match(/^プレイヤー(\d)は山札切れで/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'info', text: side === 0 ? '山札切れ！手札を5枚にできない…' : '相手が山札切れ！', duration: 1500 });
  }
  if ((m = line.match(/^プレイヤー(\d)の勝ち/))) {
    return ev({ kind: 'end', text: 'バトル終了！', duration: 1200 });
  }
  if (line.startsWith('決着つかず')) {
    return ev({ kind: 'end', text: '引き分け…', duration: 1200 });
  }
  if ((m = line.match(/^バトル開始。先攻: プレイヤー(\d)$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'coin', text: side === 0 ? '先攻はあなた！' : '先攻は相手！', side, duration: 2200 });
  }

  // 未知のログはそのまま情報として出す
  return ev({ kind: 'info', text: line, duration: 1050 });
}
