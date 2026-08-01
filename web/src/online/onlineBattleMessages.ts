import type {
  MatchAction,
  MatchPlayerProjection,
  MatchTerminalProjection,
  MatchViewerEvent,
} from '@bravers/protocol';
import type { Attribute } from '@bravers/engine';
import type { OnlineLocale } from './recoveryMessages';

const jaJP = {
    connectionOnline: 'オンライン',
    connectionSynced: '同期済み',
    unknownCard: '未登録カード',
    unknownCardShort: '未登録',
    hiddenHandCard: '非公開の手札',
    yourBoard: 'あなたの盤面',
    opponentBoard: '相手の盤面',
    you: 'あなた',
    opponent: '相手',
    acting: '行動中',
    deck: '山札',
    hand: '手札',
    trash: 'トラッシュ',
    characters: 'キャラクター',
    damage: 'ダメージ',
    addedAttributes: '追加属性',
    unknownAttribute: '不明な属性',
    equipment: '装備',
    yourHand: 'あなたの手札',
    opponentHand: '相手の手札',
    noCardsInHand: '手札なし',
    topOfTrash: 'トラッシュの一番上',
    empty: '空',
    yourEffects: 'あなたに適用中の効果',
    opponentEffects: '相手に適用中の効果',
    skillUses: '使用スキル',
    chargesThisTurn: '今ターンのチャージ',
    nextCost: '次のコスト',
    nextDraw: '次のドロー',
    matchCancelled: '試合は中止されました',
    matchStartFailed: '試合を開始できませんでした。',
    matchCancelledByServer: 'サーバーによって試合が中止されました。',
    draw: '引き分け',
    victory: '勝利',
    defeat: '敗北',
    abandoned: '途中離脱により終了',
    wipeout: 'キャラクター全滅',
    deckout: '山札切れ',
    turnLimit: 'ターン上限',
    card: 'カード',
    useSkill: 'スキルを使う',
    playCharacter: 'キャラクターを出す',
    equip: '装備する',
    playField: 'フィールドを出す',
    turnStartAbility: 'ターン開始能力',
    skipTurnStart: '開始時能力を使わない',
    endPlay: 'プレイを終える',
    guard: 'ガードする',
    pass: 'パスする',
    charge: 'チャージする',
    endTurn: 'ターンを終える',
    back: '‹ 戻る',
    backLabel: 'ホームへ戻る（対戦は継続）',
    sharedArea: '共通エリア',
    noField: 'フィールドなし',
    cannotGuard: 'ガード不可',
    waitingForGuard: 'ガード待ち',
    backToDuelSpace: 'デュエルスペースへ戻る',
    battleInfoAndActions: '対戦情報と操作',
    matchStatus: '試合状況',
    connection: '接続',
    turn: 'ターン',
    phase: 'フェーズ',
    activePlayer: '手番',
    actions: '操作',
    sendingAction: '操作を送信しています…',
    commandRejected: '操作が受理されませんでした。最新の盤面から選び直してください。',
    commandSendFailed: '操作を送信できませんでした。接続を確認してください。',
    confirmAgain: 'もう一度押して確定',
    cannotUndo: 'は取り消せません',
    waitingForOpponent: '相手の操作を待っています',
    battleLog: 'バトルログ',
    noLog: 'まだログはありません',
} as const;

