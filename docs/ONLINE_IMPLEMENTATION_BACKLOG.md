# BRAVER'S DUEL オンライン版 実装バックログ

- 作成日: 2026-07-29
- 仕様の正本: `docs/ONLINE_SERVICE_DESIGN_2026-07-29.md`
- ルールの正本: `docs/GAME_RULES.md`
- 目的: オンライン常設版を、検証可能な縦切り単位で実装する

## 0. 最終ゴールと段階リリースゲート

### 最終ゴール

日本向けに最適化した無料のブラウザTCGとして、スマホでもPCでもインストールなしで始められ、
必要になった時だけLINE/Google等へ連携してアカウントを保護できる状態を作る。

プレイヤーは仮想カードショップの同じ空間でNPCと他プレイヤーを見つけ、対戦、収集、
デッキ編集、BPによるスターター/パック/シングル購入、売却、観戦、交流、大会、交換を
段階的に楽しめる。対戦、カード個体、BP、報酬は完全にサーバー権威とし、リロードや一時切断でも
進行中の操作を失わない。初回公開は日本語だけでも、画面文言、イベント、カード表示データは
localeから分離し、後からゲームロジックを分岐せずに多言語を追加できる構造を維持する。

運営側は、公開前検査、監査ログ、telemetry、段階開放、kill switch、ロールバックによって、
カード追加、経済、チャット、大会を一人運営でも安全に止めたり戻したりできることを最終条件とする。

P0〜P8は実装の依存関係、以下のGateはプレイヤーへ公開範囲を広げる判断基準である。
IssueがDoneでも、対応するplayer-visible exit conditionを実機で満たすまで次のGateへ進めない。

### G0: Foundation

状態: **進行中**。OLG-003の実装は完了。本番カード公開パイプラインの有効化が未完了で、
次のコードタスクはOLG-004。

主な範囲: P0とカード公開運用

player-visible exit conditions:

- 現在公開中のブラウザゲーム、既存デッキJSON、共有ログが移行前と同じように使える
- 選択中のformatと違反理由が表示され、保存時と対戦開始時で合法性判定が一致する
- 公開済みの試合は、固定されたengine/content/format versionから同じ結果を再現できる
- 非公開の新弾を本番管理画面から安全に公開し、カード一覧、デッキ編集、NPC戦へ同じ内容が反映される
- 公開失敗時に制作中カードが消えず、未公開カード、画像、資格情報が公開物やログへ漏れない

### G1: Internal Alpha

状態: 未着手

主な範囲: P1

player-visible exit conditions:

- ゲストとして開始し、サーバー権威のNPC戦を最初から最後まで遊べる
- バトル中にリロードまたは一時切断しても、同じ試合と操作待ちへ復帰できる
- LINE/Google等へ連携すると、NPC進行、デッキ、進行中試合が失われずアカウントを保護できる
- スマホ縦持ちとPCの共通バトル盤面で、勝敗、時間切れ、再接続理由を理解できる
- クライアント改変、再送、複数タブから勝敗、カード、報酬を作れない

### G2: Collection Closed Beta

状態: 未着手

主な範囲: P2

player-visible exit conditions:

- 招待したテスターが、初回無償スターター選択からNPC戦でのBP獲得、5枚パック購入、
  カード一覧、合法デッキ作成までを自力で完走できる
- NPCシングル売買では、表示価格と有限在庫に基づいて実在するカード個体だけが移転し、
  売り切れ、価格変更、使用不能になるデッキが購入/売却前に分かる
- 同じ購入/売却/報酬を再送または並行実行しても、BPとカード個体が二重に増減しない
- 初期は固定シングル価格で運用し、自動価格はプレイヤーの表示価格を変えないshadow modeに留める

### G3: PvP Closed Beta

状態: 未着手

主な範囲: P3

player-visible exit conditions:

- 招待URLまたは6文字コードで非公開ルームへ入り、対戦、リロード復帰、結果/BP確定まで完走できる
- 相手と観戦者に手札、山札順、個体IDが漏れず、同じ注文や報酬の再送でも二重取得が起きない
- スマホ2台またはスマホ/PC間で、招待、Ready、対戦、切断復帰、再戦を実機確認できる

