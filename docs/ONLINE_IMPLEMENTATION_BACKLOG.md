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

状態: **進行中**。OLG-001〜006は完了。OLG-003P（本番カード公開パイプラインの有効化）は
git側まで完了、Cloudflare側（社長のトークン設定・再デプロイ・実smoke test）が未完了で、
G0を終える前に必ず片付ける。P0 exit reviewは依頼済み（Cloudflare側は対象外）。

主な範囲: P0とカード公開運用

player-visible exit conditions:

- 現在公開中のブラウザゲーム、既存デッキJSON、共有ログが移行前と同じように使える
- 選択中のformatと違反理由が表示され、保存時と対戦開始時で合法性判定が一致する
- 公開済みの試合は、固定されたengine/content/format versionから同じ結果を再現できる
- 非公開の新弾を本番管理画面から安全に公開し、カード一覧、デッキ編集、NPC戦へ同じ内容が反映される
- 公開失敗時に制作中カードが消えず、未公開カード、画像、資格情報が公開物やログへ漏れない

### G1: Internal Alpha

状態: **基盤実装中**。OLG-101は完了。OLG-102とOLG-111はコード実装済みで、
Docker互換ランタイム上のSupabase実stack受入を待っている。

主な範囲: P1

player-visible exit conditions:

- ゲストとして開始し、サーバー権威のNPC戦を最初から最後まで遊べる
- バトル中にリロードまたは一時切断しても、同じ試合と操作待ちへ復帰できる
- LINE/Google等へ連携すると、NPC進行、デッキ、進行中試合が失われずアカウントを保護できる
- スマホ縦持ちとPCの共通バトル盤面で、勝敗、時間切れ、再接続理由を理解できる
- 改変した勝敗/報酬payload、期限切れsession、重複command、古いrevision、複数タブ競合、
  match未参加者の直接API要求をE2Eで拒否し、不正な結果/BP/所有行が0件

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
- 相手と観戦者に手札、山札順、所持個体ID（global `instance_id`）とhidden zoneの`battleCardId`が漏れず、
  同じ注文や報酬の再送でも二重取得が起きない。相手playerには公開zoneのtarget識別用`battleCardId`を見せるが、
  spectatorは別projectionで全`battleCardId`を省くかviewer-scoped aliasへ変換する
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
- blockの即時反映、report受付番号、制裁/異議申立て状態を本人が確認できる
- fixture 20件を証跡欠落0件で処理し、公開運営時間内の初回確認24時間、
  重大alert 5分、全体停止訓練5分以内を達成する
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
- NPC購入後168時間以内の個体を交換できず、複数アカウントの即時集約を検知/停止できる
- 交換を停止してもescrow中の個体を安全に返却または確定できる

### G8: Live Operations

状態: 未着手

主な範囲: P8と継続運用。十分なshadowデータがある場合だけ動的シングル価格を段階開放する

player-visible exit conditions:

- フリールールと`LATEST_N`を選べ、禁止/制限改定後も保存デッキの違反理由と使える場所が分かる
- シングル価格を動的にする場合、更新時刻と現在価格が明確で、異常時はlast-good価格へ凍結できる
- G4後の標本条件、approved policy/review、復旧訓練を欠くscopeはDB activationで拒否される
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

状態: 完了（基礎ルール/3枠検証は`03229ce`、v0.11とOracle対応の最終同期は`546f39c`）

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

状態: **一部完了（git側）**。OLG-003のコード実装とは分離した本番運用タスク。
残りはCloudflare側の設定・再デプロイ・実smoke testで、社長のトークン発行待ち。

- [x] 非公開リポへworkflowとtrusted scriptsを同期し、実行ファイルmodeを確認
  （2026-07-30実測: 内容一致、`decode-webp-sandbox.sh`は`100755`）
- [x] `PUBLIC_PUBLISH_TOKEN`を設定（2026-07-29）
- [x] テストバッチとして対象弾の非公開`effects/vol2.ts`と`effects/vol2.test.ts`を3枚ぶん用意
  （クラシックカウンター/骸集め/帯電。commit `191fbef`）。公開リポのengineへ一時配置し、
  `npm test`（vol2分4件・engine全体229件）と型検査がgreenであることを確認済み。
  **vol2は全33枚中3枚のみ**で、残り30枚の実装は別項目（本チェックリストには含めない）
  - 2026-07-30追記: 上記の型検査は`c89ece9`（効果API追加7メソッド）以後は落ちる状態だった
    （testのmock EffectApiが7メソッド未網羅）。`46fb3b6`でmockを補完し、
    公開エンジンへ再配置してengine 229 tests＋型検査greenを再確認済み
- [ ] **GitHub Actionsの課金を修理（社長）**: 2026-07-30の失敗注入smoke 2本
  （run `30505556395` / `30505576941`）が、job起動前に
  「recent account payments have failed or your spending limit needs to be increased」で
  停止した。GitHubのBilling & plansで支払いとspending limitを直すまで、
  非公開リポのActionsは一切動かない（本パイプライン全体のblocker）
- [ ] `GITHUB_PRIVATE_TOKEN`、`GITHUB_PUBLIC_TOKEN`を設定（社長のCloudflare作業）
- [ ] Cloudflare Access cookieをSameSite=Laxへ設定し、管理画面をproduction branchへ再デプロイ
- [ ] 管理画面からのpublish、Actions status表示、公開commit、WIP cleanupを実対象で確認
- [ ] 失敗を注入し、再試行時に公開二重commit、WIP消失、資格情報/未公開値のログ漏洩がないことを確認
  （2026-07-30に不正入力／lock無しの2本をdispatch済みだが課金blockでjob未起動。
  課金修理後に再実行し、入力ゲート即失敗・prepare安全失敗・公開リポ無変更・
  ログに未公開値が出ないことを確認する）
- [ ] 旧`GITHUB_TOKEN`をrevokeし、設定値と復旧手順を運用台帳へ記録

受入:

- 本番管理画面から1回の操作で、manifestに固定した対象だけが公開側1commitへ反映される
- 公開側remoteの一致を確認した後だけWIPがcleanupされ、失敗時は同じrequestを安全に再開できる
- 公開後のカード、画像、効果を公開ゲームで確認でき、非対象のWIPは公開物とActions logへ出ない

#### 残作業計画（2026-07-30）

緑（成功）smokeの成立条件。パイプラインは弾単位の全量公開で、部分公開はできない
（manifestが`cards/volN.json`の全カードと全画像の一致を要求し、公開候補側では
`sets.test.ts`が「効果文のある公開カード全部に実装があること」を検査するため）:

1. vol2全33枚のoracle確定（現状は全て仮Oracle扱いで公開ゲートが拒否する）
2. 効果文のある29枚全部の効果実装（テストバッチ3枚のみ実装済み）
3. 全33枚の画像（現状揃っている）
4. 管理画面（Pages Functions）からのpublishing lock発行（Cloudflare設定後）

したがって緑smokeは「vol2を実際に公開する時」にしか通らない。G0の間は失敗系smoke
2本（不正入力・lock無し）までをOLG-003Pの検証範囲とし、緑smokeはvol2公開の
リハーサルとして扱う。緑smokeを先行させたい場合は、公開しても実害のないテスト弾を
作って本番へ公開する判断（社長）が必要になる。

vol2効果の残り26枚のバッチ計画（本項目では着手しない。実装時に別項目を切る）:

- **バッチ2（既存APIで実装可能・11枚）**: 2-A002, 2-A003, 2-A010, 2-A013, 2-A018,
  2-A022, 2-A025, 2-A026, 2-A027, 2-A028, 2-A031。`c89ece9`の追加7メソッド
  （teamAttrCount / myHp / amActor / reduceDamage / discardMyAp / consumeAp /
  destroySelfEquipment）と既存フックで表現できる。「〜して良い」系（2-A010）は
  アニマ（1-A006）と同じくAI自動判断＋turnStartAction相当の任意発動で扱う
- **バッチ3（engineへ新フックが必要・15枚）**: 2-A001, 2-A004, 2-A006, 2-A007,
  2-A008, 2-A009, 2-A014, 2-A015, 2-A016, 2-A017, 2-A020, 2-A021, 2-A023,
  2-A024, 2-A030。必要な新フックは、常時被ダメ軽減（2-A001）、相手アクター交代時
  トリガ（2-A014）、自身戦闘不能時トリガ（2-A007）、スキル使用可否の制約
  （2-A008と2-A024の使用条件）、相手スキルコスト修正（2-A006）、控えからの攻撃
  （2-A004, 2-A015, 2-A030）、フィールドのターン終了処理と属性条件コスト
  （2-A020, 2-A021）、任意発動の装備トラッシュ（2-A016）、アクターになった時の
  任意変更（2-A017）、属性スキル使用時トリガ（2-A009）、味方全体の被ダメ参照
  （2-A023）
- 効果文が空の4枚（2-A005, 2-A011, 2-A012, 2-A019）は実装不要
- 新フックはバトルの進行結果を変えるため、設計時にOLG-005のstate hash・
  golden replayとの整合を確認し、`ENGINE_VERSION`を上げる

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

- seedと完全ログはlive/terminal player wireで常時非公開とする（設計11.3〜11.4）。将来replay endpointで
  公開する場合だけ別policy / schemaを使う。エンジンは入れ物と検査だけを持つ
- `createBattle`は先攻を省略したときだけ乱数を1つ引くため、同じseedでも
  「省略」と「明示」で山札の並びが変わる。replay headerへ`firstPlayerFromSeed`として記録し、
  再生時は記録時と同じ呼び方を再現する

### OLG-006 現行文書とgolden deckを同期

状態: 完了（2026-07-29）

- 全8プリセット
- starter候補
- `README.md`, `STATE.md`, β要件の現行/履歴区分
- stale comment検査

実装:

- スタンダードデッキ8種を`engine/test/golden/decks.json`へgolden deckとして固定し、
  中身が1枚でも変われば落ちるようにした。作り直しは`npm --workspace engine run golden:decks`で意図的に行う
- 8種すべてが`FREE_V1@1`で合法・キャラ枠3枠ちょうど・全カードが公開カタログに存在することを検査
- 初回スターターの候補4種を`data/starters.json`へ登録（設計6.3の「初期は4種類程度」）。
  中身はプリセットから引くのでカード一覧を二重に持たない。片方が古くなるのを防ぐため
- 「1個で合法デッキを作れる個体数を含める」（設計6.3）を`checkStarter`で検査。
  場と40枚側で同じカードを使う分も個体数へ合算する
- `scripts/check-stale-comments.mjs`で古くなった記述を検査し、`npm test`へ組み込んだ。
  実在しないファイルへの参照、古い決定が残った言い回し、READMEのnpmコマンドの3種類を見る
- 当時のまま残す履歴は、見出しの`stale-ok`で現行の記述と区別する。
  `STATE.md`を「今の状態」と「開発の記録（履歴）」に分け、読み方を先頭へ書いた。
  `GAME_RULES.md`の決定・変更の記録と、取り消された50枚デッキの実験記録も履歴として明示した
- `README.md`を今の構成（admin/scripts/ops、formats.json、starters.json、検査コマンド）へ更新

受入:

- プリセット8種の中身・名前・コンセプトがgolden deckと完全一致し、崩れたらテストが落ちる
- スターター候補4種は遊び方が全部違い、大型キャラクター（2枠）を使わない
- 候補は`candidate`のままで、採決前は配布に使わない
- 検査器自身のテストで、行印・節印・雛形・テストファイル除外の動きを固定
- リポジトリ全体（140ファイル）に古くなった記述が0件

検証: 2026-07-31にengine 225 tests、stale検査 17 tests、npm test 349件、
engine/admin typecheck、Web/Admin production build、未公開データ漏洩検査を通過

要確認（社長の採決待ち）:

- スターター候補4種（剣聖の一閃／聖歌隊／氷獄の女王／槍衾の陣）の採否。
  攻め・守り・妨害・手数で選び分けられることと、大型キャラを含まないことを基準に選んだ。
  採決後に`status`を`released`へ変える

## 5. Milestone P1: オンライン縦切り

### Epic OLG-100 環境とserver基盤

#### OLG-101 `server`, `protocol`, `supabase` workspace scaffold

状態: **完了**（2026-08-01）

G1 Internal Alphaの土台。設計: `docs/ONLINE_SERVICE_DESIGN_2026-07-29.md` 10.7

- **範囲はローカルの雛形だけ**。実在のCloudflareリソース・Supabase project・secretは作らない
  （それらはOLG-102〜105）。OLG-101の完了だけでは何も稼働しない
- `server`/`protocol`を`@bravers/server`/`@bravers/protocol`として`engine`/`web`/`admin`と
  同じ形のnpm workspaceにし、ルート`package.json`の`workspaces`へ追加する
- `protocol`は中身を埋めない（browser向けCommand/Event/Snapshotの実型はOLG-122/123/124）。workspaceとして
  解決できることをプレースホルダ型1つ・テスト1本で示すだけ