const en = {
    connectionOnline: 'Online',
    connectionSynced: 'Synced',
    unknownCard: 'Unknown card',
    unknownCardShort: 'Unknown',
    hiddenHandCard: 'Hidden card',
    yourBoard: 'Your board',
    opponentBoard: "Opponent's board",
    you: 'You',
    opponent: 'Opponent',
    acting: 'Acting',
    deck: 'Deck',
    hand: 'Hand',
    trash: 'Trash',
    characters: 'Characters',
    damage: 'Damage',
    addedAttributes: 'Added attributes',
    unknownAttribute: 'Unknown attribute',
    equipment: 'Equipment',
    yourHand: 'Your hand',
    opponentHand: "Opponent's hand",
    noCardsInHand: 'No cards in hand',
    topOfTrash: 'Top of trash',
    empty: 'Empty',
    yourEffects: 'Effects on you',
    opponentEffects: 'Effects on opponent',
    skillUses: 'Skills used',
    chargesThisTurn: 'Charges this turn',
    nextCost: 'Next cost',
    nextDraw: 'Next draw',
    matchCancelled: 'Match cancelled',
    matchStartFailed: 'The match could not be started.',
    matchCancelledByServer: 'The match was cancelled by the server.',
    draw: 'Draw',
    victory: 'Victory',
    defeat: 'Defeat',
    abandoned: 'Ended due to a player leaving',
    wipeout: 'All characters knocked out',
    deckout: 'Deck out',
    turnLimit: 'Turn limit reached',
    card: 'Card',
    useSkill: 'Use skill',
    playCharacter: 'Play character',
    equip: 'Equip',
    playField: 'Play field',
    turnStartAbility: 'Use turn-start ability',
    skipTurnStart: 'Skip turn-start ability',
    endPlay: 'End play phase',
    guard: 'Guard',
    pass: 'Pass',
    charge: 'Charge',
    endTurn: 'End turn',
    back: '‹ Back',
    backLabel: 'Return home (match continues)',
    sharedArea: 'Shared area',
    noField: 'No field in play',
    cannotGuard: 'Cannot guard',
    waitingForGuard: 'Waiting for guard',
    backToDuelSpace: 'Return to Duel Space',
    battleInfoAndActions: 'Match information and actions',
    matchStatus: 'Match status',
    connection: 'Connection',
    turn: 'Turn',
    phase: 'Phase',
    activePlayer: 'Active player',
    actions: 'Actions',
    sendingAction: 'Sending action…',
    commandRejected: 'That action was not accepted. Choose again from the latest board.',
    commandSendFailed: 'Could not send the action. Check your connection.',
    confirmAgain: 'Press again to confirm',
    cannotUndo: ' cannot be undone',
    waitingForOpponent: 'Waiting for your opponent',
    battleLog: 'Battle log',
    noLog: 'No events yet',
} as const satisfies Record<keyof typeof jaJP, string>;

const messages = { 'ja-JP': jaJP, en } as const satisfies Record<
  OnlineLocale,
  Record<keyof typeof jaJP, string>
>;

export type OnlineBattleMessageKey = keyof (typeof messages)['ja-JP'];
export const ONLINE_BATTLE_MESSAGE_KEYS = Object.freeze(
  Object.keys(messages['ja-JP']) as OnlineBattleMessageKey[],
);

export function onlineBattleMessages(locale: OnlineLocale): (typeof messages)['ja-JP'] | (typeof messages)['en'] {
  return messages[locale];
}

export function phaseLabel(locale: OnlineLocale, phase: MatchPlayerProjection['phase']): string {
  const labels: Record<OnlineLocale, Record<MatchPlayerProjection['phase'], string>> = {
    'ja-JP': { choice: '先攻・後攻選択', play: 'プレイ', guard: 'ガード', charge: 'チャージ', finished: '終了' },
    en: { choice: 'First/second choice', play: 'Play', guard: 'Guard', charge: 'Charge', finished: 'Finished' },
  };
  return labels[locale][phase];
}

const attributeLabels = {
  'ja-JP': {
    斬: '斬', 突: '突', 打: '打', 射: '射', 飛: '飛',
    炎: '炎', 氷: '氷', 雷: '雷', 風: '風', 土: '土', 木: '木', 聖: '聖', 闇: '闇',
    竜: '竜', 獣: '獣', 補: '補', 守: '守',
  },
  en: {
    斬: 'Slash', 突: 'Pierce', 打: 'Strike', 射: 'Shot', 飛: 'Flight',
    炎: 'Fire', 氷: 'Ice', 雷: 'Lightning', 風: 'Wind', 土: 'Earth', 木: 'Wood', 聖: 'Holy', 闇: 'Dark',
    竜: 'Dragon', 獣: 'Beast', 補: 'Support', 守: 'Guard',
  },
} as const satisfies Record<OnlineLocale, Record<Attribute, string>>;

export function attributeLabel(locale: OnlineLocale, value: string): string {
  const labels = attributeLabels[locale] as Readonly<Record<string, string>>;
  return Object.hasOwn(labels, value) ? labels[value]! : onlineBattleMessages(locale).unknownAttribute;
}

export function joinAttributeLabels(locale: OnlineLocale, values: readonly string[]): string {
  return values.map((value) => attributeLabel(locale, value)).join(locale === 'ja-JP' ? '・' : ', ');
}

export function playerLabel(locale: OnlineLocale, player: 0 | 1, viewer: 0 | 1): string {
  const m = onlineBattleMessages(locale);
  return player === viewer ? m.you : m.opponent;
}

export function unknownCardName(locale: OnlineLocale, printingId: string): string {
  const m = onlineBattleMessages(locale);
  return locale === 'ja-JP'
    ? `${m.unknownCard}（${printingId}）`
    : `${m.unknownCard} (${printingId})`;
}

