/**
 * エンジンのログ1行を「演出イベント」に変換するナレーター。
 * バトル画面はこのイベント列を1件ずつ順番に再生する。
 */
import { ALL_CARDS, type BattleState, type Card } from '@bravers/engine';

export type FxKind =
  | 'turn' | 'draw' | 'charge' | 'chargeDeck' | 'mill' | 'play' | 'guard'
  | 'attack' | 'damage' | 'heal' | 'ko' | 'revive' | 'actor' | 'ability'
  | 'equip' | 'field' | 'attr' | 'search' | 'lock' | 'end' | 'info';

export interface NarrEvent {
  key: number;
  kind: FxKind;
  text: string;
  card?: Card; // カットインで見せるカード
  side?: 0 | 1; // 対象キャラの側
  charIndex?: number;
  amount?: number;
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
    return ev({ kind: 'turn', text: side === 0 ? `ターン${m[1]} あなたの番！` : `ターン${m[1]} 相手の番`, side, duration: 900 });
  }
  if ((m = line.match(/^プレイヤー(\d)が(\d+)枚ドロー$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'draw', text: side === 0 ? `${m[2]}枚ドロー！` : `相手が${m[2]}枚ドロー`, side, amount: Number(m[2]), duration: 700 });
  }
  if ((m = line.match(/^(.+)が(.+)を使用$/))) {
    const card = CARD_BY_NAME.get(m[2]);
    const who = findChar(state, m[1], actor);
    return ev({ kind: 'play', text: `${m[1]}の「${m[2]}」！`, card, side: who?.[0] ?? actor, duration: 1250 });
  }
  if ((m = line.match(/^(.+)のカードを使用$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'play', text: `「${m[1]}」で同名キャラを回復！`, card, side: actor, duration: 1150 });
  }
  if ((m = line.match(/^デッキから(.+)をコストなしで使用$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'play', text: `デッキから「${m[1]}」が発動！`, card, side: actor, duration: 1250 });
  }
  if ((m = line.match(/^(.+)で割り込み（(.+)）$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'guard', text: `ガード！「${m[1]}」（${m[2]}）`, card, duration: 1150 });
  }
  if ((m = line.match(/^(.+)で攻撃 → 相手は割り込みできる（ダメージ(\d+)）$/))) {
    return ev({ kind: 'attack', text: `「${m[1]}」の攻撃！（ダメージ${m[2]}）`, amount: Number(m[2]), duration: 850 });
  }
  if ((m = line.match(/^(.+)は防御で割り込めない攻撃$/))) {
    return ev({ kind: 'attack', text: `「${m[1]}」はガード不可の攻撃！`, duration: 800 });
  }
  if ((m = line.match(/^(.+)に(\d+)ダメージ（残りHP: (\d+)）$/))) {
    const hit = findChar(state, m[1], (1 - actor) as 0 | 1);
    return ev({
      kind: 'damage',
      text: `${m[1]}に${m[2]}ダメージ！`,
      side: hit?.[0], charIndex: hit?.[1], amount: Number(m[2]), duration: 750,
    });
  }
  if ((m = line.match(/^(.+)を(\d+)回復$/))) {
    const hit = findChar(state, m[1], actor);
    return ev({ kind: 'heal', text: `${m[1]}が${m[2]}回復`, side: hit?.[0], charIndex: hit?.[1], amount: Number(m[2]), duration: 750 });
  }
  if ((m = line.match(/^(.+)は戦闘不能$/))) {
    const hit = findChar(state, m[1], (1 - actor) as 0 | 1);
    return ev({ kind: 'ko', text: `${m[1]}は戦闘不能！`, side: hit?.[0], charIndex: hit?.[1], duration: 950 });
  }
  if ((m = line.match(/^(.+)が復活（HP(\d+)）$/))) {
    const hit = findChar(state, m[1], actor);
    return ev({ kind: 'revive', text: `${m[1]}が復活！`, side: hit?.[0], charIndex: hit?.[1], duration: 950 });
  }
  if ((m = line.match(/^アクターが(.+)に強制交代$/))) {
    return ev({ kind: 'actor', text: `アクターは${m[1]}に強制交代`, duration: 750 });
  }
  if ((m = line.match(/^プレイヤー(\d)のアクターが(.+)に交代$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'actor', text: side === 0 ? `アクターが${m[2]}に交代` : `相手のアクターが${m[2]}に交代`, side, duration: 750 });
  }
  if ((m = line.match(/^相手のアクターが(.+)に変更$/))) {
    return ev({ kind: 'actor', text: `相手のアクターが${m[1]}に変更された！`, duration: 750 });
  }
  if ((m = line.match(/^発動:(.+)$/))) {
    return ev({ kind: 'ability', text: `${m[1]}！`, duration: 800 });
  }
  if ((m = line.match(/^(.+)に(.+)を装備$/))) {
    const card = CARD_BY_NAME.get(m[2]);
    return ev({ kind: 'equip', text: `${m[1]}に「${m[2]}」を装備`, card, duration: 1000 });
  }
  if ((m = line.match(/^(.+)の(.+)を外してトラッシュ$/))) {
    return ev({ kind: 'info', text: `${m[1]}の「${m[2]}」は外れた`, duration: 700 });
  }
  if ((m = line.match(/^(.+)の装備(.+)を破壊$/))) {
    return ev({ kind: 'equip', text: `${m[1]}の装備「${m[2]}」を破壊！`, duration: 850 });
  }
  if ((m = line.match(/^フィールド(.+)を展開$/))) {
    const card = CARD_BY_NAME.get(m[1]);
    return ev({ kind: 'field', text: `フィールド「${m[1]}」を展開！`, card, duration: 1150 });
  }
  if ((m = line.match(/^(.+)は上書きされてトラッシュへ$/))) {
    return ev({ kind: 'info', text: `「${m[1]}」は上書きされた`, duration: 700 });
  }
  if ((m = line.match(/^プレイヤー(\d)が(.+)をチャージ（AP: (\d+)）$/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'charge', text: side === 0 ? `「${m[2]}」をチャージ（AP ${m[3]}）` : `相手がチャージ（AP ${m[3]}）`, side, duration: 550 });
  }
  if ((m = line.match(/^デッキから(\d+)枚チャージ（AP: (\d+)）$/))) {
    return ev({ kind: 'chargeDeck', text: `デッキから${m[1]}枚チャージ（AP ${m[2]}）`, amount: Number(m[1]), duration: 750 });
  }
  if ((m = line.match(/^デッキから(\d+)枚トラッシュ$/))) {
    return ev({ kind: 'mill', text: `デッキから${m[1]}枚トラッシュ`, amount: Number(m[1]), duration: 750 });
  }
  if ((m = line.match(/^(.+)に(.)属性を追加$/))) {
    return ev({ kind: 'attr', text: `${m[1]}に${m[2]}属性を追加`, duration: 750 });
  }
  if ((m = line.match(/^デッキから(.+)を手札に加えた$/))) {
    return ev({ kind: 'search', text: `デッキから「${m[1]}」を手札に！`, duration: 850 });
  }
  if (line.includes('アクターをロック')) {
    return ev({ kind: 'lock', text: 'アクターをロック！（交代できない）', duration: 850 });
  }
  if (line.includes('ロックされていて変更できない')) {
    return ev({ kind: 'lock', text: 'ロック中で交代できない！', duration: 750 });
  }
  if (line.includes('控えのためダメージを受けない')) {
    return ev({ kind: 'info', text: line, duration: 800 });
  }
  if ((m = line.match(/^プレイヤー(\d)は山札切れで/))) {
    const side = (Number(m[1]) - 1) as 0 | 1;
    return ev({ kind: 'info', text: side === 0 ? '山札切れ！手札を5枚にできない…' : '相手が山札切れ！', duration: 1000 });
  }
  if ((m = line.match(/^プレイヤー(\d)の勝ち/))) {
    return ev({ kind: 'end', text: 'バトル終了！', duration: 800 });
  }
  if (line.startsWith('決着つかず')) {
    return ev({ kind: 'end', text: '引き分け…', duration: 800 });
  }
  if (line.startsWith('バトル開始')) return null;

  // 未知のログはそのまま情報として出す
  return ev({ kind: 'info', text: line, duration: 700 });
}
