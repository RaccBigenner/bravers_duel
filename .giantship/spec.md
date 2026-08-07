# bravers_duel

## これは何を作るのか
ブラウザ/PWAの2人対戦TCG。仮想カードショップでNPCや他プレイヤーとデュエルする体験が目標。

## 主な画面・機能
- Home(遊び方案内)
- DeckSelect(デッキ選択)
- DeckBuilder(構築+JSON入出力)
- Battle/BattleLog(CPU対戦)
- Gallery(カード一覧)
- OnlineBattle(サーバー権威対戦)
- RulesModal(ルール説明)
- admin(カード管理,Cloudflare Pages)
- (計画)ショップ/交換/大会/観戦

## 使っている道具
- TypeScript
- React+Vite
- Cloudflare Workers/Durable Objects
- Cloudflare Pages
- Supabase(Postgres+匿名Auth)
- npm workspaces
- vitest
- GitHub Actions/Pages

## いまの状態
オフラインβ(CPU戦、全144枚自由使用)は公開済み。オンライン版はG0基盤とG1(NPC戦サーバー権威化)をコード実装済みだが、Docker互換ランタイム不在でSupabase実stack受入が未完。PvP/BP/交換/観戦などG2以降は未着手。

```json spec
{
 "what": "ブラウザ/PWAの2人対戦TCG。仮想カードショップでNPCや他プレイヤーとデュエルする体験が目標。",
 "screens": [
  "Home(遊び方案内)",
  "DeckSelect(デッキ選択)",
  "DeckBuilder(構築+JSON入出力)",
  "Battle/BattleLog(CPU対戦)",
  "Gallery(カード一覧)",
  "OnlineBattle(サーバー権威対戦)",
  "RulesModal(ルール説明)",
  "admin(カード管理,Cloudflare Pages)",
  "(計画)ショップ/交換/大会/観戦"
 ],
 "tools": [
  "TypeScript",
  "React+Vite",
  "Cloudflare Workers/Durable Objects",
  "Cloudflare Pages",
  "Supabase(Postgres+匿名Auth)",
  "npm workspaces",
  "vitest",
  "GitHub Actions/Pages"
 ],
 "state": "オフラインβ(CPU戦、全144枚自由使用)は公開済み。オンライン版はG0基盤とG1(NPC戦サーバー権威化)をコード実装済みだが、Docker互換ランタイム不在でSupabase実stack受入が未完。PvP/BP/交換/観戦などG2以降は未着手。"
}
```