- `supabase/`はnpm workspaceにしない。`supabase init`相当の`config.toml`だけを置き、
  マイグレーション（PostgreSQL正本）は`server/migrations/`に置く（10.4のリポジトリ構成案どおり。
  `supabase/migrations` symlinkからCLIへ接続し、ORMは使わず生SQL。理由は10.7）
- ルート`npm test`へ`server`/`protocol`のworkspace testを追加する

受入:

- `npm --workspace server run test` / `npm --workspace protocol run test`が通る
  （中身はプレースホルダでよい。ビルド設定・型検査が通ることが目的）
- ルート`npm test`が`server`/`protocol`を含めて全部緑
- `supabase/`の`config.toml`と`supabase/migrations -> ../server/migrations`があり、
  Supabase CLIがプロジェクトとして認識する
- 実在のCloudflareリソース、実在のSupabase project、実在のsecretを一切作っていない

検証: clean `npm ci`後にroot `npm test`、protocol/server各1 test＋typecheck、engine 225 tests、
web 1 test、admin 47 tests、Web/Admin build、`check:leak`、`check:stale`がgreen。
`npx supabase --workdir . --debug status`で正本configの読込みとDocker不存在での安全停止、
migration symlinkの実体一致を確認。
Docker/local stack起動とmigration適用はOLG-102で行う。

#### OLG-102 local Supabase/Worker/DO

状態: **実装済み・実stack受入待ち**（2026-08-01）

OLG-101の雛形を、外部resource/secretを使わずローカルで実際に起動する。

- Node.js 22を`.nvmrc`と`engines`で固定。Supabase CLI 2.111.0、Wrangler 4.118.0を
  root/serverのdev dependencyとして固定し、グローバルCLIへ依存しない
- Workers test poolが要求するVitest 4.1.10へtest runnerを統一する。Web/Adminのunit testは専用configを
  使い、production build用Vite 5/React pluginの設定をVitest内蔵Viteへ読み込ませない
- `MatchDO`は宣言的Durable Object exportとSQLite storageを使い、WebSocket Hibernation APIで
  疎通確認用socketを受ける。内部action型はOLG-123、Command envelope型はOLG-122で実装済み。
  Event / Snapshotの永続化はOLG-125、ゲーム本体のbrowser wire公開はOLG-124で完了済み
- `GET /health`はWorkerだけで成功にせず、health専用MatchDOを呼び、DO SQLiteの`SELECT 1`まで確認する
- `npm run dev:online`はlocal Supabaseの状態確認→必要なら起動→`migration up --local`→
  status/migration確認→pgTAP DB受入→Wrangler local起動の順に行う。Supabase CLIの`--workdir`は
  `supabase/`の親であるproject rootへ固定する。SIGINT/SIGTERM/失敗時は、スクリプト自身が
  起動したSupabase/Workerだけを停止し、先に動いていたローカルstackは止めない
- `npm run smoke:online`はhealthとWebSocket `probe`応答まで自動検証して終了する。
  `--worker-only`はコンテナランタイムがない環境でもWorker/MatchDOだけを診断する
- repo単位lockでSupabaseの二重操作を拒否し、Worker portの事前占有検査と起動run ID照合で
  別processへの誤疎通を拒否する。各health requestにも期限を設け、応答しないportで停止し続けない
- Supabaseの`status`が明示的なnot-runningの場合だけ起動し、それ以外の非0は既存stackへ触れず
  fail closedする。`supabase start`の起動結果はlocal secret keyを含むためconsoleへteeしない。
  停止timeout/nonzeroを含むcleanup失敗は、元の失敗とまとめて報告する

受入:

- `npm run smoke:online -- --worker-only`で実Wrangler/workerdのhealth、MatchDO、DO SQLite、
  WebSocket upgradeと起動run ID照合がgreen。Vitest Workers poolではDOを強制evictionした後の
  同一WebSocket `probe`もgreen
- 使用中port、ready前child exitと敗者待機のabort、応答しないhealth、二重lock、status曖昧失敗、
  start途中失敗/競合借用、起動途中signal/正常終了、cleanup失敗集約、WebSocket二重完了/timeoutを含む
  起動ライフサイクル24 testがgreen
- clean `npm ci`後のroot全test、Web/Admin build、engine/admin/functions型検査、
  `check:leak`、`check:stale`がgreen。production dependencyの既知auditは0
- 実在のCloudflareリソース、Supabase project、secretを一切作っていない
- **残り**: Docker互換ランタイムを起動したMacで`npm run smoke:online`を実行し、
  migrationのlocal適用とpgTAP受入まで確認する。ここを通すまでOLG-102をdoneにしない

- OLG-103 development/staging/production bindings（実在のCloudflare/Supabase project作成を含む。
  社長のアカウント・課金判断が要る）
- OLG-104 migration CIとenvironment marker
- OLG-105 production昇格workflow

### Epic OLG-110 アカウント

#### OLG-111 server-side guest account

状態: **実装済み・実stack受入待ち**（2026-08-01）

- Supabase Authのanonymous sign-inをlocalで有効化し、manual linkingはOLG-112まで無効のままにする
- `auth.users.id`と同じUUIDを主キーにした`public.account`をAFTER INSERT triggerで作る。
  FKは`ON DELETE CASCADE`、triggerは空`search_path`の`SECURITY DEFINER`とし、失敗を握り潰さない
- migration適用前の既存Auth userは`auth.users`を短時間lockしてbackfillし、backfillとtrigger作成の
  隙間に作成されたuserが1:1不変条件から漏れないようにする
- `account`はRLSを有効化し、`anon`/`authenticated`のData API権限とpolicyを置かない。
  `service_role`もこのrootではSELECTだけに絞る
- Worker内部providerだけがSupabaseのaccess/refresh tokenを受け取る。remote環境はHTTPS・
  `sb_secret`・信頼済みclient IP転送を必須とし、曖昧なnetwork/5xx/壊れた成功応答は
  **安全に再試行できない**失敗として返す
- OLG-111では`POST /auth/guest`を公開しない。OLG-113がgrantをserver-side sessionへ収容し、
  opaque HttpOnly cookieを同時に発行できる段階でrouteを開く。`account_id`単体は認証情報にしない

受入:

- provider unit 15件（成功、captcha、remote credential/IP、429/5xx/network、pre-abort、
  request/body timeout、壊れた応答、秘密非露出）とmigration静的guard 5件がgreen
- `server/test/db/guest_accounts.test.sql`のpgTAP 27項目でPK/FK/CASCADE、RLS/実効権限、
  trigger定義、同一UUID作成、trigger失敗時のAuth/account同時rollbackを検査する
