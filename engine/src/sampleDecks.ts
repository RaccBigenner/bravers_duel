/**
 * アーキタイプ別のサンプルデッキ（バランス測定用）。
 * 「人間が組みそうな、属性シナジーを揃えたデッキ」を8パターン用意する。
 * 構成は決定的（ランダム無し）なので、テスト・シミュレーションの再現ができる。
 */
import { ALL_CARDS, cardById } from './cards';
import { containsAll, deckProblems, DEFAULT_DECK_RULES, type DeckList, type DeckRules } from './decks';
import {
  DECK_SIZE,
  MAX_COPIES_PER_CARD,
  type Attribute,
  type CharacterCard,
  type SkillCard,
} from './types';

export interface NamedDeck {
  name: string;
  concept: string;
  deck: DeckList;
}

interface ArchetypeSpec {
  name: string;
  concept: string;
  characterIds: string[]; // 枠3つぶん（大型は2枠）
  preferAttrs: Attribute[];
  /** 種類ごとの目安枚数（キャラカード6枚を除いた34枚の内訳） */
  quota?: { attack: number; guard: number; support: number; heal: number };
  /** アーキタイプの「顔」になるコアカード（最優先でピン留め） */
  core?: [string, number][];
}

// キャラカード6枚 + 装備2枚 + フィールド1枚 + スキル41枚 = 50枚
const DEFAULT_QUOTA = { attack: 23, guard: 8, support: 7, heal: 3 };
const EQUIPMENT_COUNT = 2;
const FIELD_COUNT = 1;

const SPECS: ArchetypeSpec[] = [
  {
    name: '闇単アグロ',
    concept: 'トランザードの闇5属性で重い闇スキルを叩き込む',
    characterIds: ['1-A004-USR', '1-A009-SR', '1-A006-USR'],
    preferAttrs: ['闇'],
    core: [['1-A038-USR', 3]], // カオスフレア: 闇5属性でAoE+5の切り札
  },
  {
    name: '斬の勇者',
    concept: 'クラウディアとレオンの斬・聖で素直に殴る',
    characterIds: ['1-A003-USR', '1-A007-SSR', '1-A005-USR'],
    preferAttrs: ['斬', '聖', '雷'],
    core: [['1-A059-R', 4]], // 大裂斬: 斬×2の主砲
  },
  {
    name: '氷結コントロール',
    concept: 'セレーナの氷付与とロック・ガードで守り勝つ',
    characterIds: ['1-A008-SSR', '1-A018-R', '1-A013-SR'],
    preferAttrs: ['氷', '守'],
    quota: { attack: 16, guard: 13, support: 9, heal: 3 },
    core: [['1-A066-R', 4], ['1-A069-R', 3]], // 氷強化ガード + ロック攻撃
  },
  {
    name: '竜の猛攻',
    concept: 'ジエンドの竜3属性で大技を最速で撃つ',
    characterIds: ['1-A002-LSR', '1-A020-R'], // ジエンドは大型で2枠
    preferAttrs: ['竜', '闇', '打'],
    quota: { attack: 24, guard: 5, support: 10, heal: 2 },
    core: [['1-A042-SR', 3], ['1-A102-UC', 4]], // ドラゴンズメテオ + 全力補給（加速）
  },
  {
    name: '聖光の癒し',
    concept: 'ハスミールの聖3属性で回復しながら粘り勝つ',
    characterIds: ['1-A019-R', '1-A023-R', '1-A010-SR'],
    preferAttrs: ['聖', '木'],
    quota: { attack: 17, guard: 8, support: 8, heal: 8 },
    core: [['1-A049-SR', 3], ['1-A040-USR', 2]], // 聖なる風（全体回復） + ティアグレイス（復活）
  },
  {
    name: '獣と風',
    concept: 'アイのドロー強化と獣・飛のすばやい攻めで手数を出す',
    characterIds: ['1-A001-LSR', '1-A022-R'], // アイは大型で2枠
    preferAttrs: ['獣', '風', '飛', '射'],
    core: [['1-A136-C', 3]], // ジェット飛行: 飛び出して手札補充
  },
  {
    name: '突撃槍衾',
    concept: 'ストミーの突2属性で突スキルのスケーリングを活かす',
    characterIds: ['1-A011-SR', '1-A005-USR', '1-A020-R'],
    preferAttrs: ['突', '打'],
    core: [['1-A044-SR', 3], ['1-A120-C', 4]], // サウザンドスパイク + コンボスタブ
  },
  {
    name: '雷土の重撃',
    concept: 'ビコウの控え無敵とドッソの高HPで受けつつ重い一撃',
    characterIds: ['1-A021-R', '1-A017-R', '1-A015-SR'],
    preferAttrs: ['雷', '土', '打', '守'],
    quota: { attack: 18, guard: 11, support: 9, heal: 3 },
    core: [['1-A057-R', 4]], // 打スケール攻撃+チャージ回収
  },
];

