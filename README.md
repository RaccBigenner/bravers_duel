# BRAVER'S DUEL

2人対戦のカードゲーム。TypeScript でルールエンジンを作り、Web ブラウザで遊べるようにする。

- **カード一覧（公開ページ）**: https://raccbigenner.github.io/bravers_duel/
- main ブランチに push すると GitHub Actions が自動でテスト→ビルド→デプロイする

## フォルダの説明

| 場所 | 中身 |
|---|---|
| `docs/GAME_RULES.md` | **ルールの唯一の正しい情報源** |
| `data/cards.json` | カードマスターデータ（第1弾 144枚） |
| `assets/card_images/` | カード画像 |
| `engine/` | ルールエンジン（TypeScript）。AI・自動対戦テストもここ |
| `web/` | ブラウザ用の画面（Vite + React） |
| `archive/` | 昔の Flutter プロトタイプ（さわらない） |
| `STATE.md` | プロジェクトの今の状態 |

## コマンド

```bash
npm install   # 最初に1回
npm test      # エンジンのテスト
npm run sim   # 自動対戦シミュレーター（準備中）
npm run dev   # ブラウザで動作確認（開発サーバー）
npm run build # ブラウザ用のビルド
```
