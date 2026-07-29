/**
 * カードマスターのID境界。
 *
 * 保存上の正規形は oracleId + printingId で、旧 id は保存しない。
 * ただし、既存の制作中データには id しかない行があるため、読み取り時だけ
 *   printingId = raw.printingId ?? raw.id
 *   oracleId   = raw.oracleId   ?? printingId
 * として取り込む。
 *
 * このファイルは管理画面、ローカルVite API、Cloudflare Pages Functionsの
 * 3か所から共有する。片方だけ規則を変えると、ローカルでは保存できるのに
 * 本番公開で壊れるため、IDの解釈をここ以外へ増やさない。
 */

export type LooseCardRecord = Record<string, unknown>;

export type CanonicalIdentityCard<T extends LooseCardRecord = LooseCardRecord> =
  Omit<T, 'id' | 'oracleId' | 'printingId' | 'oracleIdProvisional'> & {
    oracleId: string;
    printingId: string;
    /** 旧idから機械補完しただけで、制作者が同一性をまだ確定していない。 */
    oracleIdProvisional?: true;
  };

export class CardIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardIdentityError';
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const CARD_RARITIES = new Set(['C', 'UC', 'R', 'SR', 'SSR', 'USR', 'LSR']);

/** vol・code・rarityから導かれる印刷ID。材料が欠けていれば空文字。 */
export function expectedPrintingId(card: LooseCardRecord): string {
  const vol = card.vol;
  const code = stringValue(card.code);
  const rarity = stringValue(card.rarity);
  if (
    typeof vol !== 'number' ||
    !Number.isInteger(vol) ||
    vol < 1 ||
    !/^A\d{3}$/.test(code) ||
    !CARD_RARITIES.has(rarity)
  ) {
    return '';
  }
  return `${vol}-${code}-${rarity}`;
}

/**
 * 旧WIPを含む読み取り用normalize。
 * 旧idは必ず落とし、返り値は常に新しいフィールド名にそろえる。
 * 欠損や不整合はここではthrowせず、管理画面の公開前チェックで見えるようにする。
 */
export function normalizeCardIdentity<T extends LooseCardRecord>(raw: T): CanonicalIdentityCard<T> {
  const {
    id: legacyId,
    oracleId: rawOracleId,
    printingId: rawPrintingId,
    oracleIdProvisional: rawOracleIdProvisional,
    ...rest
  } = raw;
  const printingId = stringValue(rawPrintingId) || stringValue(legacyId);
  const oracleId = stringValue(rawOracleId) || printingId;
  const provisional = rawOracleIdProvisional === true || stringValue(rawOracleId) === '';
  return {
    ...rest,
    oracleId,
    printingId,
    ...(provisional ? { oracleIdProvisional: true as const } : {}),
  } as CanonicalIdentityCard<T>;
}

/** UIとAPIで共通利用する、1枚ぶんのID不備一覧。 */
export function cardIdentityProblems(card: LooseCardRecord): string[] {
  const problems: string[] = [];
  const oracleId = stringValue(card.oracleId);
  const printingId = stringValue(card.printingId);
  const expected = expectedPrintingId(card);

  if (oracleId === '') problems.push('oracleId がありません');
  if (
    typeof card.oracleId === 'string' &&
    card.oracleId !== card.oracleId.trim()
  ) {
    problems.push('oracleId の前後に空白があります');
  }
  if (printingId === '') problems.push('printingId がありません');
  if (
    typeof card.printingId === 'string' &&
    card.printingId !== card.printingId.trim()
  ) {
    problems.push('printingId の前後に空白があります');
  }
  if (expected === '') {
    problems.push(
      'volは正の整数、codeはA001形式、rarityは既知値で指定してください',
    );
  } else if (printingId !== '' && printingId !== expected) {
    problems.push(`printingId が vol-code-rarity と一致しません（期待: ${expected}）`);
  }
  return problems;
}

/**
 * 正規形として書き込める1枚へ変換する。
 * legacy fallbackは行わず、呼び出し側が明示的に両IDを送ったことも検証する。
 */
export function canonicalCardForWrite<T extends LooseCardRecord>(raw: T): CanonicalIdentityCard<T> {
  if (stringValue(raw.oracleId) === '' || stringValue(raw.printingId) === '') {
    throw new CardIdentityError('oracleId と printingId が必要です');
  }
  if (
    (typeof raw.oracleId === 'string' &&
      raw.oracleId !== raw.oracleId.trim()) ||
    (typeof raw.printingId === 'string' &&
      raw.printingId !== raw.printingId.trim())
  ) {
    throw new CardIdentityError(
      'oracleId と printingId の前後に空白は使用できません',
    );
  }
  const card = normalizeCardIdentity(raw);
  const problems = cardIdentityProblems(card);
  if (problems.length > 0) {
    throw new CardIdentityError(`${card.printingId || '(printingIdなし)'}: ${problems.join(' / ')}`);
  }
  return card;
}

/** printingIdの重複一覧。oracleIdの重複は再録として合法なので数えない。 */
export function duplicatePrintingIds(cards: readonly LooseCardRecord[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const card of cards) {
    const printingId = stringValue(card.printingId);
    if (printingId === '') continue;
    if (seen.has(printingId)) duplicates.add(printingId);
    seen.add(printingId);
  }
  return [...duplicates].sort();
}