### G4: Public Online Beta

状態: 未着手

主な範囲: P4、問い合わせ/告知の最小運用。P2の価格shadow検証を継続する

player-visible exit conditions:

- 無料公開URLへスマホ/PCから入り、デュエルスペースでNPCとプレイヤーを同じレイヤーから選べる
- クイック対戦前に`待機者なし/相手が待機中`が分かり、低人口でも共通キューから対戦できる
- ゲーム内から問い合わせ/意見を送り、障害、混雑、メンテナンス、機能停止理由を確認できる
- 運営がマッチング、ショップを個別に停止しても、所持カードと進行中取引を壊さない

### G5: Community Release

状態: 未着手

主な範囲: P5

player-visible exit conditions:

- CHオープンチャットを利用でき、不快な相手を即時block/reportして以後の表示を止められる
- 観戦者には両者の手札を隠し、遅延を伴う公開情報だけで試合を観戦できる
- 通報の確認、証跡保全、警告/停止/解除、異議申立てを運営が一貫して処理できる
- 運営がチャットと公開観戦を個別に停止しても、対戦と所持データを壊さない

### G6: Tournament Release

状態: 未着手

主な範囲: P6

player-visible exit conditions:

- 時刻指定または即時大会へ参加し、3〜8人のBYEを含む組合せ、Ready、各回戦、結果、報酬を完走できる
- 募集締切、check-in、開始時刻、次の対戦時刻、不成立理由が参加前後に分かる
- 切断、no-show、同着、運営停止が発生してもbracketと報酬を二重確定しない

### G7: Trade Release

状態: 未着手

主な範囲: P7

player-visible exit conditions:

- NPC交換とプレイヤー間の構造化交換を利用でき、同時accept、取消、期限切れでもカードを失わない
- 使用中、match lock中、凍結中の個体を交換できず、成立前に受取内容と警告が分かる
- 交換を停止してもescrow中の個体を安全に返却または確定できる

### G8: Live Operations

状態: 未着手

主な範囲: P8と継続運用。十分なshadowデータがある場合だけ動的シングル価格を段階開放する

player-visible exit conditions:

- フリールールと`LATEST_N`を選べ、禁止/制限改定後も保存デッキの違反理由と使える場所が分かる
- シングル価格を動的にする場合、更新時刻と現在価格が明確で、異常時は固定価格へ安全に戻せる
- 新弾、翻訳、NPCシナリオ、formatを既存対戦や過去replayを壊さず追加できる

## 1. タスク管理の使い分け

- 設計書: 何を、なぜ作るかの正本
- RaccTerm: 現在の`done/doing`、次に着手する項目、G0〜G8の進捗の正本
- GitHub Issue: 着手時に作る1つの実装/検証単位と、完了後の永続記録
- GitHub Project: 複数担当/Issue運用へ移行する時の候補。現時点では状態の正本にしない
- Pull Request: コード差分と検証結果
- Milestone: 公開可能なまとまり

GitHub Projectへ移行する場合は、RaccTermから一度だけ未完了項目を移し、この文書で正本切替日を
宣言する。両方の状態を手作業で同期し続けない。移行後の推奨列:

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
- 新しい表示文言、イベント、カード表示値をlocale非依存の識別子と分離し、日本語fallbackを検証

PvP、経済、認証、チャットは、正常系のデモだけでDoneにしない。再送、並行処理、切断、
複数タブ、権限不正、運営停止を受入条件へ含める。

## 3. 依存関係

```text
P0 ルール/版管理
  └─ P1 サーバー権威NPC縦切り
       ├─ P2 所持/BP/ショップ
       │    ├─ P3 ルームPvP
       │    │    └─ P4 デュエルスペース/クイック
       │    │         ├─ P5 チャット/観戦/制裁運用
       │    │         └─ P6 トーナメント
       │    └─ P7 交換
       └─ P8 最新N弾/禁止制限
```

P5のコミュニティガイドライン、通報画面、管理設計は早く始められるが、公開チャット自体は
認証、運営admin、監査ログ、kill switchが揃うまで開放しない。

