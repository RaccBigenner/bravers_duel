# BRAVER'S DUEL オンライン版 実装バックログ

- 作成日: 2026-07-29
- 仕様の正本: `docs/ONLINE_SERVICE_DESIGN_2026-07-29.md`
- ルールの正本: `docs/GAME_RULES.md`
- 目的: オンライン常設版を、検証可能な縦切り単位で実装する

## 1. タスク管理の使い分け

- 設計書: 何を、なぜ作るかの正本
- GitHub Issue: 1つの実装/検証単位
- GitHub Project: 状態、担当、優先度、依存関係の正本
- Pull Request: コード差分と検証結果
- Milestone: 公開可能なまとまり

GitHub Projectの列:

1. Inbox
2. Ready
3. In Progress
4. Review
5. Blocked
6. Done

一人開発中のWIPは`In Progress`を原則1件にする。待ち時間が発生する外部設定作業がある時だけ
2件まで許可し、土台を複数同時に作りかけない。

推奨label:

- 種別: `type:feature`, `type:infra`, `type:design`, `type:bug`, `type:content`, `type:ops`
- 領域: `area:engine`, `area:protocol`, `area:server`, `area:web`, `area:admin`, `area:data`
- リスク: `risk:security`, `risk:economy`, `risk:hidden-info`, `risk:migration`
- 優先度: `priority:p0`, `priority:p1`, `priority:p2`

Issueは、完了条件が独立して検証できる0.5〜3日程度を基本にする。大きなPhaseはEpic Issueにし、
下のIDをtitle prefixとしてsub-issueへ分割する。

## 2. 完了の定義

すべてのIssueに必要:

- プレイヤーまたは運用者にとっての完了状態が書かれている
- 受入条件がチェック可能
- unit/integration/E2Eの必要範囲が通る
- 既存テストとbuildが通る
- migration、互換性、ロールバック要否を確認
- 新しい失敗状態にユーザー向け表示がある
- 必要なtelemetry、監査、feature flagがある
- 仕様/運用手順が変わる場合は正本文書も更新

PvP、経済、認証、チャットは、正常系のデモだけでDoneにしない。再送、並行処理、切断、
複数タブ、権限不正、運営停止を受入条件へ含める。

## 3. 依存関係

```text
P0 ルール/版管理
  └─ P1 サーバー権威NPC縦切り
       ├─ P2 所持/BP/ショップ
       │    ├─ P3 ルームPvP
       │    │    └─ P4 デュエルスペース/クイック
       │    │         ├─ P5 チャット/観戦/問い合わせ
       │    │         └─ P6 トーナメント
       │    └─ P7 交換
       └─ P8 最新N弾/禁止制限
```

P5のコミュニティガイドライン、通報画面、管理設計は早く始められるが、公開チャット自体は
認証、運営admin、監査ログ、kill switchが揃うまで開放しない。

## 4. Milestone P0: ルールと版管理

### OLG-001 公式ルールv0.10と現行検証器を同期

状態: この作業ツリーで実装・検証済み、未commit

検証: 2026-07-29にengine 99 tests、Web production build、未公開データ漏洩検査を通過

- キャラクター3枠を必須化
- 実カード2〜3枚
- LSR大型は2枠
- LSRキャラクターの`legendaryLarge`データ不変条件
- キャラクター枠は同名1枚まで
- 40枚側は同名4枚。場の1枚は上限へ合算しない
- 同じ所持個体の二重利用不可を正本へ記載
- 旧50枚表記と古い未実装コメントを修正

受入:

- 普通2枚は不合格
- 普通3枚と大型＋普通は合格
- 場の同名キャラクター複数は不合格
- 40枚側5枚は不合格
- 場1枚＋40枚側4枚は定義上合格し、オンライン所持判定では別々の5個体を要求
- 既存プリセットはすべて合格

### OLG-001A 場へ同名キャラクターを複数選べるか確定

状態: 完了

- 同名複数は不可
- 正本、validator、DeckBuilder、テストを同期済み