export interface PrintingRename {
  from: string;
  to: string;
}

/** JSON由来のカードを、objectのキー順に左右されず比較できる文字列へする。 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function cardSignatureWithout(
  card: LooseCardRecord,
  ignoredFields: ReadonlySet<string>,
): string {
  const comparable: LooseCardRecord = {};
  for (const [key, value] of Object.entries(card)) {
    if (!ignoredFields.has(key)) comparable[key] = value;
  }
  return stableJson(comparable);
}

function uniqueCardsByPrintingId(
  cards: readonly LooseCardRecord[],
  label: string,
): Map<string, LooseCardRecord> {
  const byPrintingId = new Map<string, LooseCardRecord>();
  for (const card of cards) {
    const printingId = stringValue(card.printingId);
    if (printingId === '') {
      throw new CardIdentityError(`${label}にprintingIdが無いカードがあります`);
    }
    if (byPrintingId.has(printingId)) {
      throw new CardIdentityError(`${label}のprintingIdが重複しています: ${printingId}`);
    }
    byPrintingId.set(printingId, card);
  }
  return byPrintingId;
}

/**
 * 一括採番で送られた画像rename表が、現在カード→保存後カードの対応そのものか検証する。
 * リクエストのvolや任意文字列だけを信用して画像を動かさないための境界。
 *
 * 採番は必ず二段階で行う:
 * 1. renameなしでorderだけを保存する
 * 2. 保存済みorder/code順からA001…を算出し、IDと画像を同時に移す
 *
 * 2でクライアントから届くnext.orderを対応推定に使うと、orderを書き換えるだけで
 * 任意の2枚の画像を交換できる。対応元はサーバーに保存済みのcurrentだけから決める。
 */
export function validatePrintingRenames(
  currentCards: readonly LooseCardRecord[],
  nextCards: readonly LooseCardRecord[],
  rawRenames: readonly PrintingRename[],
  vol: number,
): PrintingRename[] {
  if (!Number.isInteger(vol) || vol < 1) {
    throw new CardIdentityError('採番対象のvolが不正です');
  }
  if (currentCards.length !== nextCards.length) {
    throw new CardIdentityError('採番・並び保存時はカードを追加・削除できません');
  }

  const currentById = uniqueCardsByPrintingId(currentCards, '保存済みカード');
  const nextById = uniqueCardsByPrintingId(nextCards, '保存後カード');
  const renames = rawRenames.map((rename) => {
    if (
      !rename ||
      typeof rename.from !== 'string' ||
      typeof rename.to !== 'string'
    ) {
      throw new CardIdentityError('画像renameはfrom/to文字列で指定してください');
    }
    return { from: rename.from.trim(), to: rename.to.trim() };
  });

  // 並び保存はprintingIdを一切変えず、order以外のカード内容も保持する。
  // これを検査しないと cards=[] や任意内容への全量置換APIになってしまう。
  if (renames.length === 0) {
    const currentIds = [...currentById.keys()].sort();
    const nextIds = [...nextById.keys()].sort();
    if (stableJson(currentIds) !== stableJson(nextIds)) {
      throw new CardIdentityError(
        '画像renameなしの並び保存ではprintingIdを変更できません',
      );
    }
    const ignored = new Set(['order']);
    for (const [printingId, source] of currentById) {
      const target = nextById.get(printingId);
      if (
        !target ||
        cardSignatureWithout(source, ignored) !==
          cardSignatureWithout(target, ignored)
      ) {
        throw new CardIdentityError(
          `${printingId}: 並び保存ではorder以外のカード内容を変更できません`,
        );
      }
    }
    return [];
  }

  const prefix = `${vol}-`;
  const fromIds = new Set<string>();
  const toIds = new Set<string>();

  for (const rename of renames) {
    const { from, to } = rename;
    if (
      from === '' ||
      to === '' ||
      from === to ||
      !from.startsWith(prefix) ||
      !to.startsWith(prefix)
    ) {
      throw new CardIdentityError(`画像renameはvol${vol}のprintingIdだけ指定できます`);
    }
    if (fromIds.has(from) || toIds.has(to)) {
      throw new CardIdentityError('画像renameの移動元または移動先が重複しています');
    }
    const source = currentById.get(from);
    const target = nextById.get(to);
    if (!source || !target) {
      throw new CardIdentityError(`画像rename ${from} -> ${to} がカード一覧と一致しません`);
    }
    fromIds.add(from);
    toIds.add(to);
  }

  // 対応は保存済みcurrentのorder/codeだけから決める。next.orderは信用しない。
  const currentOrdered = currentCards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const ao = typeof a.card.order === 'number'
        ? a.card.order
        : Number.POSITIVE_INFINITY;
      const bo = typeof b.card.order === 'number'
        ? b.card.order
        : Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      const byCode = stringValue(a.card.code).localeCompare(
        stringValue(b.card.code),
      );
      return byCode || a.index - b.index;
    })
    .map(({ card }) => card);
  const expectedRenames: PrintingRename[] = [];
  const expectedTargetIds = new Set<string>();
  const ignoredIdentityFields = new Set(['printingId', 'code', 'order']);
  for (let i = 0; i < currentOrdered.length; i++) {
    const source = currentOrdered[i];
    const from = stringValue(source.printingId);
    const code = `A${String(i + 1).padStart(3, '0')}`;
    const to = `${vol}-${code}-${stringValue(source.rarity)}`;
    if (expectedTargetIds.has(to)) {
      throw new CardIdentityError(`採番後のprintingIdが重複します: ${to}`);
    }
    expectedTargetIds.add(to);

    const target = nextById.get(to);
    if (!target) {
      throw new CardIdentityError(
        `${from} の採番先 ${to} が保存後カードにありません`,
      );
    }
    if (stringValue(target.code) !== code || target.order !== i) {
      throw new CardIdentityError(
        `${to}: code/orderが保存済みの並びから算出した値と一致しません`,
      );
    }
    if (
      cardSignatureWithout(source, ignoredIdentityFields) !==
      cardSignatureWithout(target, ignoredIdentityFields)
    ) {
      throw new CardIdentityError(
        `${from} -> ${to}: 採番時にprintingId/code/order以外のカード内容は変更できません`,
      );
    }
    if (from !== to) expectedRenames.push({ from, to });
  }

  if (expectedTargetIds.size !== nextById.size) {
    throw new CardIdentityError('保存後カードに、保存済みの並びから導けないカードがあります');
  }
  const expectedByFrom = new Map(
    expectedRenames.map((rename) => [rename.from, rename.to]),
  );
  if (
    expectedRenames.length !== renames.length ||
    renames.some((rename) => expectedByFrom.get(rename.from) !== rename.to)
  ) {
    throw new CardIdentityError(
      '画像renameが保存済みのカード順から算出した採番と一致しません。再読み込みして採番し直してください',
    );
  }

  return renames;
}

