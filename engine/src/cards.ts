/**
 * カードマスターデータの読み込みと検証。
 * データ本体は data/cards.json（公開済みの弾のカード）。
 *
 * 重要: この data/cards.json は Vite ビルドで公開JSにそのまま埋め込まれる。
 * つまり「ここに入れたカード＝世界中の誰でも読める」。制作中の弾は絶対にここへ入れず、
 * data/wip/（gitignore）に置くこと。念のため下の ALL_CARDS でも
 * 「released の弾に属するカードだけ」に絞る二重の安全策をかけている。
 */
import rawCards from '../../data/cards.json';
import { isVolReleased } from './sets';
import {
  ATTRIBUTES,
  CARD_STATUSES,
  CHARACTER_SIZES,
  RARITIES,
  SKILL_VALUE_TYPES,
  type Attribute,
  type Card,
  type OracleId,
  type PrintingId,
} from './types';

function fail(printingId: string, message: string): never {
  throw new Error(`カードデータが不正です [${printingId}]: ${message}`);
}

function checkAttributes(printingId: string, values: unknown, field: string): Attribute[] {
  if (!Array.isArray(values)) fail(printingId, `${field} が配列ではない`);
  for (const v of values) {
    if (!ATTRIBUTES.includes(v as Attribute)) fail(printingId, `${field} に未知の属性: ${v}`);
  }
  return values as Attribute[];
}