export function hiddenHandLabel(locale: OnlineLocale, index: number): string {
  const m = onlineBattleMessages(locale);
  return locale === 'ja-JP' ? `${m.hiddenHandCard} ${index + 1}枚目` : `${m.hiddenHandCard} ${index + 1}`;
}

export function otherCardsLabel(locale: OnlineLocale, count: number): string {
  return locale === 'ja-JP' ? `ほか ${count}枚` : `${count} more`;
}

export function effectLabels(locale: OnlineLocale, input: {
  actorLockUntilTurn: number;
  incomingDamageReduction: { value: number; untilTurn: number } | null;
}): { actorLock: string; damageReduction: string } {
  return locale === 'ja-JP'
    ? {
        actorLock: `ACTOR固定：ターン${input.actorLockUntilTurn}まで`,
        damageReduction: input.incomingDamageReduction
          ? `被ダメージ -${input.incomingDamageReduction.value}：ターン${input.incomingDamageReduction.untilTurn}まで`
          : '',
      }
    : {
        actorLock: `ACTOR locked through turn ${input.actorLockUntilTurn}`,
        damageReduction: input.incomingDamageReduction
          ? `Damage taken -${input.incomingDamageReduction.value} through turn ${input.incomingDamageReduction.untilTurn}`
          : '',
      };
}

export function terminalMessage(
  locale: OnlineLocale,
  terminal: MatchTerminalProjection,
  viewer: 0 | 1,
): { title: string; detail: string } {
  const m = onlineBattleMessages(locale);
  if (terminal.state === 'cancelled') {
    return {
      title: m.matchCancelled,
      detail: terminal.reason === 'start_failed' ? m.matchStartFailed : m.matchCancelledByServer,
    };
  }
  const title = terminal.winner === null ? m.draw : terminal.winner === viewer ? m.victory : m.defeat;
  const detail = terminal.state === 'abandoned'
    ? m.abandoned
    : terminal.reason === 'wipeout'
      ? m.wipeout
      : terminal.reason === 'deckout'
        ? m.deckout
        : m.turnLimit;
  return { title, detail };
}

export function actionLabel(
  locale: OnlineLocale,
  action: MatchAction,
  names: ReadonlyMap<string, string>,
): { title: string; detail?: string } {
  const m = onlineBattleMessages(locale);
  const actionCardName = (battleCardId: string) => names.get(battleCardId) ?? m.card;
  const slot = (value: number) => locale === 'ja-JP' ? `枠 ${value + 1}` : `Slot ${value + 1}`;
  switch (action.type) {
    case 'playSkill': {
      const targets = [
        action.usingCharacterSlot === undefined ? null : `${locale === 'ja-JP' ? '使用枠' : 'User slot'} ${action.usingCharacterSlot + 1}`,
        action.targetSlot === undefined ? null : `${locale === 'ja-JP' ? '対象枠' : 'Target slot'} ${action.targetSlot + 1}`,
        action.healTargetSlot === undefined ? null : `${locale === 'ja-JP' ? '回復枠' : 'Heal slot'} ${action.healTargetSlot + 1}`,
      ].filter((label): label is string => label !== null);
      return {
        title: m.useSkill,
        detail: `${actionCardName(action.battleCardId)}${targets.length ? (locale === 'ja-JP' ? ` ／ ${targets.join('・')}` : ` / ${targets.join(' · ')}`) : ''}`,
      };
    }
    case 'playCharacter': return { title: m.playCharacter, detail: actionCardName(action.battleCardId) };
    case 'playEquipment': return {
      title: m.equip,
      detail: `${actionCardName(action.battleCardId)}${locale === 'ja-JP' ? ' ／ ' : ' / '}${slot(action.targetCharacterSlot)}`,
    };
    case 'playField': return { title: m.playField, detail: actionCardName(action.battleCardId) };
    case 'turnStartAbility': return { title: m.turnStartAbility, detail: `${locale === 'ja-JP' ? 'キャラクター枠' : 'Character slot'} ${action.characterSlot + 1}` };
    case 'skipTurnStart': return { title: m.skipTurnStart };
    case 'endPlay': return { title: m.endPlay };
    case 'playGuard': return { title: m.guard, detail: actionCardName(action.battleCardId) };
    case 'pass': return { title: m.pass };
    case 'charge': return { title: m.charge, detail: actionCardName(action.battleCardId) };
    case 'endTurn': return { title: m.endTurn };
  }
}