- `npm run smoke:online`ではGoTrueへ実際にanonymous sign-inし、同一UUIDのaccount行、
  匿名clientの直接read拒否、admin削除時cascadeまで検査してtest userを後始末する
- live smokeの各requestとpgTAPは期限付き。SIGINT/SIGTERM後もIDを取得済みのtest user削除と
  cascade確認が終わるまでSupabaseを停止しない
- 残余リスク: signupがserverでcommit後に応答ごと失われるとIDを知れず、local test userを
  その実行内で特定・削除できない。この場合はsmokeをfailさせ自動再試行しない。本番routeは
  OLG-113で監査可能な作成requestとopaque session発行を一つのserver-side flowとして扱う
- **残り**: Docker互換ランタイム上で上記migration・pgTAP・GoTrue live smokeを実行する。
  ここを通すまでOLG-111をdoneにしない

- OLG-112 LINE/Google linking

#### OLG-113 secure session/seat token

状態: **コード実装済み・実stack受入待ち**（2026-08-01）

- 10分TTLのHttpOnly bootstrap cookieとDB上のclaim/leaseを先に作り、同一guest作成の並行実行、
  signup応答喪失、Set-Cookie応答喪失から別accountを自動作成しない
- Auth user metadataの内部`attempt_id`をtriggerでclaim台帳へ結び、signup成功grantはAES-GCMで
  app sessionへ暗号化保存する。DBにはsession/bootstrap raw値でなくversion付きHMAC digestだけを置く
- 本番session cookieは`__Host-bd_session; Path=/; HttpOnly; Secure; SameSite=Lax`、Domainなし。
  local HTTPは弱い属性の本番名を使わず別名にし、Auth応答は`private, no-store`とする
- unsafe APIはexact Origin、same-origin Fetch Metadata、JSON、固定headerをDB/Authより先に検査。
  TurnstileはSupabase Authへ一度だけ渡し、remote client IPはCloudflare由来だけを転送する
- MatchDOにserver-owned seat assignmentと30秒・一回限りのseat token portを置く。
  OLG-121でserver生成NPC予約とassignmentを接続済み。client指定のmatch/seatでは発行せず、
  SessionCoordinatorの参加台帳をpositive確認できない要求はMatchDO取得前に拒否する
- WebSocketはOrigin/sessionを検証後にupgradeし、最初の5秒以内のauth frameでtokenを原子的に消費。
  認証完了前はgame payloadを送らず、attachmentへraw tokenを残さない
- logoutはsession単位の`SessionCoordinatorDO`へHMAC digest付きintentと復旧alarmを同一transactionで
  先に保存する。その後DBでsession versionを上げ、関連MatchDOへversion付きinvalidateを送り全ACKを待つ。
  WorkerがDB更新の前後で停止してもcoordinatorのalarmがDB失効→fan-outを冪等再開する。DOの
  single-thread順序でinvalidate後のcommandを拒否し、新規接続/再接続はDB versionをfail closedで
  検査する。各commandのDB照会だけをlogoutとの排他制御には使わない
- 初期sliceはHMAC/AES鍵のactive+retained keyringまでとし、online credential回転は未実装。
  回転時は`PENDING`→最初のresolveで昇格する二段階方式等で応答順逆転を安全にする

受入:

- Cookie属性、期限/失効401、重複cookie、CSRF先行拒否、秘密非露出が自動テストで固定される
- 同一bootstrapの並行guest作成でsignupは1回。曖昧結果から別accountを自動作成せず、
  補償削除とcascadeを確認できた時だけ再試行可能になる
- 非参加、別match/seat、期限切れ、改変、再利用tokenを拒否し、同一tokenの並行consumeは1件だけ成功する
- seat tokenなしの通常WebSocketは拒否する。`APP_ENV=local`の`local-smoke`だけは
  SupabaseなしのOLG-102診断用例外として残す。この診断経路は16 KiB frameゲート（OLG-124）を
  経由しないため、`APP_ENV`が本番環境で`'local'`になり得ないことをWrangler環境変数側
  （`wrangler.jsonc`の named environment分離・secrets管理）でデプロイ前に確認する
  ［TODO: G2以降の本番デプロイ設定時にチェック］
- public match portはOLG-121でNPC開始だけを開き、`POST /matches/npc`のserver予約から到達させる。
  任意match IDからDurable Objectを作れず、MatchDO URLとnamed DO identityも完全一致を必須にする
- assignmentごとの一意なregistration IDを持ち、seat置換では旧session参照をversion＋ID完全一致で
  解除する。遅延した古い解除で新参照を消さず、fan-outはmatch IDで重複排除する。同一matchの応答喪失中
  IDはcoordinator側で8件まで。MatchDOはregister RPC前のpendingをseatごと1件に制限し、
  pending削除＋assignment反映＋旧ID cleanup outbox＋alarmを同一transactionで確定する。exact再送は
  mutating再登録をせずread-only barrierで失効floorとexact参照を確認する。解除の応答喪失は
  SQLite queue＋上限60秒backoff alarmから新stubで1件ずつ回収する。coordinatorは取消済みIDを
  O(1)の`cancelledThroughEpochMs` floorへ世代圧縮し、別stubの遅延registerを復活させない。MatchDOは
  永続clockで`max(Date.now(), last+1, cancelledThrough+1)`を次epochにし、時計逆行と同ms衝突から回復する。
  正常終了・取消・放棄はOLG-121でSQLite終端確定→exact参照解除→予約解放の二段outboxへ接続し、
  最大16件を通算対戦数ではなく進行中MatchDO数の上限にする
- Docker互換ランタイム上でGoTrue→Worker cookie→session復元→logout→401とDB pgTAPを完走する

- OLG-114 active session/複数タブ制御

### OLG-115 招待コードの発行と受け口

状態: 設計完了・実装未着手（2026-07-29）。純粋ロジックのみ`scripts/invites.mjs`で先行実装

- G2 Collection Closed Betaの入口。設計: `docs/ONLINE_SERVICE_DESIGN_2026-07-29.md` 8.6
- `admin_batch`（運営発行・wave上限つき）と`referral`（招待済みアカウントが2枠を友人へ）の2種類
- コード消費は行ロック下のトランザクションで検証・加算し、`NOT_FOUND`/`REVOKED`/`EXPIRED`/
  `EXHAUSTED`/`SELF_REDEEM`/`ALREADY_INVITED`を判定する
- 誰が誰を招いたかを`invite_redemption`（`issued_by` → `redeemed_by`）へ記録する
- `referral`コードの発行は外部ID連携（アカウント保護）完了まで遅らせ、
  使い捨てゲストによる無限増殖を防ぐ