function buildDeck(spec: ArchetypeSpec, rules: DeckRules): DeckList {
  const chars = spec.characterIds.map((id) => cardById(id) as CharacterCard);
  const skills = ALL_CARDS.filter((c): c is SkillCard => c.type === 'skill');
  const quota = spec.quota ?? DEFAULT_QUOTA;

  const usable = skills.filter((s) => chars.some((ch) => containsAll(ch.attribute, s.conditionAttribute)));

  // 好み属性との一致度 → コスト効率 の順で採点
  const score = (s: SkillCard): number => {
    const attrFit = s.conditionAttribute.filter((a) => spec.preferAttrs.includes(a)).length;
    const efficiency = s.valueType === 'attack' ? s.baseValue / (s.costAp + 1) : 1 / (s.costAp + 1);
    const hasEffect = s.effectText !== '' ? 0.5 : 0;
    return attrFit * 10 + efficiency + hasEffect;
  };

  // 「回るデッキ」のためのコストカーブ配分（attack枠の内訳）
  // 低コスト(0-1)で序盤を動かし、中コスト(2-3)を主軸に、高コスト(4+)は切り札だけ
  const curveShare = { low: 0.3, mid: 0.45, high: 0.25 };
  const costBand = (s: SkillCard) => (s.costAp <= 1 ? 'low' : s.costAp <= 3 ? 'mid' : 'high');

  const cardIds: string[] = [];
  const counts = new Map<string, number>();
  const add = (id: string, copies: number): number => {
    let added = 0;
    for (let i = 0; i < copies; i++) {
      const n = counts.get(id) ?? 0;
      if (n >= rules.maxCopies || cardIds.length >= rules.deckSize) break;
      counts.set(id, n + 1);
      cardIds.push(id);
      added++;
    }
    return added;
  };

  // 1. キャラクターカード2枚ずつ（回復札）
  for (const ch of chars) add(ch.id, 2);

  // 1.2 アーキタイプのコアカードを最優先でピン留め
  for (const [id, copies] of spec.core ?? []) add(id, copies);

  // 1.5 装備2枚（好み属性に合うもの）とフィールド1枚
  const equips = ALL_CARDS.filter((c) => c.type === 'equipment')
    .sort((a, b) => {
      const fit = (e: typeof a) =>
        e.type === 'equipment' ? e.addAttribute.filter((x) => spec.preferAttrs.includes(x)).length : 0;
      return fit(b) - fit(a);
    });
  let equipTaken = 0;
  for (const e of equips) {
    if (equipTaken >= EQUIPMENT_COUNT) break;
    equipTaken += add(e.id, 1);
  }
  const fields = ALL_CARDS.filter((c) => c.type === 'field').sort((a, b) => {
    const fit = (f: typeof a) => {
      if (f.id === '1-A035-R' && spec.preferAttrs.includes('斬')) return 10; // 剣の墓場
      if (f.id === '1-A036-R') return 5; // 激闘（汎用）
      return 1;
    };
    return fit(b) - fit(a);
  });
  let fieldTaken = 0;
  for (const f of fields) {
    if (fieldTaken >= FIELD_COUNT) break;
    fieldTaken += add(f.id, 1);
  }

  // 2. 種類ごとに、点数の高い順に取る。attackはコストカーブを守って序盤〜終盤が回るように
  for (const [type, want] of Object.entries(quota) as [SkillCard['valueType'], number][]) {
    const pool = usable.filter((s) => s.valueType === type).sort((a, b) => score(b) - score(a));
    if (type === 'attack') {
      const bandWant: Record<string, number> = {
        low: Math.round(want * curveShare.low),
        mid: Math.round(want * curveShare.mid),
        high: 0,
      };
      bandWant.high = Math.max(0, want - bandWant.low - bandWant.mid);
      const bandTaken: Record<string, number> = { low: 0, mid: 0, high: 0 };
      let taken = 0;
      // 1周目: バンドの枠内で取る
      for (const s of pool) {
        if (taken >= want) break;
        const band = costBand(s);
        if (bandTaken[band] >= bandWant[band]) continue;
        const got = add(s.id, Math.min(rules.maxCopies, want - taken, bandWant[band] - bandTaken[band]));
        bandTaken[band] += got;
        taken += got;
      }
      // 2周目: 枠が余ったら低コスト優先で埋める（重さで詰まらないように）
      if (taken < want) {
        for (const s of [...pool].sort((a, b) => a.costAp - b.costAp)) {
          if (taken >= want) break;
          taken += add(s.id, Math.min(rules.maxCopies, want - taken));
        }
      }
    } else {
      // guard/support/heal は軽いカードを優先（重いguardは腐りやすい）
      const sorted = [...pool].sort((a, b) => score(b) - score(a) + (a.costAp - b.costAp) * 1.5);
      let taken = 0;
      for (const s of sorted) {
        if (taken >= want) break;
        taken += add(s.id, Math.min(rules.maxCopies, want - taken));
      }
    }
  }

  // 3. 足りなければ使えるスキルから、それでも足りなければ全スキルから補充
  const fillFrom = (pool: SkillCard[]) => {
    for (const s of pool.sort((a, b) => score(b) - score(a))) {
      if (cardIds.length >= rules.deckSize) break;
      add(s.id, rules.maxCopies);
    }
  };
  fillFrom([...usable]);
  fillFrom([...skills]);

  return { characterIds: spec.characterIds.slice(), cardIds };
}

let cache: NamedDeck[] | null = null;

/** アーキタイプ別サンプルデッキ（8種、すべてルール検証済み）。rules指定で実験用構築もできる */
export function sampleArchetypeDecks(rules: DeckRules = DEFAULT_DECK_RULES): NamedDeck[] {
  const isDefault = rules.deckSize === DEFAULT_DECK_RULES.deckSize && rules.maxCopies === DEFAULT_DECK_RULES.maxCopies;
  if (isDefault && cache) return cache;
  const decks = SPECS.map((spec) => {
    const deck = buildDeck(spec, rules);
    const problems = deckProblems(deck, rules);
    if (problems.length > 0) {
      throw new Error(`サンプルデッキ「${spec.name}」が不正: ${problems.join(' / ')}`);
    }
    return { name: spec.name, concept: spec.concept, deck };
  });
  if (isDefault) cache = decks;
  return decks;
}