export function validateCard(raw: Record<string, unknown>): Card {
  const printingId = String(raw.printingId ?? '(printingIdなし)');
  if (typeof raw.oracleId !== 'string' || raw.oracleId.trim() === '') {
    fail(printingId, 'oracleId が空、または文字列ではない');
  }
  if (raw.oracleId !== raw.oracleId.trim()) {
    fail(printingId, 'oracleId の前後に空白を含めない');
  }
  if (typeof raw.printingId !== 'string' || raw.printingId.trim() === '') {
    fail(printingId, 'printingId が空、または文字列ではない');
  }
  if (raw.id !== undefined) {
    fail(printingId, 'raw dataに旧idは保存しない（printingIdを使う）');
  }
  if (
    typeof raw.vol !== 'number' ||
    !Number.isInteger(raw.vol) ||
    raw.vol < 1
  ) {
    fail(printingId, 'vol が正の整数ではない');
  }
  if (typeof raw.code !== 'string' || !/^A\d{3}$/.test(raw.code)) {
    fail(printingId, 'code がA001形式ではない');
  }
  if (!RARITIES.includes(raw.rarity as never)) fail(printingId, `未知のレアリティ: ${raw.rarity}`);
  const expectedPrintingId = `${raw.vol}-${raw.code}-${raw.rarity}`;
  if (raw.printingId !== expectedPrintingId) {
    fail(printingId, `printingIdはvol-code-rarityと一致させる（期待: ${expectedPrintingId}）`);
  }
  if (typeof raw.name !== 'string' || raw.name === '') fail(printingId, 'name が空');
  if (typeof raw.effectText !== 'string') fail(printingId, 'effectText が文字列ではない');
  if (typeof raw.flavorText !== 'string') fail(printingId, 'flavorText が文字列ではない');
  if (raw.status !== undefined && !CARD_STATUSES.includes(raw.status as never)) {
    fail(printingId, `未知の status: ${raw.status}`);
  }

  switch (raw.type) {
    case 'character': {
      if (!CHARACTER_SIZES.includes(raw.size as never)) fail(printingId, `未知の size: ${raw.size}`);
      if (typeof raw.hp !== 'number' || raw.hp <= 0) fail(printingId, `hp が不正: ${raw.hp}`);
      checkAttributes(printingId, raw.attribute, 'attribute');
      break;
    }
    case 'skill': {
      if (typeof raw.costAp !== 'number' || raw.costAp < 0) fail(printingId, `costAp が不正: ${raw.costAp}`);
      checkAttributes(printingId, raw.conditionAttribute, 'conditionAttribute');
      if (typeof raw.baseValue !== 'number') fail(printingId, 'baseValue が数値ではない');
      if (!SKILL_VALUE_TYPES.includes(raw.valueType as never)) {
        fail(printingId, `未知の valueType: ${raw.valueType}`);
      }
      break;
    }
    case 'equipment': {
      checkAttributes(printingId, raw.addAttribute, 'addAttribute');
      break;
    }
    case 'field':
      break;
    default:
      fail(printingId, `未知のカード種類: ${raw.type}`);
  }

  // 旧idはraw JSONへ戻らないようnon-enumerableかつreadonlyで付ける。
  const card = { ...raw } as unknown as Card;
  Object.defineProperty(card, 'id', {
    value: printingId,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return card;
}

/** data/cards.json に入っている検証済みカード（原則すべて公開弾のもの） */
const VALIDATED_CARDS: Card[] = (rawCards as Record<string, unknown>[]).map(validateCard);

/** そのカードが公開ビルドに載るか（released の弾に属し、カード個別も draft でない） */
function isPublicCard(c: Card): boolean {
  if (c.status === 'draft') return false;
  return isVolReleased(c.vol);
}

/**
 * 公開されている全カード。ゲーム本体・カード一覧・デッキ構築はこれだけを見る。
 * 万一 data/cards.json に未公開弾のカードが紛れても、ここで弾い（除外し）て漏れを防ぐ。
 */
export const ALL_CARDS: Card[] = VALIDATED_CARDS.filter(isPublicCard);

export interface CardCatalog {
  readonly cards: readonly Card[];
  cardByPrintingId(printingId: PrintingId): Card;
  printingsByOracleId(oracleId: OracleId): readonly Card[];
}

/**
 * 同じoracleに属する印刷が同じゲーム挙動を持つことを検査するための署名。
 * 収録・見た目に属するprintingId/vol/code/rarity/name/flavor/statusは含めない。
 */
function oracleGameplaySignature(card: Card): string {
  // 効果文は表示・翻訳データ。実挙動はoracleIdでeffect registryへ結び付くため、
  // 言語や表記整理が異なる再録をdrift扱いしない。
  const common = { type: card.type };
  const attributes = (values: readonly Attribute[]) => [...values].sort();
  switch (card.type) {
    case 'character':
      return JSON.stringify({
        ...common,
        size: card.size,
        hp: card.hp,
        attribute: attributes(card.attribute),
      });
    case 'skill':
      return JSON.stringify({
        ...common,
        costAp: card.costAp,
        conditionAttribute: attributes(card.conditionAttribute),
        baseValue: card.baseValue,
        valueType: card.valueType,
      });
    case 'equipment':
      return JSON.stringify({
        ...common,
        addAttribute: attributes(card.addAttribute),
      });
    case 'field':
      return JSON.stringify(common);
  }
}

/** テスト用の架空再録も注入できる、カード検索の純粋なcatalogを作る。 */
export function createCardCatalog(cards: readonly Card[]): CardCatalog {
  const catalogCards = [...cards];
  const byPrintingId = new Map<PrintingId, Card>();
  const byOracleId = new Map<OracleId, Card[]>();
  const oracleSignatures = new Map<OracleId, { signature: string; printingId: PrintingId }>();

  for (const card of catalogCards) {
    if (byPrintingId.has(card.printingId)) {
      throw new Error(`printingIdが重複しています: ${card.printingId}`);
    }
    byPrintingId.set(card.printingId, card);

    const signature = oracleGameplaySignature(card);
    const existingDefinition = oracleSignatures.get(card.oracleId);
    if (existingDefinition && existingDefinition.signature !== signature) {
      throw new Error(
        `同じoracleIdのゲーム定義が一致しません: ${card.oracleId} ` +
        `(${existingDefinition.printingId}, ${card.printingId})`,
      );
    }
    oracleSignatures.set(card.oracleId, {
      signature,
      printingId: existingDefinition?.printingId ?? card.printingId,
    });

    const printings = byOracleId.get(card.oracleId) ?? [];
    printings.push(card);
    byOracleId.set(card.oracleId, printings);
  }

  return {
    cards: catalogCards,
    cardByPrintingId(printingId) {
      const card = byPrintingId.get(printingId);
      if (!card) throw new Error(`カードが見つかりません: ${printingId}`);
      return card;
    },
    printingsByOracleId(oracleId) {
      return byOracleId.get(oracleId) ?? [];
    },
  };
}

export const PUBLIC_CARD_CATALOG = createCardCatalog(ALL_CARDS);

export function cardByPrintingId(printingId: PrintingId): Card {
  return PUBLIC_CARD_CATALOG.cardByPrintingId(printingId);
}

export function printingsByOracleId(oracleId: OracleId): readonly Card[] {
  return PUBLIC_CARD_CATALOG.printingsByOracleId(oracleId);
}

export function oracleIdOfPrinting(printingId: PrintingId): OracleId {
  return cardByPrintingId(printingId).oracleId;
}

/** @deprecated `cardByPrintingId`を使うこと。 */
export function cardById(id: string): Card {
  return cardByPrintingId(id);
}
