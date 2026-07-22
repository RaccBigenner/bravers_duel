/**
 * 自動対戦シミュレーター。
 * 使い方:
 *   npm run sim                       # アーキタイプデッキ総当たり戦（各組み合わせ50戦）
 *   npm run sim -- --per 100          # 組み合わせごとの対戦数を指定
 *   npm run sim -- --mode random      # ランダム生成デッキ + simpleAI
 *   npm run sim -- --mode chaos       # ランダム生成デッキ + randomAI（耐久テスト）
 */
import { randomAi, simpleAi, type BattleAi } from '../ai';
import { DEFAULT_DECK_RULES, sampleDeck, type DeckRules } from '../decks';
import { runBattle } from '../runner';
import { sampleArchetypeDecks } from '../sampleDecks';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = argValue('mode') ?? 'archetype';
const baseSeed = Number(argValue('seed') ?? 1);
const deckRules: DeckRules = {
  deckSize: Number(argValue('deckSize') ?? DEFAULT_DECK_RULES.deckSize),
  maxCopies: Number(argValue('maxCopies') ?? DEFAULT_DECK_RULES.maxCopies),
};

const pct = (n: number, total: number) => (total === 0 ? '-' : `${((100 * n) / total).toFixed(1)}%`);

if (mode === 'archetype') {
  const per = Number(argValue('per') ?? 50);
  const decks = sampleArchetypeDecks(deckRules);
  console.log(
    `アーキタイプ総当たり戦: ${decks.length}デッキ × 各組み合わせ${per}戦（デッキ${deckRules.deckSize}枚・同名${deckRules.maxCopies}枚まで）`,
  );

  interface DeckStats {
    games: number;
    winWipeout: number; // 相手を全滅させて勝ち
    winDeckout: number; // 相手が山札切れで勝ち
    loseWipeout: number; // 全滅して負け
    loseDeckout: number; // 自分が山札切れで負け
  }
  const stats = new Map<string, DeckStats>();
  const statOf = (name: string): DeckStats => {
    let s = stats.get(name);
    if (!s) {
      s = { games: 0, winWipeout: 0, winDeckout: 0, loseWipeout: 0, loseDeckout: 0 };
      stats.set(name, s);
    }
    return s;
  };
  const reasons = new Map<string, number>();
  let totalTurns = 0;
  let totalGames = 0;
  let firstPlayerWins = 0;
  let decided = 0;

  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      for (let g = 0; g < per; g++) {
        const seed = baseSeed + totalGames;
        const result = runBattle(
          [decks[i].deck, decks[j].deck],
          [simpleAi({ keepHand: 2 }), simpleAi({ keepHand: 2 })],
          seed,
          { deckRules },
        );
        totalGames++;
        totalTurns += result.turns;
        reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
        statOf(decks[i].name).games++;
        statOf(decks[j].name).games++;
        if (result.winner !== null) {
          decided++;
          if (result.winner === result.firstPlayer) firstPlayerWins++;
          const winName = result.winner === 0 ? decks[i].name : decks[j].name;
          const loseName = result.winner === 0 ? decks[j].name : decks[i].name;
          if (result.reason === 'wipeout') {
            statOf(winName).winWipeout++;
            statOf(loseName).loseWipeout++;
          } else {
            statOf(winName).winDeckout++;
            statOf(loseName).loseDeckout++;
          }
        }
      }
    }
  }

  console.log('');
  console.log('デッキ別勝率（内訳: 全滅勝ち/山札切れ勝ち | 全滅負け/山札切れ負け）:');
  const ranked = decks
    .map((d) => ({ name: d.name, s: statOf(d.name) }))
    .sort((a, b) => (b.s.winWipeout + b.s.winDeckout) / b.s.games - (a.s.winWipeout + a.s.winDeckout) / a.s.games);
  for (const { name, s } of ranked) {
    const w = s.winWipeout + s.winDeckout;
    console.log(
      `  ${pct(w, s.games).padStart(6)}  ${name.padEnd(8, '　')} 勝ち[全滅${s.winWipeout} 山切${s.winDeckout}] 負け[全滅${s.loseWipeout} 山切${s.loseDeckout}]`,
    );
  }
  console.log('');
  console.log(`合計${totalGames}戦 / 平均ターン数: ${(totalTurns / totalGames).toFixed(1)} / 先攻勝率: ${pct(firstPlayerWins, decided)}`);
  console.log('決着理由:');
  for (const [reason, n] of reasons) {
    const label = { wipeout: '全滅', deckout: '山札切れ', turnLimit: 'ターン上限' }[reason] ?? reason;
    console.log(`  - ${label}: ${n}回 (${pct(n, totalGames)})`);
  }
} else {
  const gamesN = Number(argValue('games') ?? 200);
  console.log(`ランダムデッキ対戦: ${gamesN}戦 (mode: ${mode})`);

  let wins = [0, 0];
  let draws = 0;
  let firstPlayerWins = 0;
  let decided = 0;
  let totalTurns = 0;
  const reasons = new Map<string, number>();

  for (let i = 0; i < gamesN; i++) {
    const seed = baseSeed + i;
    const ais: [BattleAi, BattleAi] =
      mode === 'chaos'
        ? [randomAi(seed * 2 + 1), randomAi(seed * 2 + 2)]
        : [simpleAi({ keepHand: 2 }), simpleAi({ keepHand: 2 })];
    const result = runBattle([sampleDeck(seed * 2 + 1), sampleDeck(seed * 2 + 2)], ais, seed);
    totalTurns += result.turns;
    reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
    if (result.winner === null) draws++;
    else {
      wins[result.winner]++;
      decided++;
      if (result.winner === result.firstPlayer) firstPlayerWins++;
    }
  }

  console.log('');
  console.log(`プレイヤー1勝ち: ${wins[0]}回 (${pct(wins[0], gamesN)})`);
  console.log(`プレイヤー2勝ち: ${wins[1]}回 (${pct(wins[1], gamesN)})`);
  console.log(`引き分け: ${draws}回`);
  console.log(`先攻の勝率: ${pct(firstPlayerWins, decided)}`);
  console.log(`平均ターン数: ${(totalTurns / gamesN).toFixed(1)}`);
  console.log('決着理由:');
  for (const [reason, n] of reasons) {
    const label = { wipeout: '全滅', deckout: '山札切れ', turnLimit: 'ターン上限' }[reason] ?? reason;
    console.log(`  - ${label}: ${n}回 (${pct(n, gamesN)})`);
  }
}