export function eventLabel(
  locale: OnlineLocale,
  event: MatchViewerEvent,
  viewer: 0 | 1,
  cardName: (printingId: string) => string,
): string {
  const player = (value: 0 | 1) => playerLabel(locale, value, viewer);
  const p = 'player' in event ? player(event.player) : '';
  const possessive = 'player' in event && event.player === viewer ? 'Your' : "Opponent's";
  const slot = 'characterSlot' in event ? event.characterSlot + 1 : 0;
  if (locale === 'en') {
    switch (event.type) {
      case 'battleStarted': return `Battle started with ${player(event.firstPlayer)} going first`;
      case 'bonusCharge': return `${p} charged ${event.count} for the starting bonus`;
      case 'turnStarted': return `Turn ${event.turn}: ${event.player === viewer ? 'your' : "opponent's"} turn`;
      case 'cardsDrawn': return `${p} drew ${event.count} card(s)`;
      case 'cardsCharged': return `${p} charged ${event.count} card(s) from ${{ hand: 'hand', deck: 'deck', trash: 'trash', allHand: 'entire hand' }[event.source]}`;
      case 'cardsDiscarded': return `${p} discarded ${event.count} card(s)`;
      case 'cardsMilled': return `${event.count} card(s) went from ${possessive.toLowerCase()} deck to trash`;
      case 'apDiscarded': return `${p} lost ${event.count} AP`;
      case 'trashReturnedToDeck': return `${p} returned ${event.count} card(s) from trash to deck`;
      case 'skillPlayed': return `${p} used “${cardName(event.printingId)}” from slot ${slot}`;
      case 'characterPlayed': return `${p} played “${cardName(event.printingId)}”`;
      case 'cardCastFromDeck': return `${p} used “${cardName(event.printingId)}” from the deck in slot ${slot}`;
      case 'attackDeclared': return `${p} attacked for ${event.value} with “${cardName(event.printingId)}” in slot ${slot}${event.noGuard ? ' (cannot guard)' : ''}`;
      case 'guardPlayed': return `${p} guarded slot ${slot} with “${cardName(event.printingId)}” (${event.before}→${event.after})`;
      case 'equipmentPlayed': return `${p} equipped “${cardName(event.printingId)}” to slot ${slot}${event.removedPrintingId ? ` (replacing “${cardName(event.removedPrintingId)}”)` : ''}`;
      case 'equipmentDestroyed': return `${possessive} “${cardName(event.printingId)}” in slot ${slot} was destroyed`;
      case 'fieldPlayed': return `${p} played field “${cardName(event.printingId)}”${event.replacedPrintingId ? ` (replacing “${cardName(event.replacedPrintingId)}”)` : ''}`;
      case 'powerChanged': return `${possessive} power in slot ${slot} changed by ${event.amount >= 0 ? '+' : ''}${event.amount}`;
      case 'guardBoosted': return `${possessive} guard changed by ${event.amount >= 0 ? '+' : ''}${event.amount} (${event.remaining} remaining)`;
      case 'damageTaken': return `${possessive} slot ${slot} took ${event.amount} damage (${event.hpLeft} HP)${event.sourcePrintingId ? ` / “${cardName(event.sourcePrintingId)}”` : ''}`;
      case 'standbyImmune': return `${possessive} slot ${slot} is immune to damage`;
      case 'healed': return `${possessive} slot ${slot} recovered ${event.amount} HP`;
      case 'characterKnockedOut': return `${possessive} slot ${slot} was knocked out`;
      case 'characterRevived': return `${possessive} slot ${slot} returned with ${event.hp} HP`;
      case 'actorChanged': return `${possessive} ACTOR moved to slot ${slot}${event.forced ? ' (forced)' : ''}`;
      case 'actorLocked': return `${possessive} ACTOR was locked through turn ${event.untilTurn}`;
      case 'actorUnlocked': return `${possessive} ACTOR lock was removed`;
      case 'actorLockBlocked': return `${possessive} ACTOR lock was prevented`;
      case 'deckOut': return `${p} ran out of cards`;
      case 'matchEnded': return `Match ended: ${terminalMessage(locale, event.result, viewer).title}`;
    }
  }
  switch (event.type) {
    case 'battleStarted': return `${player(event.firstPlayer)}の先攻でバトル開始`;
    case 'bonusCharge': return `${p}が開始ボーナスで${event.count}枚チャージ`;
    case 'turnStarted': return `ターン${event.turn}：${p}の番`;
    case 'cardsDrawn': return `${p}が${event.count}枚ドロー`;
    case 'cardsCharged': return `${p}が${event.count}枚チャージ（${{ hand: '手札', deck: '山札', trash: 'トラッシュ', allHand: '手札すべて' }[event.source]}から）`;
    case 'cardsDiscarded': return `${p}が${event.count}枚捨てた`;
    case 'cardsMilled': return `${p}の山札から${event.count}枚がトラッシュへ`;
    case 'apDiscarded': return `${p}がAPを${event.count}枚失った`;
    case 'trashReturnedToDeck': return `${p}がトラッシュ${event.count}枚を山札へ戻した`;
    case 'skillPlayed': return `${p}が枠${slot}で「${cardName(event.printingId)}」を使用`;
    case 'characterPlayed': return `${p}が「${cardName(event.printingId)}」を登場させた`;
    case 'cardCastFromDeck': return `${p}が山札から枠${slot}で「${cardName(event.printingId)}」を使用`;
    case 'attackDeclared': return `${p}が枠${slot}の「${cardName(event.printingId)}」で${event.value}攻撃${event.noGuard ? '（ガード不可）' : ''}`;
    case 'guardPlayed': return `${p}が枠${slot}へ「${cardName(event.printingId)}」でガード（${event.before}→${event.after}）`;
    case 'equipmentPlayed': return `${p}が枠${slot}へ「${cardName(event.printingId)}」を装備${event.removedPrintingId ? `（「${cardName(event.removedPrintingId)}」と交換）` : ''}`;
    case 'equipmentDestroyed': return `${p}の枠${slot}の「${cardName(event.printingId)}」が破壊された`;
    case 'fieldPlayed': return `${p}がフィールド「${cardName(event.printingId)}」を展開${event.replacedPrintingId ? `（「${cardName(event.replacedPrintingId)}」と交換）` : ''}`;
    case 'powerChanged': return `${p}の枠${slot}のパワーが${event.amount >= 0 ? '+' : ''}${event.amount}`;
    case 'guardBoosted': return `${p}のガード値が${event.amount >= 0 ? '+' : ''}${event.amount}（残り${event.remaining}）`;
    case 'damageTaken': return `${p}の枠${slot}が${event.amount}ダメージ（HP ${event.hpLeft}）${event.sourcePrintingId ? `／「${cardName(event.sourcePrintingId)}」` : ''}`;
    case 'standbyImmune': return `${p}の枠${slot}はダメージを受けない`;
    case 'healed': return `${p}の枠${slot}が${event.amount}回復`;
    case 'characterKnockedOut': return `${p}の枠${slot}が戦闘不能`;
    case 'characterRevived': return `${p}の枠${slot}がHP${event.hp}で復帰`;
    case 'actorChanged': return `${p}のACTORが枠${slot}へ交代${event.forced ? '（強制）' : ''}`;
    case 'actorLocked': return `${p}のACTORがターン${event.untilTurn}まで固定`;
    case 'actorUnlocked': return `${p}のACTOR固定が解除`;
    case 'actorLockBlocked': return `${p}のACTOR固定を防いだ`;
    case 'deckOut': return `${p}が山札切れ`;
    case 'matchEnded': return `試合終了：${terminalMessage(locale, event.result, viewer).title}`;
  }
}