## 4. Milestone P0: ルールと版管理

### OLG-001 公式ルールv0.11と現行検証器を同期

状態: 完了（2026-07-29、`546f39c`）

検証: 2026-07-29にengine 114 tests、Web production build、未公開データ漏洩検査を通過

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

状態: 完了（2026-07-29、`546f39c`）

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

### OLG-003P 本番カード公開パイプラインを有効化

状態: **未完了**。OLG-003のコード実装とは分離した本番運用タスク

- 非公開リポへworkflowとtrusted scriptsを同期し、実行ファイルmodeを確認
- 対象弾の非公開`effects/volN.ts`と`effects/volN.test.ts`を用意
- 最小権限の`PUBLIC_PUBLISH_TOKEN`、`GITHUB_PRIVATE_TOKEN`、`GITHUB_PUBLIC_TOKEN`を設定
- Cloudflare Access cookieをSameSite=Laxへ設定し、管理画面をproduction branchへ再デプロイ
- 管理画面からのpublish、Actions status表示、公開commit、WIP cleanupを実対象で確認
- 失敗を注入し、再試行時に公開二重commit、WIP消失、資格情報/未公開値のログ漏洩がないことを確認
- 旧`GITHUB_TOKEN`をrevokeし、設定値と復旧手順を運用台帳へ記録

受入:

- 本番管理画面から1回の操作で、manifestに固定した対象だけが公開側1commitへ反映される
- 公開側remoteの一致を確認した後だけWIPがcleanupされ、失敗時は同じrequestを安全に再開できる
- 公開後のカード、画像、効果を公開ゲームで確認でき、非対象のWIPは公開物とActions logへ出ない

### OLG-004 version付きformatとデッキ合法性

状態: 完了（2026-07-29）

- `FREE_V1`
- `EXACT_CAPACITY_3`
- `MAIN_DECK_LIMIT_ONLY`
- formatの保存/読込/検証
- 保存時、参加時、試合開始前の検証API

実装:

- `data/formats.json`をフォーマット版マスタにし、`formatId`＋`version`で1つの版を表す。
  公開済みの版は書き換えず新しい`version`を足す（進行中試合とリプレイが開始時の版を参照し続けるため）
- `engine/src/formats.ts`: 読込(`ALL_FORMATS`)、検証(`validateFormat`)、保存(`serializeFormat`)、
  版検索(`formatByVersionId` / `latestFormat` / `formatVersionsOf`)、
  有効期間判定(`isFormatActiveAt`。現在時刻はエンジン外から渡す)
- `engine/src/deckLegality.ts`: 判定本体`checkDeckLegality`と、
  保存時`checkDeckForSave` / 参加時`checkDeckForJoin` / 試合開始前`checkDeckForMatchStart`。
  3つの入口は必ず同じ関数へ委譲し、I/Oも現在時刻も持たない純粋関数
- 違反はコード付き（`DECK_SIZE`、`MAX_COPIES`、`CHARACTER_SLOTS`、`BANNED_CARD`等9種）で返し、
  日本語メッセージは既存のまま。Web/管理画面はengine経由で同じ判定を共用する
- `createBattle`に`format`を追加し、試合開始直前の検証を同じ関数へ寄せた
- 意味がルール文書で未定義の設定は黙って無視せず読込時に落とす
  （`setPolicy: LATEST_N`の数え方、`restrictedOracleIds`の上限枚数。どちらもP8で確定させる）

受入:

- 合法・非合法の両方、フォーマット版違い（`deckSize` 40/30、`maxCopies` 4/3）、
  境界値（39/40/41枚、同名4枚/5枚、キャラ2枠/3枠/4枠、有効期間の初日と最終日）を検証
- 既存デッキJSONと共有ログv1の値は変えない（`printingId`のまま。判定の同名集計だけ`oracleId`）
- `deckProblems`の出力は旧実装と完全一致（サンプル・プリセット・変異デッキ計3,400通りで差分0）

検証: 2026-07-29にengine 177 tests（+63）、npm test 251件、engine/admin typecheck、
Web/Admin production build、未公開データ漏洩検査を通過