/**
 * 旧idしかない行をread-normalizeした時の仮Oracle。
 * 個別保存は許す（他の旧WIPを1枚ずつ直せるようにする）が、公開は必ず止める。
 * 明示フラグを保存するため、採番やレアリティ変更でprintingIdが変わっても状態を失わない。
 * equality判定は、フラグ導入前に正規化保存されたWIPを救う互換ゲート。
 */
export function provisionalOraclePrintingIds(cards: readonly LooseCardRecord[]): string[] {
  return cards
    .filter((card) => {
      const oracleId = stringValue(card.oracleId);
      const printingId = stringValue(card.printingId);
      return (
        card.oracleIdProvisional === true ||
        (oracleId !== '' && printingId !== '' && oracleId === printingId)
      );
    })
    .map((card) => stringValue(card.printingId))
    .sort();
}

/**
 * 同じoracleIdなら一致していなければならない、ゲーム上の定義だけを署名化する。
 * 収録・表示に属するprintingId/vol/code/rarity/name/effectText/flavorText/status/orderは含めない。
 *
 * 属性配列は順序だけ正規化し、ゲーム上意味のある重複数は維持して比較する。
 * engine/src/cards.ts のoracle検査と同じフィールド・順序を維持すること。
 */
export function oracleGameplaySignature(card: LooseCardRecord): string {
  const common = { type: card.type };
  const attributes = (value: unknown): unknown =>
    Array.isArray(value) ? [...value].sort() : value;
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
    default:
      return JSON.stringify(common);
  }
}

export interface OracleGameplayDrift {
  oracleId: string;
  printingIds: string[];
}

/**
 * 同じoracleIdを共有しているのにゲーム定義が異なる再録を返す。
 * oracleIdの単なる重複は合法で、署名が2種類以上あるグループだけが不正。
 */
export function duplicateOracleGameplayDrifts(
  cards: readonly LooseCardRecord[],
): OracleGameplayDrift[] {
  const groups = new Map<string, {
    signatures: Set<string>;
    printingIds: Set<string>;
  }>();

  for (const card of cards) {
    const oracleId = stringValue(card.oracleId);
    if (oracleId === '') continue;
    const group = groups.get(oracleId) ?? {
      signatures: new Set<string>(),
      printingIds: new Set<string>(),
    };
    group.signatures.add(oracleGameplaySignature(card));
    const printingId = stringValue(card.printingId);
    if (printingId !== '') group.printingIds.add(printingId);
    groups.set(oracleId, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.signatures.size > 1)
    .map(([oracleId, group]) => ({
      oracleId,
      printingIds: [...group.printingIds].sort(),
    }))
    .sort((a, b) => a.oracleId.localeCompare(b.oracleId));
}

/** 正規形の配列を書き込む直前の最終ゲート。 */
export function canonicalCardsForWrite<T extends LooseCardRecord>(
  raws: readonly T[],
): CanonicalIdentityCard<T>[] {
  const cards = raws.map(canonicalCardForWrite);
  const duplicates = duplicatePrintingIds(cards);
  if (duplicates.length > 0) {
    throw new CardIdentityError(`printingId が重複しています: ${duplicates.join('、')}`);
  }
  return cards;
}
