/**
 * 自動対戦シミュレーター。
 * 使い方:
 *   npm run sim                     # 200戦（simpleAI 同士）
 *   npm run sim -- --games 1000     # 対戦数を指定
 *   npm run sim -- --ai random      # ランダムAI同士
 */
import { randomAi, simpleAi, type BattleAi } from '../ai';
import { sampleDeck } from '../decks';
import { runBattle } from '../runner';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const games = Number(argValue('games') ?? 200);
const aiKind = argValue('ai') ?? 'simple';
const baseSeed = Number(argValue('seed') ?? 1);

function makeAis(seed: number): [BattleAi, BattleAi] {
  if (aiKind === 'random') return [randomAi(seed * 2 + 1), randomAi(seed * 2 + 2)];
  return [simpleAi({ keepHand: 0 }), simpleAi({ keepHand: 2 })];
}

console.log(`BRAVER'S DUEL 自動対戦: ${games}戦 (AI: ${aiKind})`);

let wins = [0, 0];
let draws = 0;
let firstPlayerWins = 0;
let decidedGames = 0;
let totalTurns = 0;
const reasons = new Map<string, number>();

for (let i = 0; i < games; i++) {
  const seed = baseSeed + i;
  // 毎回違うサンプルデッキで対戦させる
  const decks: [ReturnType<typeof sampleDeck>, ReturnType<typeof sampleDeck>] = [
    sampleDeck(seed * 2 + 1),
    sampleDeck(seed * 2 + 2),
  ];
  const result = runBattle(decks, makeAis(seed), seed);

  totalTurns += result.turns;
  reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
  if (result.winner === null) {
    draws++;
  } else {
    wins[result.winner]++;
    decidedGames++;
    if (result.winner === result.firstPlayer) firstPlayerWins++;
  }
}

const pct = (n: number, total: number) => (total === 0 ? '-' : `${((100 * n) / total).toFixed(1)}%`);

console.log('');
console.log(`プレイヤー1勝ち: ${wins[0]}回 (${pct(wins[0], games)})`);
console.log(`プレイヤー2勝ち: ${wins[1]}回 (${pct(wins[1], games)})`);
console.log(`引き分け: ${draws}回`);
console.log(`先攻の勝率: ${pct(firstPlayerWins, decidedGames)}`);
console.log(`平均ターン数: ${(totalTurns / games).toFixed(1)}`);
console.log('決着理由:');
for (const [reason, n] of reasons) {
  const label = { wipeout: '全滅', deckout: '山札切れ', turnLimit: 'ターン上限' }[reason] ?? reason;
  console.log(`  - ${label}: ${n}回 (${pct(n, games)})`);
}