未解決（P8へ持ち越し）:

- 最新N弾フォーマットのNの数え方（公開日基準か弾番号基準か）
- 制限カードで何枚まで入れられるか

### OLG-005 engine/content/format versionを固定

状態: 完了（2026-07-29）

- replay header
- 不変content manifest
- state hash
- 旧版保持方針
- golden replay

実装:

- `engine/src/versions.ts`: `ENGINE_VERSION`と不変content manifest。
  公開済みカードと公開済み弾だけから版を作る（制作中カードの指紋・枚数を公開ビルドへ載せず、
  制作中の修正で公開中の試合の版が動かないようにするため）。
  `Object.freeze`で凍らせ、進行中の試合が参照している版を後から書き換えられないようにした
- 版の指紋は環境非依存の純粋実装（キー順を固定したJSON＋FNV-1a 64bit）。
  ブラウザとサーバーで同じ値になる必要があるため`node:crypto`を使わない。
  改ざん検知ではなく同一性判定であり、公開物の完全性はOLG-003のGit blob SHAが担保する
- `engine/src/replay.ts`: 設計11.4が求めるreplay headerを実装。
  seed、engine/content/format version、初期デッキsnapshot、先攻、ターン上限、
  全command、各command後のstate hash、終了理由を記録する
- state hashはルール上の盤面だけを対象にし、`log`/`events`とその通し番号を含めない。
  演出や文言の修正で決定論検査が落ちると、本当のルール変更に気づけなくなるため
- golden replay（`engine/test/golden/replay.json`）を固定。
  作り直しは`npm --workspace engine run golden:update`で意図的に行う
- 旧版保持方針を`REPLAY_RETENTION_POLICY`と`replayCompatibility`として実装。
  engine/content/formatのどれか1つでも違うリプレイは`exact`以外を返し、今の版で流し直さない

受入:

- 記録した全61手を流し直し、各手のstate hashが一致することをgolden replayで検査
- 1手でも書き換えると、その手番号を示して検査が落ちる
- 同じ入力から毎回まったく同じ記録になる。seedが違えば結果も違う
- 先攻をseedのコイントスで決めた試合も、ターン上限で引き分けた試合も再生できる
- engine版/content版/format版のいずれかが違うリプレイは`exact`にならない

検証: 2026-07-29にengine 205 tests（+28）、npm test 279件、engine/admin typecheck、
Web/Admin production build、未公開データ漏洩検査を通過

補足（P1で扱う）:

- 「seedと完全ログは試合終了までプレイヤーへ渡さない」（設計11.4）はサーバー側の配信制御。
  エンジンは入れ物と検査だけを持つ
- `createBattle`は先攻を省略したときだけ乱数を1つ引くため、同じseedでも
  「省略」と「明示」で山札の並びが変わる。replay headerへ`firstPlayerFromSeed`として記録し、
  再生時は記録時と同じ呼び方を再現する

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

### OLG-208 NPC固定買取と期待売却額検査

- 売却したカード個体を削除せず、プレイヤーから運営NPCへ移転して追記型台帳へ残す
- `printingId`とレアリティから固定買取価格を引き、カード移転とBP付与を1取引として扱う
- 初回無償starterの`onboarding_bound`、match lock中、交換escrow中の個体は売却不可
- 売却前に個体、受取BP、最後の1枚、高レア、使用不能になるデッキと不足枚数を表示
- β初期値として、NPC買取によるBP発行は1アカウント150 BP/日、
  同一Oracle 4個体/日を上限にし、設定値として変更可能にする
- 150 BPパックの期待買取総額を通常45〜55 BP、保証を含む上限60 BP以下、
  1200 BP starterの全売却額を600 BP以下にする自動検査
- どの購入物も、購入直後に全売却してBPが増えないことを版付き排出表ごとに検査

### OLG-209 NPC有限在庫と基準販売価格

- NPC在庫は`printingId`単位で管理し、需要集計は同じ性能を表す`oracleId`単位で行う
- プレイヤーが売った実在個体を在庫へ加え、購入時は在庫内の1個体を自動割当てして移転する
- シングル購入による新規個体発行は行わず、在庫0なら購入不可とし、
  固定価格期は「売り切れ/在庫不足・カード買取中」を表示