export function fieldOwnerLabel(locale: OnlineLocale, owner: 0 | 1, viewer: 0 | 1): string {
  const ownerName = playerLabel(locale, owner, viewer);
  return locale === 'ja-JP'
    ? `${ownerName}のフィールド`
    : owner === viewer ? 'Your field' : "Opponent's field";
}

export function attackLabels(locale: OnlineLocale, input: {
  value: number;
  attackerSlot: number;
  chosenSlot?: number;
  noGuard: boolean;
  guardValue?: number;
}): { title: string; detail: string } {
  if (locale === 'ja-JP') {
    return {
      title: `攻撃 ${input.value}`,
      detail: `枠${input.attackerSlot + 1}から${input.chosenSlot === undefined ? '' : ` ／ 対象枠${input.chosenSlot + 1}`} ／ ${input.noGuard ? 'ガード不可' : input.guardValue === undefined ? 'ガード待ち' : `ガード ${input.guardValue}`}`,
    };
  }
  return {
    title: `Attack ${input.value}`,
    detail: `From slot ${input.attackerSlot + 1}${input.chosenSlot === undefined ? '' : ` / target slot ${input.chosenSlot + 1}`} / ${input.noGuard ? 'Cannot guard' : input.guardValue === undefined ? 'Waiting for guard' : `Guard ${input.guardValue}`}`,
  };
}