### OLG-002 基準ブランチを統合

状態: 完了（`feat/online-foundation`）

- `feat/ingame-fx`を土台にonline作業ブランチを作成
- Phase 0変更を`03229ce`として安全に分離
- `main`を`6d8f21a`で統合し、双方の既存変更を維持
- engine/web test、web/admin build、leak check、admin/Functions型検査を通過

受入:

- online実装の基準commitが1つ
- ユーザーの既存変更を失わない
- CI相当が全通過

### OLG-003 `oracle_id`と`printing_id`を分離

状態: 完了（2026-07-29、この作業ツリー）

- 第1弾144枚へ不変`oracleId`を付与
- 現行IDを`printingId`として維持。既存デッキJSON・共有ログv1は値を変えない
- 名前比較を`oracleId`比較へ変更し、効果レジストリもOracle単位に移行
- 再録を混ぜても4枚上限を回避できず、別printingでも効果を継承する検証
- data/admin/web/engine/画像生成ツールを移行
- 管理画面の旧WIP読み取り互換、仮Oracle公開ゲート、安全なPrinting ID変更・一括採番
- Cloud管理APIのカード・画像変更を同一Git commit化し、公開中ロックとCAS競合防止を追加
- 弾公開は非公開GitHub Actionsへ委譲。SHA snapshot、request ID、公開1commit、
  cleanup 1commit、失敗後の冪等再開でCloudflare Free/GitHub RESTの大量画像制限を回避
- 効果moduleと弾固有回帰testもmanifest SHAへ固定し、カード・画像と同じ公開commitへ含める。
  効果の存在/カード種別、stray Oracle、弾module間重複を公開ゲートで拒否
- 外部取得をprivate checkout前に完了。Actions/Node base imageをcommit/digest固定し、
  公開候補test/buildとWebP decoderをnetworkなしcontainerへ隔離
- 画像一覧をContents APIからGit Trees APIへ変更し、1ディレクトリ1,000件上限を解消
- ローカルAPIも保存・採番・削除・公開後処理を同一リクエストで再試行可能にした
- Cloud/ローカル変更APIへsame-origin JSONのCSRF境界、WIPレスポンスへ`no-store`を追加
- GitHub資格情報をprivate write/Actions・public read・Actions public writeの3権限へ分離
- bootstrap限定の移行スクリプトと複数入力横断の衝突検査

検証:

- engine 114 tests + migration 5 tests + Actions公開CLI 21 tests
- admin 47 tests + web 1 test
- engine/admin/Functions typecheck
- Web/Admin production build、未公開データ漏洩検査

本番有効化前の外部設定:

- 非公開リポへ`ops/bravers_duel_wip/.github/`のworkflowとtrusted scripts 2本を同期
- 対象弾の非公開`effects/volN.ts`と`effects/volN.test.ts`を用意
- 非公開Actions secret `PUBLIC_PUBLISH_TOKEN`を設定
- Cloudflareへprivate Contents write/Actions用`GITHUB_PRIVATE_TOKEN`と、
  public Contents read-only用`GITHUB_PUBLIC_TOKEN`を設定して本番再デプロイ
- Access application-domain cookieをSameSite=Laxにし、公開smoke testを実施

### OLG-004 version付きformatとデッキ合法性

- `FREE_V1`
- `EXACT_CAPACITY_3`
- `MAIN_DECK_LIMIT_ONLY`
- formatの保存/読込/検証
- 保存時、参加時、試合開始前の検証API

### OLG-005 engine/content/format versionを固定

- replay header
- 不変content manifest
- state hash
- 旧版保持方針
- golden replay

### OLG-006 現行文書とgolden deckを同期

- 全8プリセット
- starter候補
- `README.md`, `STATE.md`, β要件の現行/履歴区分
- stale comment検査

## 5. Milestone P1: オンライン縦切り

### Epic OLG-100 環境とserver基盤

- OLG-101 `server`, `protocol`, `supabase` workspace scaffold
- OLG-102 local Supabase/Worker/DO
- OLG-103 development/staging/production bindings
- OLG-104 migration CIとenvironment marker
- OLG-105 production昇格workflow