- 開始時、新弾時、承認済み安全在庫補充だけ`SYSTEM_SEED` batchを実行でき、
  理由/承認者/期間・弾ごとの発行hard capを監査する
- 目標在庫の2倍を超えた実個体はarchiveし、日次更新時に不足分だけ販売在庫へ戻す
- 同一Printingはまとめて表示し、MVPでは個体番号指定購入、価格チャート、オークションを実装しない
- NPCからの成立購入は同一Oracle・1アカウントにつき直近7日5個体までとし、
  pack等を含む総所持数そのものには上限を設けない
- 基準販売/買取価格と目標在庫の初期値を版付き設定にし、コード変更なしで調整可能にする

| レアリティ | 基準販売 | 固定買取 | 目標在庫 |
|---|---:|---:|---:|
| C | 15 BP | 4 BP | 12 |
| UC | 30 BP | 8 BP | 10 |
| R | 60 BP | 14 BP | 8 |
| SR | 120 BP | 28 BP | 6 |
| SSR | 240 BP | 50 BP | 4 |
| USR | 360 BP | 80 BP | 2 |
| LSR | 480 BP | 110 BP | 1 |

### OLG-210 atomic quote/order

- 購入quoteは`printingId`、単価、数量、観測時在庫数、期限、価格versionを返すが、
  個体を予約/固定しない。売却quoteだけ対象`instanceId`を固定する
- 購入実行時、観測後に在庫が変わっていても同じPrintingが数量分あればFIFOで割り当てる
- `orderId/idempotencyKey`、quote期限、価格versionを検証し、BP、個体所有者、NPC在庫、
  台帳、注文結果を1トランザクションで確定する
- 同一Oracleの直近7日購入数は`accountId + oracleId`のguard行を`FOR UPDATE`して直列化し、
  lock取得後にDBから1回だけ採った時刻の直前168時間に`settledAt`が入る購入order itemから
  `READ COMMITTED`で再検査する。transaction開始時刻、古いsnapshot、クライアント時計は使わない
- 最後の1個体を並行購入しても成功は1件だけ。同じ注文の再送は同じ結果を返す
- 期限切れ、在庫不足、価格version変更、残高不足、個体lockでは何も部分更新せず、再見積り理由を返す
- 応答前に注文結果を保存し、リロード後に購入/売却結果と新残高を再表示する

### OLG-211 NPCシングル売買UIと運用telemetry

- ショップに`買う/売る`、在庫、現在価格、不足カード、在庫不足時の買取導線を設ける
- 固定価格期は「在庫不足・カード買取中」、G8の動的価格期は実際に買取価格が基準を
  上回る時だけ「買取強化中」と表示する
- デッキ不足警告から該当シングルへ移動でき、売却後は不足デッキを使用不可として理由を表示
- スマホは片手で確認と確定ができ、PCではカード詳細と在庫を同時表示する
- quote失効、売り切れ、上限到達、lock中、kill switch中をそれぞれ異なる文言で表示する
- quote、成立、拒否理由、在庫推移、ユニーク購入者/売却者を個人情報なしで計測する

### OLG-212 固定価格raw集計と価格policy承認

- 表示/成立価格を固定したまま、Printing在庫とOracle別の適格な成立売買をraw集計する
- 同一人物の反復を水増しせず、アカウント保護/チュートリアル/作成7日等を満たす
  qualified unique購入者/売却者だけを需要集計へ含める
- rawレビュー後に、在庫/需要factor関数、14日標本、標本下限、整数丸め、clamp順を
  `pricing_policy_version`として承認する。承認前は候補価格を計算しない
- 初期標本下限はOracleごとのqualified unique購入者/売却者の和集合20アカウントとし、
  未満なら在庫補正を含め価格を動かさない
- 勝率、デッキ採用率、個人属性は価格入力に使わない

### OLG-213 承認済みpolicyのshadow計算とreview

