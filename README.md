# BRAVER'S DUEL

2人対戦のカードゲーム。TypeScript でルールエンジンを作り、Web ブラウザで遊べるようにする。

- **カード一覧（公開ページ）**: https://raccbigenner.github.io/bravers_duel/
- main ブランチに push すると GitHub Actions が自動でテスト→ビルド→デプロイする

## フォルダの説明

| 場所 | 中身 |
|---|---|
| `docs/GAME_RULES.md` | **ルールの唯一の正しい情報源** |
| `docs/ONLINE_SERVICE_DESIGN_2026-07-29.md` | オンライン版の設計（正本） |
| `docs/ONLINE_IMPLEMENTATION_BACKLOG.md` | オンライン版の作業一覧と進み具合 |
| `docs/CARD_MASTER.md` | カードの作り方・弾の公開手順 |
| `docs/balance/` | バランス調整の実験記録（日付つき。**当時の記録なので今のルールとは限らない**） |
| `data/cards.json` | カードマスターデータ（第1弾 144枚） |
| `data/sets.json` | 弾（vol）のメタ情報と公開状態 |
| `data/formats.json` | 対戦フォーマットの版（`FREE_V1` など） |
| `data/starters.json` | 初回スターターの候補 |
| `assets/card_images/` | カード画像 |
| `engine/` | ルールエンジン（TypeScript）。AI・自動対戦シミュレーターもここ |
| `web/` | ブラウザ用の画面（Vite + React） |
| `admin/` | カード制作用の管理画面 |
| `protocol/` | ブラウザとオンラインサーバーで共有する通信型のworkspace |
| `server/` | サーバー権威バトル/APIのworkspaceとPostgreSQL migration正本 |
| `supabase/` | Supabase CLIのローカル設定（migrationは`server/`へ接続） |
| `scripts/` | 検査スクリプト（漏れ検査・古い記述の検査など） |
| `ops/` | 非公開リポへ同期する公開パイプライン用ファイル |
| `archive/` | 昔の Flutter プロトタイプ（さわらない） |
| `STATE.md` | プロジェクトの今の状態 |

## コマンド

```bash
npm install       # 最初に1回
npm test          # 全部のテスト（protocol / server / engine / web / admin / スクリプト）
npm run sim       # 自動対戦シミュレーター
npm run dev       # ブラウザで動作確認（開発サーバー）
npm run build     # ブラウザ用のビルド
npm run admin     # カード制作用の管理画面
npm run check:leak    # 未公開カードが公開物へ漏れていないか検査
npm run check:stale   # 古くなった記述が残っていないか検査
```

エンジンだけを触るとき:

```bash
npm --workspace engine run typecheck      # 型検査
npm --workspace engine run golden:update  # golden replay を作り直す
npm --workspace engine run golden:decks   # golden deck（8種）を作り直す
```

`golden:*` は、ルールやプリセットを**意図して**変えたときだけ実行し、差分を目で見てからコミットする。
テストを通すために機械的に走らせない（変えてはいけないものが変わったことに気づけなくなる）。

## 今どうなっているか

今の状態と次にやることは `STATE.md` にまとめてある。オンライン版の作業単位は
`docs/ONLINE_IMPLEMENTATION_BACKLOG.md` を見る。