- 取り消し（`revoked`）は既に成立した消費を取り消さない

受入:

- `max_uses`を超える消費は成立しない（並行消費でも1件だけ成立）
- 自分のコードは自分で消費できない。1アカウントは生涯1回しか招待コードを消費できない
  （**別々のコードを並行消費した場合でも成立は1回**。コード行のロックだけでは守れないため、
  `invite_redemption.redeemed_by`のUNIQUE制約で担保する: 8.6.4）
- 期限切れ・取り消し済みのコードは消費できない
- `admin_batch`はwaveの計画人数を超えて発行できない
- `referral`の2枠発行は1アカウント生涯1回だけ（使い切ったかどうかに関わらず再発行しない）で、
  発行は消費イベントではなく外部ID連携完了イベントから行う

依存:

- コード生成・受理判定・状態遷移の純粋ロジックは`server/`workspaceが無くても実装・検証できる
  （`scripts/invites.mjs`）。行ロック・DB永続化・API化はOLG-101（server/protocol/supabaseの
  workspace scaffold）の後で`server/src/auth/`または`server/src/economy/`へ移す
- G2公開前に、招待予定人数に合わせてNPC買取hard capを更新すること（6.6 / MARKETING-001必須手順）

### OLG-116 休眠ゲストの保持・定期削除

状態: 設計要件登録・実装未着手（G4 Public Online Beta公開前ゲート）

- Supabase anonymous userは自動削除されないため、定期cleanup jobを運営側で持つ
- 初期値は`last_active_at`から90日。ゲスト開始とスターター受取前に日本語で明示し、
  保護済みaccountは対象外にする。`auth.users.created_at`だけで削除判定しない
- candidateを小さなbatchでlockし、匿名状態、最終活動、active session、進行中バトル、
  外部ID連携中でないことを削除直前に再検査する。曖昧な場合はfail closedで残す
- dry-run、batch上限、kill switch、対象/削除/除外件数の監査、活動更新との競合テスを
  揃えてから一般公開する

### Epic OLG-120 MatchDO

- OLG-121 engine server adapter（server-owned assignment directoryと、正常終了・取消・放棄後の
  SessionCoordinator参照解除を含む）— **コード実装済み（2026-08-01）**
- OLG-122 `commandId + expectedRevision` — **コード実装済み（2026-08-01）**
- OLG-123 stable `battleCardId` — **コード実装済み（2026-08-01）**
- OLG-124 player projection — **コード実装済み（2026-08-02）**
- OLG-125 snapshot/event persistence — **コード実装済み（2026-08-02）**
- OLG-126 reconnect/resume — **コード実装済み（2026-08-02）**
- OLG-127 timeout/disconnect（PvP標準クロック・切断との関係・レート反映の設計: 11.5）
- OLG-128 authoritative NPC tutorial E2E（NPC戦は無制限＋idle suspendの設計: 4.1）
- OLG-129 battle start idempotency tombstone（終端後まで極端に遅延した旧開始要求と新規開始を区別。
  G1では受容残余とし、G4 public前にbounded tombstoneまたはIdempotency-Keyで閉じる）

#### OLG-129 battle start idempotency tombstone

実装契約を次で固定する。

- `POST /matches/npc` は `Idempotency-Key`（ASCII 1〜64文字、先頭英数字、session/account束縛）を必須とし、
  bodyはexact `{}` のまま。キー無し/形式不正/要求不一致は開始前に400で拒否する
- SessionCoordinatorのactive reservationへキーを保存し、同一キーの応答喪失再送は同じmatch/seedへ収束する
- terminal解放時はキー・matchId・releasedAtのtombstoneを24時間、最大16件保持する。期限切れから削除し、
  16件すべて有効なら古いキーを捨てず503 + Retry-Afterで新規開始を待たせる
- tombstone一致の再送はMatchDOを再度startせず、保存済みmatchIdを200で返す。TTL満了後だけ新規開始になる
- 成功/終端結果は保存し、一時障害は保存しない。異なるsession/accountのキー空間を混同しない

受入テスト: 応答喪失の同時再送、active中の同一キー、terminal後の遅延旧キー、異なるキーの新規開始、
TTL境界、16件上限、古いキーの再利用、異なるsession/account、MatchDOを二重起動しないことを固定する。

#### OLG-121 engine server adapter

状態: **コード実装済み**（2026-08-01）

- engine package rootの公開APIだけを使う`EngineBattleAdapter`をserverに置き、G1固定デッキ・
  server生成uint32 seedから決定論的にNPC戦を開始する。server sourceからengine deep/relative importを
  行うとAST境界テストが失敗する
- `POST /matches/npc`はexact `{}`だけを受け、SessionCoordinatorがsessionごとに`npc-<UUID>`とseedを
  一件予約する。同時実行と通常の応答喪失再送は同じ予約へ収束し、responseはmatch IDだけを返す
- seat token / WebSocketはDB session解決→Coordinator membership positive確認→MatchDO取得の順。
  client指定のmatch ID / seat / deck / seed / engine・content・format versionからDOを作らない
- MatchDO SQLiteへ`provisioning / active / finished / cancelled / abandoned`を保存する。正常終了では
  engine結果を、取消・放棄では理由を先に確定し、token/assignmentを削除する。pending/verifying socketは
  保存済み認証deadlineからalarmで閉じる。authenticated socketはOLG-124でterminal projection送信後に閉じる
- 終端後の外部cleanupは、登録済みなら`unregisterMatch`→`releaseNpcMatch`、登録前取消なら
  `releaseNpcMatch`だけを別outbox＋alarmで再試行する。応答喪失、追加参照、古いreleaseと新予約の競合、
  旧seat cleanupとの同居で新しい予約・参照を消さない
- logout失効とbattle操作はMatchDO内の同じFIFOで順序づけ、失効が先ならstart再送・action・tokenを拒否する。
  engine上の終了後にSQLite commitだけ失敗しても、start再送・cancelはfinishedを優先して再永続化する

受入:

- 改変actionと版不一致を盤面不変で拒否し、合法actionだけをNPC応答まで適用できる
- NPC戦を最後まで決定論的に進め、勝敗をSQLiteへ保存してからassignmentと予約を解除できる
- OLG-125完了後のactive DO evictionは保存履歴から同じruntime / revision / receiptへ復旧する。
  改変・sequence gap・版不一致はseedから再生成せずfail closed。terminal lifecycle/resultもeviction後に読める
- authoritative snapshot / seed / deck / engine-native actionは内部RPCだけで扱う。browser WebSocketは
  OLG-124のexact player projection / command updateだけを公開する

残余:

- active runtime・action stream、battleCardId台帳、revision / command receiptの再構築はOLG-125、
  player projectionとterminal配信後closeはOLG-124で完了
- terminal解放後まで極端に遅延した旧`POST /matches/npc`は新規開始と区別できないためOLG-129へ送る
- logout失効後にactive lifecycleを自動終端する条件は、NPC idle suspendを扱うOLG-127で固定する
- MatchDOのbattle lifecycle / terminal outboxは後続機能追加時に別moduleへ分割する

#### OLG-122 commandId + expectedRevision

状態: **コード実装済み**（2026-08-01）

- protocolに`cmd_` + lowercase 32 hexのbranded `MatchCommandId`、初期0の`MatchRevision`、
  exact `MatchCommandEnvelope`、秘匿情報を含まないaccepted / rejected receiptを固定した。
  wire receiptはACK-onlyとし、authoritative transition / events / lifecycleを絶対に含めない。
  `parseMatchAction`もprotocolをruntime decoderの唯一の正本にし、adapterはこれを再利用する
- revisionはengine step数でなく、player actionと後続NPC pump全体を1 transactionとして成功ごとに1増やす。
  reject / duplicateでは変えず、adapterのhuman step数と毎回照合してdriftをfail closedにする
- payloadはdomain、match ID、認証済みseat、expected revision、actionのbounded canonical JSONと
  SHA-256へ束縛する。同じID・同じpayloadは成功／domain拒否とも初回結果をclone replayし、
  同じIDでaction / revision / seatが違う場合だけ`MATCH_COMMAND_ID_CONFLICT`と初回recordの
  `originalRevision`を返す（現在revisionは返さない）。canonicalの
  深さ・node・配列・object key・文字列・総byte上限はdecode後の値へ適用し、sparse arrayや非JSON値を拒否する
- MatchDOのFIFO内で本人・session・seat確認→duplicate→revision→action schema / rules→applyの順に処理する。
  stale / aheadは待機させず`MATCH_REVISION_MISMATCH`、不正actionは`MATCH_ACTION_INVALID`で固定する
- 台帳は全2,048件のうち拒否receiptを最大512件に制限し、残りをaccepted用に予約する。拒否spamで
  accepted commandまで永久に塞がず、上限後の未記録拒否はstate / revision不変でfail closedにする
- terminalを成立させたcommandはreceipt / revisionを最初のawait前に記録する。terminal SQLite commitが
  一度失敗しても、同一再送はactionを再適用せずcommitだけを再試行し、元の成功応答へ収束する

受入:

- 同一commandの逐次・並行再送でactionが1回だけ適用され、応答とrevisionが同じ
- 同一revisionの別commandはFIFOで片方だけ成功し、もう片方はstale拒否で盤面不変
- 同一IDのpayload衝突、stale / ahead、schema / rules違反を区別し、exact再送は後のstateでも同じ結果
- 1 commandでNPCが複数step動いてもrevisionは1だけ進み、最終手のACK喪失でも二重適用しない
- authoritative transition / events / lifecycle / snapshot / seed / opponent情報を共有protocol receiptへ
  一切含めない。OLG-124の`matchCommandUpdate`でもreceipt自体はACK-onlyのままprojectionと型責務を分ける
- 台帳を拒否receipt上限まで埋めてもaccepted用容量が残り、sparse array等の別payloadが同一identityにならない

完了した後続:

- OLG-125で全2,048 record・拒否最大512 recordの台帳をSQLiteへ移し、active DO eviction後もexact receiptと
  runtime / revisionを復旧する。cloneした次状態、canonical payload / SHA-256 digest、seat、成功／拒否／finalの
  ACK-only receipt、stable steps / events、current snapshot、terminal lifecycle、cleanup outbox / deadlineは
  同一SQLite transactionへcommitしてからruntimeをswapする。transaction失敗ではtrialを破棄し、commit後の
  DO reset / ACK喪失では保存済みreceiptへ収束する
- OLG-124は保存済みreceiptと同revision以上のviewer projectionを単一exact update frameで配信する。
  terminal frame送信後・close後のcutpointも検査する
- OLG-124はJSON.parse前にraw WebSocket frameを16 KiBで止め、decode後にcanonical上限を適用する。
  viewer projectionはauthoritative snapshotを削るのでなくallowlistから構築する

#### OLG-123 stable battleCardId

状態: **コード実装済み**（2026-08-01）

- protocolに`bc_` + lowercase 32 hexのbranded `BattleCardId`とexact `MatchAction` unionを置いた。
  card actionはID必須、旧`handIndex`と余剰keyを受けない
- MatchDOで試合を作るたび、engine seedとは独立したCSPRNGから全カード個体へ128-bit IDを割り当てる。
  重複printingも別IDで、形式違反・衝突は試合開始前にfail closedにする
- engineは公開APIとしてカードのmove / deck swap traceを返す。server adapterは全zone台帳へtraceを
  同じtrial内で適用し、ID / owner / printing / 枚数 / zone順がengine stateと一致した時だけcommitする。
  engine-native state、state hash、replay v1、既存`BattleAction`は変更しない
- client由来actionは現在の行動者handだけからIDを解決する。未知・stale・他owner・非hand IDは
  `BATTLE_ACTION_INVALID`で盤面不変に拒否し、NPC action logもstable IDへ変換する
- NPC先攻pump前の`initialBattleCards` + `initialIdentityHash`をimmutable manifestとしてsnapshotへ持つ。
  `restoreFromHistory`はCSPRNG再採番・自動NPC pumpなしでstable stepsを現在handへ順次解決し、
  state / identity hashとeventsを毎手照合する。engine action / `handIndex`は履歴へ保存しない

受入:

- 同seedのengine state / 結果は同じまま、別試合のbattleCardIdは一致しない
- 重複printing、search shuffle、hand→AP、equipment / field、効果失敗rollbackを個体単位で追跡できる
- 手札先頭を移動してindexが詰まった後も、保存済みIDが同じ個体へ当たる
- 初期manifestとstable stepsから同一runtimeを再演でき、初期ID / hash / step改変をfail closedにできる
- golden replayを含むengine testとadapter / MatchDO境界testがgreen

残余:

- OLG-125 v1はheader / 初期manifest / stable steps / current snapshotを同一transactionへ保存し、初期から
  全stepを再演してcurrent checkpointと照合する。開始時のadapter / engine / content / format版へpinし、
  一致runtime不在時は現行版で再生せずfail closedにする。周期checkpoint + tail再演は、版付きrestore APIと
  全再演監査を維持したまま履歴上限到達前に入れる将来最適化
