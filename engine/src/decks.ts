/**
 * デッキの型・検証・サンプルデッキ生成。
 * ルール: docs/GAME_RULES.md 4章
 * （キャラ3枠ちょうど・カード40枚・40枚側は同名4枚まで）
 */
import { ALL_CARDS, PUBLIC_CARD_CATALOG, type CardCatalog } from './cards';
import { checkDeckLegality } from './deckLegality';
import { DEFAULT_FORMAT, type FormatDefinition } from './formats';
import { mulberry32, pickOne, shuffled, type Rng } from './rng';
import {
  DECK_SIZE,
  MAX_CHARACTERS,
  MAX_COPIES_PER_CARD,
  type CharacterCard,
  type SkillCard,
} from './types';

export interface DeckList {
  /** 収録・絵柄を保持するprinting ID。合法性の同名集計だけoracleIdで行う。 */
  characterIds: string[];
  /** 収録・絵柄を保持するprinting ID。 */
  cardIds: string[];
}

/** デッキ構築ルール（実験用に変えられる。既定は公式ルール） */
export interface DeckRules {
  deckSize: number;
  maxCopies: number;
}

export const DEFAULT_DECK_RULES: DeckRules = {
  deckSize: DECK_SIZE,
  maxCopies: MAX_COPIES_PER_CARD,
};

/**
 * 実験用のデッキ枚数ルールを、既定フォーマット（FREE_V1）へ上書きした一時的なフォーマットにする。
 * シミュレーターが `--deckSize` / `--maxCopies` を変えて回すためだけの入口で、
 * 保存済みフォーマットの版を書き換えるものではない。
 */
export function formatForDeckRules(rules: DeckRules = DEFAULT_DECK_RULES): FormatDefinition {
  if (rules.deckSize === DEFAULT_FORMAT.deckSize && rules.maxCopies === DEFAULT_FORMAT.maxCopies) {
    return DEFAULT_FORMAT;
  }
  return { ...DEFAULT_FORMAT, deckSize: rules.deckSize, maxCopies: rules.maxCopies };
}

/**
 * デッキがルールに合っているか調べて、問題の一覧を返す（空なら合格）。
 * 判定本体は `checkDeckLegality`（deckLegality.ts）。ここは文字列だけ欲しい呼び出し向けの薄い皮。
 */
export function deckProblems(
  deck: DeckList,
  rules: DeckRules = DEFAULT_DECK_RULES,
  catalog: CardCatalog = PUBLIC_CARD_CATALOG,
): string[] {
  return checkDeckLegality(deck, formatForDeckRules(rules), catalog).violations.map(
    (v) => v.message,
  );
}

/**
 * サンプルデッキを自動で作る（シミュレーター・テスト用）。
 * キャラ3枚をランダムに選び、そのキャラが使えるスキルを中心に40枚そろえる。
 */
export function sampleDeck(seed: number): DeckList {
  const rng: Rng = mulberry32(seed);
  const characters = ALL_CARDS.filter((c): c is CharacterCard => c.type === 'character');
  const skills = ALL_CARDS.filter((c): c is SkillCard => c.type === 'skill');

  // 1. キャラクターを枠3つぶん選ぶ（大型は2枠）
  const chosen: CharacterCard[] = [];
  const pool = shuffled(characters, rng);
  const chosenOracleIds = new Set<string>();
  let slots = 0;
  for (const c of pool) {
    if (chosenOracleIds.has(c.oracleId)) continue;
    const need = c.size === 'legendaryLarge' ? 2 : 1;
    if (slots + need > MAX_CHARACTERS) continue;
    chosen.push(c);
    chosenOracleIds.add(c.oracleId);
    slots += need;
    if (slots >= MAX_CHARACTERS) break;
  }

  // 2. 選んだキャラの誰かが条件を満たせるスキルを候補にする
  const canUse = (skill: SkillCard) =>
    chosen.some((ch) => containsAll(ch.attribute, skill.conditionAttribute));
  const usable = skills.filter(canUse);

  // 3. デッキを組む: キャラカード2枚ずつ（回復要員）＋使えるスキル
  const cardIds: string[] = [];
  const counts = new Map<string, number>();
  const add = (printingId: string): boolean => {
    const oracleId = PUBLIC_CARD_CATALOG.cardByPrintingId(printingId).oracleId;
    const n = counts.get(oracleId) ?? 0;
    if (n >= MAX_COPIES_PER_CARD || cardIds.length >= DECK_SIZE) return false;
    counts.set(oracleId, n + 1);
    cardIds.push(printingId);
    return true;
  };

  for (const ch of chosen) {
    add(ch.printingId);
    add(ch.printingId);
  }
  const skillPool = usable.length > 0 ? usable : skills;
  let guard = 0;
  while (cardIds.length < DECK_SIZE && guard < 10000) {
    add(pickOne(skillPool, rng).printingId);
    guard++;
  }
  // 候補が少なくて40枚に届かない時は全スキルから足す
  while (cardIds.length < DECK_SIZE) {
    if (!add(pickOne(skills, rng).printingId)) guard++;
    if (guard > 20000) throw new Error('サンプルデッキを40枚にできませんでした');
  }

  return { characterIds: chosen.map((c) => c.printingId), cardIds };
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