### Epic OLG-110 アカウント

- OLG-111 server-side guest account
- OLG-112 LINE/Google linking
- OLG-113 secure session/seat token
- OLG-114 active session/複数タブ制御

### Epic OLG-120 MatchDO

- OLG-121 engine server adapter
- OLG-122 `commandId + expectedRevision`
- OLG-123 stable `battleCardId`
- OLG-124 player projection
- OLG-125 snapshot/event persistence
- OLG-126 reconnect/resume
- OLG-127 timeout/disconnect
- OLG-128 authoritative NPC tutorial E2E

### Epic OLG-130 PWA shell

- OLG-131 manifest/installable shell
- OLG-132 IndexedDB draft/outbox
- OLG-133 active-match recovery UX
- OLG-134 safe Service Worker update

P1 exit:

> ゲスト開始 → NPC戦 → リロード → 同じ試合へ復帰 → 勝利 → アカウント保護

をサーバー権威で完走し、クライアント改変で勝敗/報酬を作れない。

## 6. Milestone P2: 所持、BP、ショップ

- OLG-200 ownership/BP append-only ledger
- OLG-201 card instance発行/lock
- OLG-202 初回無償starterと`onboarding_bound`
- OLG-203 追加starter 1200 BP
- OLG-204 5枚booster 150 BP
- OLG-205 order再送/開封復帰
- OLG-206 共通18/+6 BP、日次上限、反復逓減
- OLG-207 card list/deck draft
- OLG-208 売却と期待売却額検査

## 7. Milestone P3: ルームPvP

- OLG-300 招待URL/6文字code
- OLG-301 2人用seat認可
- OLG-302 player projection漏洩検査
- OLG-303 clock/reconnect/複数タブ
- OLG-304 共通BPと同一ペア逓減
- OLG-305 招待観戦用spectator projection

## 8. Milestone P4: デュエルスペースとクイック

- OLG-400 NPC/PLAYER共通actor/presence
- OLG-401 直接対戦申請
- OLG-402 QueueDO
- OLG-403 `待機者なし/相手が待機中`
- OLG-404 Glicko-2/rating history
- OLG-405 同一ペア優先回避/anti-farming

## 9. Milestone P5: ソーシャル、観戦、問い合わせ

- OLG-500 コミュニティガイドライン/年齢帯方針/保持期間
- OLG-501 CH chat/rate limit/content filter
- OLG-502 block/report/evidence snapshot
- OLG-503 moderation admin/audit/kill switch
- OLG-504 quick 30秒/tournament 60秒spectator delay
- OLG-505 ゲーム内問い合わせ/意見
- OLG-506 限定CH試験と運用レビュー

## 10. Milestone P6: トーナメント

- OLG-600 tournament state machine
- OLG-601 scheduled registration/check-in/waitlist
- OLG-602 3〜8人bracket/BYE
- OLG-603 25分round/8分chess clock/Ready/no-show
- OLG-604 TournamentDO→MatchDOの冪等な作成/結果連携
- OLG-605 deck/card/version lock
- OLG-606 system 4人instant queue
- OLG-607 common BP/official placement bonus
- OLG-608 同じmatchへ戻るreconnect/suspend/admin recovery

## 11. Milestone P7/P8

P7 交換:

- NPC recipe
- player offer/escrow
- parallel accept/expiry/cancel
- trust restriction/GM freeze

P8 format:

- `LATEST_N`
- 禁止/制限改定
- format別queue/tournament
- 旧format replay保持

## 12. 最初に着手する順

1. OLG-001のtest/build確認
2. OLG-002で基準ブランチを統合
3. OLG-003 `oracle_id`
4. OLG-004 format
5. OLG-005 version/replay
6. OLG-101 server/protocol/supabase scaffold

OLG-002は完了済み。OLG-003、OLG-004、OLG-005でカード同一性、format、再現性の土台を
固めてから、大規模なserver scaffoldへ進む。
