/**
 * デッキの型・検証・サンプルデッキ生成。
 * ルール: docs/GAME_RULES.md 4章（キャラ3枚まで・カード40枚・同名3枚まで）
 */
import { ALL_CARDS, cardById } from './cards';
import { mulberry32, pickOne, shuffled, type Rng } from './rng';
import {
  DECK_SIZE,
  MAX_CHARACTERS,
  MAX_COPIES_PER_CARD,
  type CharacterCard,
  type SkillCard,
} from './types';

export interface DeckList {
  characterIds: string[];
  cardIds: string[];
}

/** デッキがルールに合っているか調べて、問題の一覧を返す（空なら合格） */
export function deckProblems(deck: DeckList): string[] {
  const problems: string[] = [];

  if (deck.characterIds.length < 1 || deck.characterIds.length > MAX_CHARACTERS) {
    problems.push(`キャラクターは1〜${MAX_CHARACTERS}枚（今: ${deck.characterIds.length}枚）`);
  }
  if (deck.cardIds.length !== DECK_SIZE) {
    problems.push(`デッキは${DECK_SIZE}枚（今: ${deck.cardIds.length}枚）`);
  }

  for (const id of [...deck.characterIds, ...deck.cardIds]) {
    try {
      cardById(id);
    } catch {
      problems.push(`存在しないカード: ${id}`);
    }
  }

  for (const id of deck.characterIds) {
    try {
      if (cardById(id).type !== 'character') {
        problems.push(`キャラクター枠にキャラクター以外のカード: ${id}`);
      }
    } catch {
      /* 上で報告済み */
    }
  }

  const counts = new Map<string, number>();
  for (const id of deck.cardIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > MAX_COPIES_PER_CARD) {
      problems.push(`同名カードは${MAX_COPIES_PER_CARD}枚まで: ${id} が${n}枚`);
    }
  }

  return problems;
}

/**
 * サンプルデッキを自動で作る（シミュレーター・テスト用）。
 * キャラ3枚をランダムに選び、そのキャラが使えるスキルを中心に40枚そろえる。
 */
export function sampleDeck(seed: number): DeckList {
  const rng: Rng = mulberry32(seed);
  const characters = ALL_CARDS.filter((c): c is CharacterCard => c.type === 'character');
  const skills = ALL_CARDS.filter((c): c is SkillCard => c.type === 'skill');

  // 1. キャラクター3枚（重複なし）
  const chosen: CharacterCard[] = [];
  const pool = shuffled(characters, rng);
  for (const c of pool) {
    if (chosen.length >= MAX_CHARACTERS) break;
    chosen.push(c);
  }

  // 2. 選んだキャラの誰かが条件を満たせるスキルを候補にする
  const canUse = (skill: SkillCard) =>
    chosen.some((ch) => containsAll(ch.attribute, skill.conditionAttribute));
  const usable = skills.filter(canUse);

  // 3. デッキを組む: キャラカード2枚ずつ（回復要員）＋使えるスキル
  const cardIds: string[] = [];
  const counts = new Map<string, number>();
  const add = (id: string): boolean => {
    const n = counts.get(id) ?? 0;
    if (n >= MAX_COPIES_PER_CARD || cardIds.length >= DECK_SIZE) return false;
    counts.set(id, n + 1);
    cardIds.push(id);
    return true;
  };

  for (const ch of chosen) {
    add(ch.id);
    add(ch.id);
  }
  const skillPool = usable.length > 0 ? usable : skills;
  let guard = 0;
  while (cardIds.length < DECK_SIZE && guard < 10000) {
    add(pickOne(skillPool, rng).id);
    guard++;
  }
  // 候補が少なくて40枚に届かない時は全スキルから足す
  while (cardIds.length < DECK_SIZE) {
    if (!add(pickOne(skills, rng).id)) guard++;
    if (guard > 20000) throw new Error('サンプルデッキを40枚にできませんでした');
  }

  return { characterIds: chosen.map((c) => c.id), cardIds };
}

/** base に condition の属性が全部（同じ属性は個数分）含まれているか */
export function containsAll(base: readonly string[], condition: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const a of base) counts.set(a, (counts.get(a) ?? 0) + 1);
  for (const a of condition) {
    const left = (counts.get(a) ?? 0) - 1;
    if (left < 0) return false;
    counts.set(a, left);
  }
  return true;
}
