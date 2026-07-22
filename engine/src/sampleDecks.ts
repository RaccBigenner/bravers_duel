/**
 * アーキタイプ別のサンプルデッキ（バランス測定用）。
 * 「人間が組みそうな、属性シナジーを揃えたデッキ」を8パターン用意する。
 * 構成は決定的（ランダム無し）なので、テスト・シミュレーションの再現ができる。
 */
import { ALL_CARDS, cardById } from './cards';
import { containsAll, deckProblems, type DeckList } from './decks';
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
  characterIds: [string, string, string];
  preferAttrs: Attribute[];
  /** 種類ごとの目安枚数（キャラカード6枚を除いた34枚の内訳） */
  quota?: { attack: number; guard: number; support: number; heal: number };
}

// キャラカード6枚 + 装備2枚 + フィールド1枚 + スキル31枚 = 40枚
const DEFAULT_QUOTA = { attack: 16, guard: 6, support: 6, heal: 3 };
const EQUIPMENT_COUNT = 2;
const FIELD_COUNT = 1;

const SPECS: ArchetypeSpec[] = [
  {
    name: '闇単アグロ',
    concept: 'トランザードの闇5属性で重い闇スキルを叩き込む',
    characterIds: ['1-A004-USR', '1-A009-SR', '1-A006-USR'],
    preferAttrs: ['闇'],
  },
  {
    name: '斬の勇者',
    concept: 'クラウディアとレオンの斬・聖で素直に殴る',
    characterIds: ['1-A003-USR', '1-A007-SSR', '1-A005-USR'],
    preferAttrs: ['斬', '聖', '雷'],
  },
  {
    name: '氷結コントロール',
    concept: 'セレーナの氷付与とロック・ガードで守り勝つ',
    characterIds: ['1-A008-SSR', '1-A018-R', '1-A013-SR'],
    preferAttrs: ['氷', '守'],
    quota: { attack: 11, guard: 10, support: 7, heal: 3 },
  },
  {
    name: '竜の猛攻',
    concept: 'ジエンドの竜3属性で大技を最速で撃つ',
    characterIds: ['1-A002-LSR', '1-A020-R', '1-A014-SR'],
    preferAttrs: ['竜', '闇', '打'],
    quota: { attack: 17, guard: 4, support: 8, heal: 2 },
  },
  {
    name: '聖光の癒し',
    concept: 'ハスミールの聖3属性で回復しながら粘り勝つ',
    characterIds: ['1-A019-R', '1-A023-R', '1-A010-SR'],
    preferAttrs: ['聖', '木'],
    quota: { attack: 12, guard: 6, support: 6, heal: 7 },
  },
  {
    name: '獣と風',
    concept: 'アイのドロー強化と獣・飛のすばやい攻めで手数を出す',
    characterIds: ['1-A022-R', '1-A006-USR', '1-A001-LSR'],
    preferAttrs: ['獣', '風', '飛', '射'],
  },
  {
    name: '突撃槍衾',
    concept: 'ストミーの突2属性で突スキルのスケーリングを活かす',
    characterIds: ['1-A011-SR', '1-A005-USR', '1-A020-R'],
    preferAttrs: ['突', '打'],
  },
  {
    name: '雷土の重撃',
    concept: 'ビコウの控え無敵とドッソの高HPで受けつつ重い一撃',
    characterIds: ['1-A021-R', '1-A017-R', '1-A015-SR'],
    preferAttrs: ['雷', '土', '打', '守'],
    quota: { attack: 13, guard: 8, support: 7, heal: 3 },
  },
];

function buildDeck(spec: ArchetypeSpec): DeckList {
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

  const cardIds: string[] = [];
  const counts = new Map<string, number>();
  const add = (id: string, copies: number): number => {
    let added = 0;
    for (let i = 0; i < copies; i++) {
      const n = counts.get(id) ?? 0;
      if (n >= MAX_COPIES_PER_CARD || cardIds.length >= DECK_SIZE) break;
      counts.set(id, n + 1);
      cardIds.push(id);
      added++;
    }
    return added;
  };

  // 1. キャラクターカード2枚ずつ（回復札）
  for (const ch of chars) add(ch.id, 2);

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

  // 2. 種類ごとに、点数の高い順に3枚ずつ
  for (const [type, want] of Object.entries(quota) as [SkillCard['valueType'], number][]) {
    const pool = usable.filter((s) => s.valueType === type).sort((a, b) => score(b) - score(a));
    let taken = 0;
    for (const s of pool) {
      if (taken >= want) break;
      taken += add(s.id, Math.min(3, want - taken));
    }
  }

  // 3. 足りなければ使えるスキルから、それでも足りなければ全スキルから補充
  const fillFrom = (pool: SkillCard[]) => {
    for (const s of pool.sort((a, b) => score(b) - score(a))) {
      if (cardIds.length >= DECK_SIZE) break;
      add(s.id, 3);
    }
  };
  fillFrom([...usable]);
  fillFrom([...skills]);

  return { characterIds: spec.characterIds.slice(), cardIds };
}

let cache: NamedDeck[] | null = null;

/** アーキタイプ別サンプルデッキ（8種、すべてルール検証済み） */
export function sampleArchetypeDecks(): NamedDeck[] {
  if (cache) return cache;
  cache = SPECS.map((spec) => {
    const deck = buildDeck(spec);
    const problems = deckProblems(deck);
    if (problems.length > 0) {
      throw new Error(`サンプルデッキ「${spec.name}」が不正: ${problems.join(' / ')}`);
    }
    return { name: spec.name, concept: spec.concept, deck };
  });
  return cache;
}