- G2の所持個体連携はOLG-200で、lock済みinstance poolと初期printing配置を1対1照合して
  server-only `battleCardId → instance_id`対応表を作る。キラ等の表示属性以外は同printingで同値とする
- opponent hand / deckのIDとprintingをwireから隠すprojectionはOLG-124で完了
- browser向けgame frameはOLG-124のexact decoder / viewer projectionで開いた

#### OLG-124 player projection

状態: **コード実装済み**（2026-08-02）

- protocol v1へ`MatchPlayerProjection`、clientの`matchCommand`、初期/currentの`matchProjection`、
  command応答の`matchCommandUpdate { receipt, projection }`を追加し、nested fieldまでexact decodeする
- projectionはallowlistだけから新規構築する。自分handだけ`battleCardId + printingId`、相手handはcount、
  両deck/APはcount、trash / character / equipment / field / pending attack / 公開効果状態は公開する。
  seed / rng / raw state / raw event / header / hash / hidden ID / global instance IDは型として持たない
- 公開効果状態は`skillsUsedThisTurn / nextSkillCostDelta / nextDrawDelta / actorLockUntilTurn /
  incomingDamageReduction / chargedThisTurn / suppressRotate`までをv1 allowlistとする。hidden effectを足す時は
  このlistへ暗黙追加せずprojection versionを上げる。seedはlive/terminal wireで常時非公開とし、将来の
  replay endpointで公開する場合も別policy・別schemaにする
- 認証・session失効・seatをframe decodeより先に検査する。raw入力はJSON.parse前のUTF-8 16 KiB、
  candidate decode後は既存canonical 4 KiB等、server出力はexact decode後128 KiBでfail closedにする
- 認証直後はcurrent projection、command後は保存receiptとcurrent projectionを単一update frameで返す。
  同じviewerの別tabにはprojectionだけを送り、相手seatやspectatorへ転送しない
- 通常決着・取消・放棄はterminal projectionを送ってから対象authenticated socketを
  `1000 / MATCH_ENDED`で閉じる。terminal後の未知commandは台帳を増やさず、既存socketのexact再送だけ
  保存receiptへ収束する。外部Coordinator cleanupは引き続きalarm-only

受入:

- viewer/hand visibility/terminal/resultをexact decodeし、相手hand/deck/APのID・printing canary、
  seed/hash/raw event等の禁止keyがwireへ0件であることを両viewerで検査する
- ASCII / multi-byte / ArrayBufferの16 KiB入力境界と128 KiB出力境界、canonical超過、壊れたframeを
  commandId未消費で拒否する
- auth直後、accepted / rejected / duplicate / conflict、terminal ACK喪失相当、複数tab、cancel/abandon、
  terminal send/close後のDO再生成を実WebSocket＋SQLite件数で検査する

完了した後続:

- OLG-126で`GET /me/active-match`、認証session所有権によるreceipt/result read、viewer-visible event delta、
  `lastEventSequence` / snapshot fallbackを実装した。projection v2の`eventSequence`はraw event数でなく
  stable step単位のviewer batch cursorになり、hidden eventの増減からgapを推測できない

残余:

- G3のOLG-301/302は2 seatそれぞれでprojectionを再生成し、同一viewer用frameを相手へ流さないことを実機検査する。
  NPC専用の`abandoned { winner: 1 }`も、離脱seatと勝者を両向きに表せるterminal unionへversion upする
- 自分deckの順不同multiset / AP内容はv1では非対応（両者countのみ）。必要なUIと秘匿条件を決めて版付き追加する

#### OLG-125 snapshot/event persistence

状態: **コード実装済み**（2026-08-02）

- `match_battle_manifest`へheader・初期card manifest / hash・初期event数、`match_battle_state`へrevision・
  各count・current state / battleCards / hash、`match_battle_command`へcanonical / digest / seat / exact receipt、
  `match_battle_step`へstable step、`match_battle_event`へ初期＋各step eventを保存する
- start activationはmanifest / initial event / step / state / lifecycle、accepted commandはreceipt / step / event /
  current stateと必要なterminal lifecycle / outbox / deadline、rejected commandはreceipt / countをそれぞれ
  同一transactionで確定する。外部Coordinator cleanupはcommit後のalarmだけが実行する
- constructorはrow数と16 MiB総量をJSON materialize前に検査し、sequence・exact schema・canonical / digest・
  revision / human step・state / identity hash・assignment・terminal release/deadlineを照合する。activeは
  初期manifestから全stepを再演し、current checkpointと完全一致した場合だけmemoryへinstallする

受入:

- activation / accepted / rejected / finalのtransaction途中失敗は全行rollbackし、同じ入力で一組だけ生成する
- commit前後の明示cutpointは`ctx.abort()`でDO resetし、request終了後evictionから同じreceipt / revision /
  盤面 / resultへ収束してcommand・human step・eventを二重追加しない
- command digest、step gap、revision、current hash、receipt schema、cleanup outbox/deadlineの改変は実constructorで
  繰り返しfail closedとし、seedから新しいIDを再生成しない

完了した後続:

- OLG-126で認証session所有権を照合するactive-match / receipt / result readとevent差分resumeを公開した

残余:

- 周期checkpoint + tail再演は、版付きrestore APIと全再演監査を保つ将来の性能最適化

#### OLG-126 reconnect/resume

状態: **コード実装済み**（2026-08-02）

- protocolをplayer projection v2 / viewer event v1へ上げた。`eventSequence`はraw engine event件数ではなく、
  永続化済みstable step 1件につき1増えるviewer batch cursorとする。相手のhidden eventしかないstepも
  `events: []`のbatchを残すため、秘匿eventの有無・件数はcursor gapへ現れない
- raw `BattleEvent`はwireへ出さない。公開eventは型で閉じたallowlistへ変換し、相手のhand charge/search、
  `info.text`、ability label、未公開card IDをdropする。projectionとdeltaは同じviewer向けに毎回再生成する
- 最初のWebSocket authは旧`{ type, seatToken }`と、version付き
  `{ type, seatToken, resume: { projectionVersion: 2, viewerEventVersion: 1, lastEventSequence } }`だけを受理する。
  旧authはcurrent snapshot、resumeは最大128 batchの連続deltaを返す。current cursorは空delta、ahead / 128超の
  gapはsnapshotへ収束し、deltaが128 KiB frameを超える場合も`delta_too_large` snapshotへ切り替える
- `GET /me/active-match`、`GET /matches/:matchId/commands/:commandId/receipt`、
  `GET /matches/:matchId/result`を追加した。opaque session、same-origin Fetch Metadata、固定client headerを検査し、
  全応答を`private, no-store`にする。client指定match IDからMatchDOを先に作らず、SessionCoordinatorの
  active / recent ownershipがpositiveになった後だけstubを解決する