- 実価格は固定のまま、承認済みpolicyによる候補価格を毎日04:00 JSTに計算する
- 計算順を`基準×factor`→基準80〜120% clamp→前日±5% clamp→承認済み丸め→経済検査に固定
- 最低14日、原則2〜4週間、固定価格とshadow価格、成立数、売り切れ時間、BP流入出、
  不正候補、clamp発生を比較する
- 同じ入力snapshotとpolicy versionから同じ価格を再計算でき、運営画面で差分と根拠を確認できる
- Phase 2では候補価格を表示/quote/注文へ適用せず、動的価格feature flagをONにできない

P2 exit:

> 初回starter選択 → 対戦でBP獲得 → 5枚pack開封 → カード一覧/デッキ編集 →
> NPCの有限在庫から固定価格でシングル購入/売却 → リロード後も同じ残高/所持

を完走し、並行操作や再送でもBPとカード個体が増減しない。G2 Collection Closed Betaは
固定価格＋raw集計で開始し、承認済みpolicyのshadowまでをP2とする。実価格への適用はG8まで禁止する。

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
- OLG-406 ゲーム内問い合わせ/意見フォーム、受付ID、最小返信導線
- OLG-407 障害/混雑/メンテナンス/feature停止の状態表示

## 9. Milestone P5: ソーシャル、観戦、制裁運用

- OLG-500 コミュニティガイドライン/年齢帯方針/保持期間
- OLG-501 CH chat/rate limit/content filter
- OLG-502 block/report/evidence snapshot
- OLG-503 moderation admin/audit/kill switch
- OLG-504 quick 30秒/tournament 60秒spectator delay
- OLG-505 制裁通知/異議申立てと問い合わせadminの統合
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

P8 Live Operations:

- OLG-800 `LATEST_N`、禁止/制限改定、format別queue/tournament
- OLG-801 新弾のstaging検証、段階公開、rollback、過去content保持
- OLG-802 locale key、日本語fallback、翻訳QA、欠落文言検査
- OLG-803 NPCシナリオ/解放グラフ/報酬contentの版管理
- OLG-804 SLO、監視/alert、backup/restore、障害/rollback訓練
- OLG-805 reviewed shadowを対象弾/レアリティ単位で動的価格へactivationし、kill switchを訓練
- OLG-806 旧format replayと進行中match/tournamentの互換保持

## 12. 最初に着手する順

完了済み: OLG-001、OLG-002、OLG-003

直近:

1. OLG-003Pで本番カード公開パイプラインを有効化し、運用上のFoundation blockerを外す
2. OLG-004でversion付きformatと、保存/参加/試合開始前のデッキ合法性を統一する
3. OLG-005でengine/content/format version、state hash、golden replayを固定する
4. OLG-006で現行文書、全8プリセット、starter候補を同期する
5. G0 Foundationのplayer-visible exit conditionsをproduction smoke testで確認する

その後:

6. OLG-101〜105、OLG-111〜114、OLG-121〜128、OLG-131〜134を縦に通し、
   ゲストNPC戦とreload復帰を完成させてG1 Internal Alphaへ進む
7. P2は台帳/個体/packを先に作り、NPCシングルは固定価格→有限在庫→atomic order→
   raw集計→policy承認→shadowの順で開き、
   収集loopを完走できたらG2 Collection Closed Betaへ進む
8. P3の非公開ルームPvPを2台の実機で完走できたらG3 PvP Closed Betaへ進む
9. P4のデュエルスペース/クイックと問い合わせ/告知の最小運用を揃えてG4 Public Online Betaへ進む
10. P5の制裁運用、通報・block、CH chat、公開観戦を限定開放から検証し、
    G5 Community Releaseへ進む
11. P6大会をG6 Tournament Release、P7交換をG7 Trade Releaseとして別々に開放する
12. P8 format拡張、新弾/翻訳、監視復旧と、検証済み範囲の動的シングル価格を
    G8 Live Operationsとして継続運用する

各Gateで得た実測値を次Gateの初期値へ反映する。特に動的価格、公開チャット、交換、大会は、
コード完成を理由に一括開放せず、shadow/限定CH/feature flagから始める。