- terminal cleanup後はSessionCoordinatorへsessionごと最大1件のrecent ownershipを90日保持する。
  releaseの応答喪失は同じ`released`へ収束し、新しいNPC戦の予約、logout、session invalidationで古いrecordを消す。
  terminalではseat token / socketを再発行せず、保存済みACK-only receiptと公開resultだけをHTTPで読ませる

受入:

- legacy初期接続、current / 1 batch前 / ahead / gap cursor、DO eviction後の新seat token再接続と次commandを検査する
- raw event数がstable step cursorへ影響しないこと、両viewerのhidden canary差分がbyte単位で同一になること、
  hidden-only空batchがexact decoderを通ることを検査する
- ACK喪失後のreceipt、terminal cleanup・DO eviction後のresult、期限切れ・失効・別account / match拒否を検査する

残余:

- 「試合に戻る」表示と自動接続はOLG-133、未送信commandの端末outboxはOLG-132が担う
- 匿名accountを外部IDへlinkした後も同じmatch ownershipを保つrebindはOLG-112で、G3の両seat / spectator cursorは
  OLG-301/302でversion付きに拡張する

### Epic OLG-130 PWA shell

- OLG-131 manifest/installable shell
- OLG-132 IndexedDB draft/outbox
- OLG-133 active-match recovery UX（2026-08-02コード実装済み）:
  relative same-origin active-match → memory-only seat token → version付きresume → authoritative projection盤面を
  1タップで接続する。cursorだけをsessionStorageへ保存し、二重操作・stale callback・不正frame・terminal直行を
  Web testで固定する。static CPUβのfresh 404は非表示、開発時はVite same-origin proxyを使う
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
- account/Oracle/営業日guardで並行売却を直列化し、DBのJST 04:00境界で4個体を再集計する
- global日次予算行→account日次予算行の順にlockし、hard capと150 BP/日の両方を再検査する
- 150 BPパックの期待買取総額を`NORMAL`45〜55 BP、`NORMAL`/`PITY`各stateの
  条件付き期待清算額と天井cycleの1pack平均を60 BP以下、
  1200 BP starterの全売却額を600 BP以下にする自動検査
- `pack_definition`へ全draw state、条件付き確率、天井counter遷移/resetを定義し、
  高レア単発の実現値と期待値を混同せず版付き分布から検査する

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
- P7前にNPC購入個体へ168時間の交換lockを付け、複数アカウントからの即時集約を拒否する
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
- 全市場注文をaccount guardで直列化し、lock順をaccount guard→方向別limit→
  global budget→account budget→
  Printing別stock guard昇順→wallet→instance ID昇順に固定する
- 購入/売却/seed/archiveはPrinting別stock guardを共有する。購入はguard取得後にFIFO個体を
  `LIMIT quantity FOR UPDATE`で全量再取得し、lock競合だけによる偽の在庫不足を出さない
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
- 在庫0で拒否したqualified購入quoteを同一account/Oracle/営業日1回まで未充足需要として別集計し、
  policyでweight/capを明示する。初期weightは0
- 勝率、デッキ採用率、個人属性は価格入力に使わない
- factor上下、clamp、丸め、標本不足、未充足需要capのgolden inputを承認条件にする

### OLG-213 承認済みpolicyのshadow計算とreview

- 実価格は固定のまま、承認済みpolicyによる候補価格を毎日04:00 JSTに計算する
- 計算順を`基準×factor`→基準80〜120% clamp→前日±5% clamp→承認済み丸め→経済検査に固定
- 最低14日、原則2〜4週間、固定価格とshadow価格、成立数、売り切れ時間、BP流入出、
  不正候補、clamp発生を比較する
- G8合格用windowはG4開放後の実データだけで14日連続とし、対象Oracleごとに
  qualified unique和集合20、購入者5、売却者5、成立営業日5を初期下限にする
- policy version変更時は連続日数をresetし、下限未達Oracleは固定価格scopeに残す
- 同じ入力snapshotとpolicy versionから同じ価格を再計算でき、運営画面で差分と根拠を確認できる
- Phase 2では候補価格を表示/quote/注文へ適用せず、動的価格feature flagをONにできない

P2 exit:

> 初回starter選択 → 対戦でBP獲得 → 5枚pack開封 → カード一覧/デッキ編集 →
> NPCの有限在庫から固定価格でシングル購入/売却 → リロード後も同じ残高/所持

を完走し、並行操作や再送でもBPとカード個体が増減しない。G2 Collection Closed Betaは
固定価格＋raw集計で開始し、承認済みpolicyのshadowまでをP2とする。実価格への適用はG8まで禁止する。
G2/G3のshadowは探索用であり、activation合格用windowはG4開放後に改めて計測する。

## 7. Milestone P3: ルームPvP

- OLG-300 招待URL/6文字code
- OLG-301 2人用seat認可＋両seat対応のabandon terminal schema
- OLG-302 2 seat / 2端末でOLG-124 projection契約を再検証する漏洩検査
- OLG-303 clock（標準/ゆっくりpreset・設計: 4.3）/reconnect/複数タブ
- OLG-304 共通BPと同一ペア逓減
- OLG-305 招待観戦用spectator projection（player projectionをredact流用せずbattleCardIdも非公開）

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

- OLG-700 NPC recipeと版付き日次/週次更新
- OLG-701 player offer/escrowと最終確認
- OLG-702 parallel accept/expiry/cancelのatomic処理
- OLG-703 trust restriction/GM freeze/補償
- OLG-704 NPC購入個体の168時間交換lock
- OLG-705 複数アカウント集約攻撃、cluster alert、Oracle単位kill switchの運用試験

P8 Live Operations:

- OLG-800 `LATEST_N`、禁止/制限改定、format別queue/tournament
- OLG-801 新弾のstaging検証、段階公開、rollback、過去content保持
- OLG-802 locale key、日本語fallback、翻訳QA、欠落文言検査
- OLG-803 NPCシナリオ/解放グラフ/報酬contentの版管理
- OLG-804 SLO、監視/alert、backup/restore、障害/rollback訓練
- OLG-805 G4後14日連続・標本下限を満たすreviewed shadowだけをOracle allowlist単位で
  DB activationし、last-good凍結/再開とkill switchを訓練
  - G8 server gate、approved policy/review、golden test、経済/台帳検査、復旧訓練を
    transaction内で再検査し、欠けた条件では汎用flagからも有効化できない
  - 更新失敗時はlast-good実価格を凍結し、復旧後の±5% baselineにも使う
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
