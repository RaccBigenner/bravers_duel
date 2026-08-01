# STATE — BRAVER'S DUEL

- 最終更新: 2026-08-02
- フェーズ: G0 FoundationはCloudflare smoke待ち。P1 / G1 Internal AlphaはOLG-133まで進み、
  サーバー権威NPC戦の永続化・秘匿wire・reload後1タップ復帰UIを実装済み。Docker互換ランタイム待ちで
  OLG-102/111/113のSupabase migration・DB/Auth実stack受入が未完


## この文書の読み方

- **今の状態**は「プロジェクトの今」「オンライン基盤の現在地」「進行中のアクション」
  「中断ポイント」「オープンβ要件」「ルール判断状況」に書いてある。ここだけ読めば今が分かる。
- **開発の記録（履歴）**は一番下にまとめてある。当時のまま残しているので、
  今のルールや数字とは違うことがある。今どうなっているかは上の節を見ること。

## プロジェクトの今

- 2026-07-22 に社長 Racc の指示でプロジェクトを仕切り直した。
- 昔の Flutter プロトタイプは全部 `archive/2026-07-22_flutter_prototype/` に保管した（もうさわらない）。
- ゲームルールを言語化して `docs/GAME_RULES.md` にまとめた（v0.11）。**これがルールの唯一の正しい情報源。**
- カードマスターデータは `data/cards.json`、カード画像は `assets/card_images/` にある。
- 新プラットフォームは **TypeScript** に決定（理由: ブラウザβに必須＋同じエンジンで自動対戦テストができる）。
  - `engine/`: ルールエンジン + AI + シミュレーター（vitest でテスト）
  - `web/`: Vite + React のブラウザ画面
  - `protocol/`: ブラウザ/サーバー共有型（command / projection / viewer sync / recovery HTTP DTO）
  - `server/`: サーバー権威API/MatchDOのworkspaceとPostgreSQL migration正本
  - `supabase/`: ローカルCLI設定。migrationはsymlinkで`server/migrations/`へ接続
  - npm workspaces 構成。`npm test`・`npm run sim`・`npm run dev`・`npm run build` が動くことを確認済み。

## オンライン版の最終ゴールと公開ロードマップ

最終ゴールは、日本向けに最適化した無料ブラウザTCGとして、スマホ/PCからライトなアカウントで
始められ、仮想カードショップでNPCとプレイヤーを見つけ、対戦、収集、デッキ編集、BPショップ、
シングル売買、観戦、交流、大会、交換まで継続して遊べる状態。対戦、所持カード個体、BP、報酬は
完全にサーバー権威とし、リロードや一時切断で進行を失わない。初回UIは日本語でも、
表示文言とカード/イベントデータはlocale分離し、多言語を後付けできる構造にする。

公開範囲は、P0〜P8の実装Milestoneとは別に、次のplayer-visible exit conditionで段階判断する。
詳細とIssue順は`docs/ONLINE_IMPLEMENTATION_BACKLOG.md`を正とする。

| Gate | 現在の状態 | プレイヤーから見た完了状態 |
|---|---|---|
| G0 Foundation | **進行中** | 既存ゲーム/デッキを壊さず、formatとversionが固定され、新弾が本番の安全な経路からカード一覧・デッキ・NPC戦へ届く |
| G1 Internal Alpha | **基盤実装中** | ゲスト開始→サーバー権威NPC戦→reload復帰→結果確定→アカウント保護を完走できる |
| G2 Collection Closed Beta | 未着手 | 招待者が無償starter、BP、5枚pack、所持/デッキ、固定価格NPCシングルを完走できる |
| G3 PvP Closed Beta | 未着手 | 招待ルーム戦、再接続、秘匿情報を守る招待観戦を2台の実機で完走できる |
| G4 Public Online Beta | 未着手 | 無料公開でデュエルスペース、待機状況つきクイック、レート、問い合わせを安全に使える |
| G5 Community Release | 未着手 | 制裁運用を伴うCH chat、block/report、秘匿情報を守る公開観戦を開放できる |
| G6 Tournament Release | 未着手 | 時刻指定/即時大会を3〜8人、BYE/no-show込みで安全に完走できる |
| G7 Trade Release | 未着手 | NPC交換とescrow付きプレイヤー交換を、競合や取消でも個体を失わず完走できる |
| G8 Live Operations | 未着手 | `LATEST_N`、新弾/翻訳、監視復旧を継続運用し、検証済みの場合だけ動的シングル価格を開放できる |

## オンライン基盤の現在地（2026-08-02）

- 作業ブランチは `feat/online-foundation`。OLG-001（現行ルール同期）とOLG-002（基準ブランチ統合）は完了。
- **OLG-003でカードIDを二層化**:
  - `oracleId`: ゲーム上の不変な同一性。再録・別言語・別イラストでも共有し、コピー上限と効果解決に使う
  - `printingId`: 収録・レアリティ・画像の単位。従来IDの値を維持し、デッキJSONと共有ログv1もこの値のまま
- 公開カード144枚は両IDへ移行済み。エンジン、Web、管理画面、画像生成ツールを同期した。
- 管理画面は旧WIPを読み取り互換するが、仮Oracleを明示確定するまで公開不可。
  Printing ID変更・一括採番・削除にはvol照合、衝突拒否、同一Git commit、失敗後の冪等再試行を追加した。
- 弾公開はCloudflare Workerで大量画像を処理せず、非公開`bravers_duel_wip`のGitHub Actionsへ委譲する。
  Pages Functionsはカード・弾・効果module・弾固有test・全画像SHAをschema v3 manifestへ固定し、
  `publishing`ロックを作るだけ。
  Actionsは外部取得後にprivate WIPをcheckoutし、対象弾を反映した公開候補copyだけを
  networkなし・資格情報なし・非対象WIPなしのcontainerへmountして全ゲートを通す。
  カード・弾・画像・効果・testを公開側1commit→WIP cleanup 1commitで反映する。
- 本番有効化には、非公開リポへ`ops/bravers_duel_wip/.github/`のworkflow＋trusted scripts 2本を同期、
  対象弾のprivate効果module/testを用意、`PUBLIC_PUBLISH_TOKEN` Actions secret、
  Cloudflareの`GITHUB_PRIVATE_TOKEN`（private write/Actions）と
  `GITHUB_PUBLIC_TOKEN`（public read）を設定して管理画面を再デプロイする必要がある。
- 2026-07-30、git側（社長のCloudflare作業を待たずに進められる範囲）を完了した。
  - workflow・trusted scripts・decoderの実行bit同期は非公開リポで実測確認済み（内容一致・
    `decode-webp-sandbox.sh`が`100755`）
  - `PUBLIC_PUBLISH_TOKEN` Actions secretは設定済み（7/29）
  - 非公開リポの`effects/vol2.ts`/`effects/vol2.test.ts`へ**テストバッチ3枚**
    （クラシックカウンター/骸集め/帯電）を追加（commit `191fbef`）。公開パイプラインが
    想定するファイル形式・相対import・`VOLN_EFFECTS`エクスポートが本物のengineで
    動くことを、公開リポのengineへ一時配置してnpm test（vol2分4件・engine全体229件）と
    型検査で確認済み（確認後は公開リポから削除し、公開物には一切残していない）。
    vol2は全33枚中この3枚だけが実装済みで、**残り30枚は別項目**（OLG-003Pの一部としては数えない、
    後続の「vol2本実装」で行う）
  - 残るのは**Cloudflare側だけ**: `GITHUB_PRIVATE_TOKEN`/`GITHUB_PUBLIC_TOKEN`の発行・設定、
    Access application-domain cookieのSameSite=Lax化、管理画面の本番再デプロイ、
    実Actions公開のsmoke test。ここは社長のCloudflare操作待ち
- 本番有効化作業は、OLG-003のコード完了と分けて`OLG-003P`として登録した。
- OLG-004（version付きformatとデッキ合法性）は完了。`data/formats.json`をフォーマット版マスタにし、
  `formatId`＋`version`で版を固定した（公開済みの版は書き換えず、新しい版を足す）。
  デッキ合法性の判定を`engine/src/deckLegality.ts`の純粋関数へ集約し、
  保存時・参加時・試合開始前の3つの入口が同じ関数を呼ぶ。Web/管理画面もengine経由で同じ判定を使う。
  ルール文書に定義がない設定（最新N弾の数え方、制限カードの上限枚数）は、
  黙って無視せず読込時に落とす。どちらもP8で確定させる。
- OLG-005（engine/content/format versionの固定）は完了。試合ごとに
  engine版・content版・format版・seed・初期デッキ・全手・各手のstate hashを記録するreplay headerを実装し、
  「同じ入力から同じ結果になる」ことをgolden replay（61手）で検査するようにした。
  content版は公開済みカードと公開済み弾だけから作る（制作中カードの情報を公開ビルドへ載せないため）。
  版が1つでも違うリプレイは、今の版で流し直さない。
- OLG-003PはG0 exit前に必ず完了するproduction blockerとして並行管理し、完了順を取り違えない。
- OLG-006（現行文書とgolden deckの同期）は完了。スタンダードデッキ8種をgolden deckとして固定し、
  初回スターターの候補4種を`data/starters.json`へ置いた（採決前なので`candidate`）。
  古くなった記述を機械で落とす検査（`npm run check:stale`）を追加し、
  当時のまま残す履歴は見出しの`stale-ok`で現行の記述と区別する。
- P0 exit reviewのfixは2026-07-30に解消済み。Cloudflare側を除くP0の準備を完了した:
  `npm test`全件・型検査（engine/web/admin）・production build・`check:leak`が全部green
  （直近の実行で確認）。G0 gateはOLG-003PのCloudflare設定・再デプロイ・実Actions smoke testが
  完了するまで閉じない。
- OLG-101（`server`/`protocol`/`supabase` scaffold）は2026-08-01に完了。新しい2 workspaceを
  root testへ配線し、各placeholder test/typecheck、clean `npm ci`、全test/build、leak/stale検査を
  greenにした。Supabase CLIは設定を読め、`supabase/migrations` symlinkから
  `server/migrations/`の空migrationを参照する。Worker/MatchDO/local DBの起動はOLG-102で行う。
- OLG-102は2026-08-01に実装を完了。Node 22、Supabase CLI 2.111.0、Wrangler 4.118.0を固定し、
  `npm run dev:online`でローカルSupabaseの起動確認→migration適用→Wrangler local起動を順番に行う。
  Workerの`GET /health`はMatchDOとDO SQLiteの`SELECT 1`まで検査し、最小WebSocketはHibernation APIで
  強制eviction後も`probe`疎通できる。repo lock、port事前検査、起動run ID照合により別processを
  誤合格せず、起動・migration・疎通の途中を含むSIGINT/SIGTERMでも所有processだけを片付ける。
- Worker/MatchDOの実runtime smoke、起動ライフサイクル24 test、clean `npm ci`、root全test/build、
  engine/admin/functions型検査、
  leak/stale検査はgreen。ゲーム本体のCommand/Event/Snapshotは後続OLGへ意図的に残している。
  このMacにDocker互換ランタイムがないため、Supabaseの実起動とmigration適用を含む
  `npm run smoke:online`だけ受入待ち。外部Cloudflare/Supabaseリソースやsecretは作成していない。
- OLG-111は2026-08-01にコード実装済み。Supabase anonymous Auth userと同じUUIDの
  `public.account`をtriggerで原子的に作り、RLSと権限剥奪でclientのData APIから隠す。
  Worker内部providerはtokenを外へ出さず、remoteではsecret key＋信頼済みIP転送を必須にし、
  曖昧なsignup失敗を自動再試行しない。`POST /auth/guest`とopaque cookieは後続OLG-113で接続済み。
  live smokeはrequest期限と中断後の削除完了待ちを持つ。pgTAP 27項目とGoTrue live smokeは
  `npm run smoke:online`へ配線済みで、Docker起動後の実行待ち。
- OLG-113は2026-08-01にコード実装済み。10分bootstrap claim、opaque HttpOnly session、
  30秒・単一match/seat・一回性seat token、5秒WebSocket auth frameをserver権威で接続した。
  logoutは`SessionCoordinatorDO`へ失効intent＋alarmを原子的に先置きし、DB version更新後に
  関連MatchDOの全ACKを待つ。Worker応答喪失時もDB失効から自動再開する。public match正方向は
  MatchDOのRPC前pending・seat置換cleanup outbox・世代圧縮取消floorで停止/別stub順序逆転も
  fail closedにした。OLG-121でserver-owned NPC予約・assignment・membership barrierまで接続済み。
  root全test、実Worker/DO smokeはgreen。
  残るのはDocker互換ランタイム上のGoTrue→cookie→session復元→logout→401とpgTAP受入。
- OLG-121は2026-08-01にコード実装済み。engine公開APIだけのserver adapter、server生成match ID/seedの
  `POST /matches/npc`、MatchDOのNPC lifecycleを接続した。正常終了・取消・放棄をSQLiteへ先に確定し、
  SessionCoordinatorの参照解除→予約解放を二段outboxで回収する。失効後start/action、改変action、
  改変履歴からのseed再生成はfail closed。OLG-125完了後はactive evictionも保存履歴から復旧する。
  browser game frameはOLG-124のexact player projection / command updateだけを公開する。
  server 246 test、protocol 8 test、server-engine境界5 test、`check-no-wip-leak.mjs`の未公開カード
  leak検査はgreen。OLG-124の秘匿projection検査（JSON.stringifyへ相手hand/deck/seed等のcanary値が
  混入しないことを見る別メカニズム）も同じくgreenだが、両者は検査対象も実装も別物。
- P2へNPCシングル市場を正式登録した。G2 Collection Closed Betaは固定買取/販売、有限な実在個体在庫、
  atomic quote/orderで開始する。固定価格のraw集計からpolicyを承認し、2〜4週間shadow計算する。
  日次±5%・基準80〜120%の動的価格を実注文へ使えるのはG8だけとし、G4以降の標本、
  経済review、復旧訓練を通過した対象へkill switch付きで段階開放する。

## 社長のやりたいことリスト（2026-07-22）

1. バトルのプレイヤーAIと、それによる自動バトルテスト
2. カードバランスの調整
3. カードデザインの調整と、一部カード画像の生成し直し
4. Webブラウザで遊べるオープンβテスト

## 進行中のアクション

- カード一覧ページ完成・公開済み（`web/`）。旧プロトタイプのカードデザインを React で再現し、
  種類・レアリティ・属性・スキル種のフィルター、検索、並び替え（コスト/基本値/HP）、サイズ変更つき。
- **公開URL: https://raccbigenner.github.io/bravers_duel/ **（GitHub Pages）
- GitHub リポジトリ: https://github.com/RaccBigenner/bravers_duel （公開）。
  main に push すると GitHub Actions が自動でテスト→ビルド→デプロイする。
- ローカル確認は `npm run dev` → http://localhost:5173

## 中断ポイント

- 作業ブランチ `feat/online-foundation`。P0のコードを終え、P1（オンライン縦切り）を進めている。
- 完了: OLG-001 / OLG-001A / OLG-002 / OLG-003（カードID二層化）/ OLG-004（版付きフォーマットと
  デッキ合法性）/ OLG-005（engine・content・format versionとreplay header）/ OLG-006（現行文書とgolden deck同期）。
- 未完了: **OLG-003P（本番カード公開パイプラインの有効化）**。git側（workflow/trusted scripts同期・
  テストバッチ3枚のeffects/test）は2026-07-30に完了。残るのはCloudflare側（社長のトークン設定と
  再デプロイ）だけで、G0を終える前に必ず片付ける。
- 完了: **OLG-101**（server/protocol npm workspace、Supabase CLI設定、migration正本の入口）。
- **OLG-102は実装済み・実stack受入待ち**。Worker/MatchDOのhealth・SQLite・WebSocket smokeと
  全検証はgreen。Docker互換ランタイム起動後に`npm run smoke:online`を1回通し、
  Supabase migration/pgTAPまで確認できたら完了にする。
- **OLG-111も実装済み・実stack受入待ち**。同じ`npm run smoke:online`でGoTrue匿名signup、
  同一UUIDのaccount行、直接read拒否、削除cascadeまで通れば完了にする。HTTP routeはOLG-113で接続済み。
- **OLG-113も実装済み・実stack受入待ち**。同じ実stackでguest cookie発行、session復元、logout後401、
  pgTAPを完走したら完了にする。通常matchはOLG-121でserver生成NPC予約からだけ正方向を開いた。
- **OLG-121はコード実装済み**。active runtimeの再起動復旧はOLG-125、
  player projection / terminal配信後closeはOLG-124で完了。終端後まで極端に遅延した旧開始要求の
  区別はOLG-129、logout失効後のactive lifecycle終端条件はOLG-127で固定する。
  OLG-003PのCloudflare作業はG0 blockerとして並行管理する。
- **OLG-123は2026-08-01にコード実装済み**。全カードへseed非依存の128-bit `battleCardId`を割り当て、
  engine移動traceとserver全zone台帳でshuffle・重複printing・zone移動後も個体を保持する。
  protocol / action logから`handIndex`を除き、未知・stale・他owner・非hand IDを盤面不変で拒否する。
  engine state hash / replay v1は不変。NPC pump前の初期ID manifestとstable stepsからCSPRNG再採番なしで
  hash検証付き再演もできる。OLG-125で履歴/current snapshot保存、OLG-124でallowlist秘匿まで完了した。
- **OLG-122は2026-08-01にコード実装済み**。`cmd_` + 128-bit ID、初期revision 0、
  player action＋NPC pump単位の+1、bounded canonical payload＋SHA-256を固定した。同一ID・同一payloadは
  成功／拒否とも初回receiptを返し、別payload・stale / ahead・不正actionは盤面不変で拒否する。
  wire receiptはACK-onlyでtransition / events / lifecycleを絶対に含めない。メモリ台帳は全2,048件のうち
  拒否receiptを最大512件に制限してaccepted用を予約する。最終手のterminal commit失敗も同一再送で
  二重適用しない。DO evictionを跨ぐprepare→SQLite atomic commit→runtime swapはOLG-125、raw frame gateと
  viewer別projectionはOLG-124、terminal ACK喪失後にリロードした新規接続のreceipt / result readはOLG-126で完了。
- **OLG-125は2026-08-02にコード実装済み**。manifest / state / command / step / eventの5表へ初期ID配置、
  current checkpoint、canonical payload / digest・exact receipt、stable step / eventを保存し、関連lifecycle・
  terminal cleanup outbox / deadlineも同じtransactionで確定してからruntimeをswapする。constructorは16 MiBを
  materialize前に制限し、初期manifestから全stepを再演してrevision / state / identity hashと照合する。
  accepted / rejected / finalのrollback、実`ctx.abort()`、request終了後eviction、改変constructor gateを検証済み。
  外部cleanupはalarm-onlyで、projection配信後のauthenticated socket closeはOLG-124で完了。
- **OLG-124は2026-08-02にコード実装済み**。protocol projection v1とnested exact browser frame、
  16 KiB入力/128 KiB出力gate、認証直後のcurrent projection、commandごとの単一receipt+projection update、
  terminal projection送信後の`1000 / MATCH_ENDED` closeを実装した。相手handはcount、両deck/APはcountのみ。
  seed / rng / raw state / event / header / hash / hidden IDは非公開。通常決着・取消・放棄、同一viewer複数tab、
  rejected / duplicate / conflict、raw/canonical上限、ACK喪失相当、terminal send/close後のDO再生成を自動検査する。
  OLG-126でactive-match / receipt-result read / event delta / reload復帰とviewer cursor v2まで完了した。
- **OLG-126は2026-08-02にコード実装済み**。`GET /me/active-match`とsession所有権で守る
  receipt / result GET、version付きWebSocket resumeを追加した。viewer cursorはraw event件数でなくstable step単位で、
  hidden-only stepも空batchとして進む。最大128 batchのdelta、ahead / gap / 128 KiB超のsnapshot fallbackを持つ。
  SessionCoordinatorはterminal cleanup後の所有権をsessionごと1件・90日保持し、新規試合・logout・失効で消す。
  DO eviction後の新seat token再接続・次command、ACK喪失receipt、cleanup後result、別account / match拒否を検証済み。
  **OLG-133も2026-08-02にコード実装済み**。ホームの「試合に戻る」はactive-match正本がある時だけ表示し、
  新seat tokenをmemory内で直ちにversion付きWebSocket resumeへ渡す。`auth_ok`だけでは復帰成功にせず、期待する
  match/seat/cursorのexact projectionを受信して初めてserver projection専用盤面へ移る。mobileはsticky操作、PCは
  同じ盤面の右railへ操作・接続・公開event logを出す。static CPUβのfresh 404は通常ホームのままにする。
  端末の未送信command outboxはOLG-132、同一origin本番配備はOLG-103、実browser縦切りはOLG-128へ続く。
- ここまでの経緯は一番下の「開発の記録」を見る。

## オープンβ要件 決定（2026-07-23）

- 要件は `docs/BETA_REQUIREMENTS.md` に確定版。スマホ縦持ちメイン／敵はスタンダード4デッキ／
  AI1種類／デッキ構築+JSON入出力／ユーザーデータ保持なし／Xシェアボタン。
- **バトル画面v1 完成**（物理TCG風プレイマットUI+演出。ホーム/バトル準備/リザルト込み）。公開済み。
- スキルカード画像108枚の再生成 **完了・公開済み**（水彩アニメ調+ストーリー性。全成功）。
- UI/演出方針（社長指示）: 「物理的にTCGしてるかのように」。カード公開演出・KO裏返り・ダメージポップ等実装済み。

## ルール判断状況

- `docs/GAME_RULES.md` v0.11のオンライン基盤着手を止める未決ルールは0件。
- 場と40枚側へ同じOracleを入れられるが、同じ所持個体は二重割当てできない。

## メモ

- 共通基盤（game-project-init の役職マニュアル・docs 一式・ADR）はまだ入れていない。
  入れるなら /game-init か /migrate を使う。


## 開発の記録（2026-07-22〜27） <!-- stale-ok: 当時の記録をそのまま残す履歴 -->

> **ここから下は履歴です。** 当時の書き方のまま残してあるので、テスト件数・ルール・
> 画面の作りなどは今と違うことがあります。今の状態は上の節を見てください。

### エンジンとバランス調整（2026-07-22）

- バトルエンジン完成（`engine/src/battle.ts`）。テスト48件。AI 2種類（random / simple）と
  自動対戦シミュレーター（`npm run sim`、アーキタイプ総当たり戦）も動く。
- 2026-07-22 追記: **割り込みルール実装済み**。guard は攻撃された時だけ手札から割り込んで使う
  （guardフェーズ。攻撃されている側が行動を選ぶ）。割り込みではアクター交代なし。
- 2026-07-22: **カード効果113枚を実装**（静的レジストリ + 検証付きAPI + スナップショット保護。
  詳細は `docs/balance/2026-07-22_card_effects.md`）。装備・フィールドのルールも決定して実装済み（GAME_RULES v0.5）。
  アニマはAI自動判断で発動（暫定）。ロッソ・ポイントブレイクも実装済み。
  アーキタイプ別サンプルデッキ8種も作成（`engine/src/sampleDecks.ts`、`npm run sim` で総当たり戦）。
  結果: 全滅決着62.9%・先攻勝率50.8%。強すぎ候補=ビコウ（控え無敵）、弱すぎ候補=ジエンド（竜ランプ）。
- 2026-07-22: 残り実装を完了。size ルール決定（**大型はキャラ枠2つ**）、炎霊召喚/風を集めるは完全版
  （デッキから本当に使用）、雷雲召喚は正確版。解釈で実装しているのはオールグレイス・神速剣のみ（記録済み）。
  当時の未決定1件だった「キャラとして選んだカードをデッキ40枚に入れられるか」は、
  2026-07-29に「入れられる。同じ個体の二重使用は不可」で確定した。
- **社長方針**: 山札切れ偏重は認識済み。バランス調整は主に「スキルパワー（数値）」で行う予定。
- 2026-07-22: スキルパワー調整v1を実施。基本値 = (コスト+1)×2、効果持ちは効果の強さ分を割引。
  詳細は `docs/balance/2026-07-22_skill_power.md`（全108枚の調整表と割引基準）。
  効果: 全滅決着 3% → 26%（simpleAI同士500戦）。効果文実装でさらに上がる見込み。
- 最初のシミュレーション結果（効果文なしの状態での参考値）:
  - 決着のほぼ100%が山札切れ。全滅勝ちは3%程度 → 攻撃の基本値だけでは火力不足
  - 「手札を全部チャージする」戦略は山札切れで負けまくる（勝率2.5%）→ チャージ管理がゲームの肝
  - 先攻勝率 59%（ランダムAI同士）→ 後攻AP2枚の補償で大きくは崩れていない
- 発見メモ: 「[魔神素体]グロウ」(1-A014-SR) は属性0個で始まる意図的デザイン。


### 直近の決定（2026-07-22〜23）

- 2026-07-23: **デッキを40枚に戻す**（同名4枚のまま。山札の緊張感を優先する社長判断。
  シム1400戦: 山札切れ決着34.8%・平均15.4ターン）。
- 2026-07-23: バトルUIの絵文字は全廃（アイコンが要る時はLudoで生成する方針）。
- 2026-07-23: **スタンダードデッキ8種をゼロから再設計**（名指し40枚構築。
  剣聖の一閃/魔王の柩/氷獄の女王/竜王の暴食/聖歌隊/疾風の狩団/槍衾の陣/不落の砦）。
  課題: ジエンド（自傷ミル2/T）とアイ（ドロー+1）は40枚環境で構造的に自滅し勝率5-27%。
  カード能力側の調整が社長判断待ち。
- 2026-07-23: **アーキテクチャ刷新**: エンジン→UIは型付きイベントストリーム
  （`engine/src/events.ts`、state.events）で通信。ログの正規表現パースは全廃。
  新しい演出の追加手順: events.tsに型追加 → エンジンでemit → narrator.tsに表示を書く。
  盤面部品は `web/src/battle/BoardParts.tsx`。
- 参考: 50枚時代の検証は `docs/balance/2026-07-22_deck50.md`。`--deckSize`/`--maxCopies` で実験可能。

### 作業ログ（2026-07-23〜27）

- 2026-07-23: バトルUIを大幅強化（ナレーション逐次再生・表示用ステートで状態と演出を同期・
  リボルバー式アクター交代・3Dテーブル・VFX 21種（Ludo生成、属性17+ダメージ/回復/属性追加/ロック）・
  カード拡大プレビュー・まとめチャージ→自動ターンエンド・初心者ガイド+ルールモーダル）。
- 2026-07-23: **デッキ選択画面を刷新**（メインキャラの絵入りデッキタイル）＋
  **カスタムデッキビルダー完成**（キャラ3枠選択・カード+/-・ルール検証・JSON保存/読み込み）＋
  サンプルデッキ生成にコストカーブ制約（低3割/中4.5割/高2.5割）で回りを改善。公開済み。
- 2026-07-23: UX改善: 演出倍速⏩、手札コストチップ、フェーズ表示、誘導強調。
  ホーム/リザルト等のUI刷新。手札は扇レイアウト+固定キーでガタつき解消。
  （WebGLシェーダーVFXは一度入れたが「安っぽい」との社長判断で撤去済み。
  演出はLudo画像VFX+CSSのみで行く）
- 2026-07-23: **公開βのログ収集＋レビュー機能 稼働開始**。匿名ID（localStorage UUID）で
  battle_start / battle_end / custom_deck / review を Google Apps Script 経由で
  スプレッドシート「BRAVERS DUEL ログ」（社長のGoogleドライブ）に自動追記。
  受け皿の再デプロイ手順は `docs/TELEMETRY_SETUP.md`。送信先URLは `web/src/telemetry.ts` の ENDPOINT。
  バトル後に星1〜5+フリーテキスト(1000字)のレビューUIを毎回表示。
  Cookie同意バナーは不要と判断（匿名統計のみ・個人情報なし）。ホームに注記1文あり。
- 2026-07-24: **「敵はランダム」の仕様を明確化**: 自分と同じプリセットは出さない（ミラー防止）。
  「もう一回」でも毎回引き直し、直前と同じ相手も避ける（`web/src/randomEnemy.ts` に集約）。
  以前は start() でしか抽選しておらず、リマッチだと敵が永久固定だった。
- 2026-07-24: 盤面のキャラは `.slot-body` でひとまとめにして動かす（`BoardParts.tsx`）。
  踏み込み・被弾のモーションは必ずこのラッパーに掛ける。カード絵だけに掛けると
  HPバー・装備アイコンが取り残されて「絵だけ浮く」（実際に起きた不具合）。
  接地影とスポットライトは地面の表現なので、あえて `.char-slot` 側に残して動かさない。
- 2026-07-24: **カードマスター管理の仕組みを新設**（第2弾以降の制作用）。詳細は `docs/CARD_MASTER.md`。
  - `data/sets.json`（弾マスタ。弾数/テーマNo./テーマ名/サブタイトル/パックタイプ/status）を新設。
    第1弾＝聖戦残火／禍いの足音／DX／released。
  - `engine/src/sets.ts` + `cards.ts` のゲート: **ALL_CARDS は released の弾のカードだけ**。
    既存144枚は1枚も未編集（vol1=released なので全部公開）。カードに `status?` を任意追加。
  - **管理画面 = `admin/` ワークスペース（`npm run admin`、ローカル専用・非デプロイ）**。
    Vite の fs API で `data/` を直接読み書き。カード編集・実装状況可視化・公開前チェック・
    基本値の理論値計算・弾メタ編集。保存は「制作中→data/wip（gitignore）／公開弾→data/cards.json」に自動振り分け。
  - 漏れ防止の多層防御: engineゲート＋物理分離（data/wip・assets/wip_card_images は gitignore）＋
    CIの `scripts/check-no-wip-leak.mjs`（deploy.yml に組込・公開JSを走査）＋ `engine/test/sets.test.ts`。
  - テスト 81→90。当時は将来拡張としていたoracleId二層モデルは、2026-07-29のOLG-003で導入済み。
- 2026-07-24: **管理画面をスマホから使えるように（完成・稼働中）**。当初 Tailscale を提案したが
  社長が「アプリを入れたくない・外出先から使いたい」→ **Cloudflare Tunnel + Access** に変更。
  社長は既に Cloudflare ヘビーユーザーで `racc.games` ドメイン保有。
  - URL: **https://cards.racc.games**（スマホのブラウザ＋メールOTPだけ、アプリ不要）
  - cloudflared トンネル `bravers-admin`（PC内）＋ Cloudflare Access（One-time PIN、
    許可メール `racc.beginner@gmail.com` のみ）。未公開データはPCから出ない。
  - **未認証は UI もデータAPI(/api/master) も 302 でブロック**を実測確認（漏れ経路ゼロ）。
  - 自動起動: `~/Library/LaunchAgents/com.bravers.admin.plist` ＋ `com.bravers.tunnel.plist`
    （PC起動で admin(:5273)＋トンネルが自動起動。sudo不要のLaunchAgent）。
  - `admin/vite.config.ts`: allowedHosts `.racc.games`＋画像アップロードAPI(/api/save-image、
    制作中→wip_card_images・公開→card_images)＋スマホからの公開(/api/git-status・/api/git-push、
    PCの既存git認証のみ・data/wip は gitignore で push されない)。画像アップロードUI・公開パネルも追加。
  - 手順は `docs/CARD_MASTER_MOBILE.md`。唯一の制約: 使うとき家のPCが起動している必要（データを外に出さない代償）。
- 2026-07-25: **公開βのログを分析し、それを受けた調整を実施**。詳細は
  `docs/balance/2026-07-25_beta_feedback.md`（ログの読み方・数字・判断の理由が全部ここ）。
  - ログの場所: 社長のGoogleドライブのスプレッドシート「BRAVERS DUEL ログ」。
    2日間でユニーク10人だが、実質は社長＋本気で遊んだ外部1人＋お試し数人。
  - **壊れコンボを潰した**: アイ＋クラウディアのAP妨害デッキが9戦9勝（3〜8ターン決着）だった。
    クラウディアの「APが4以下でダメージ+2」を削除、ライトニングセイバー/スタンショック/
    テクノウェイブ/雷雲召喚のコストを引き上げ。
  - **UX指摘5点をすべて改善**: 相手アクターのHPが隠れる／手札がアクターに重なる／
    山札の中身が見たい／効果表示を単押しに／アクターの順番バッジ。
    ついでに「手札の箱が山札・AP・トラッシュのタップを横取りしていた」不具合も修正。
  - **AIを作り直した（searchAi = 1手先読み）**: 行動を実際に試して盤面を採点する方式。
    旧AI相手に勝率62%。`npm run sim -- --mode ai` で強さを測れる。
    **副作用: 平均15.2→28.1ターンと試合が長くなった**（`--ai simple` で旧AIと比較可）。
    速さに振り直すなら `engine/src/ai.ts` の `WEIGHTS.hpFoe`。
  - 未対応: 氷獄の女王が突出（83.6%）／竜王の暴食が5.0%／Xシェア経由の訪問0件／
    新規プレイヤーが1戦目を完走していない。
- 2026-07-25: **第2弾の情報が公開ビルドに漏れていたのを修正**（発見も同日）。
  `data/sets.json` は JSON import で丸ごと公開バンドルに入るため、
  そこに書いていた第2弾のサブタイトルが公開JSから読める状態だった。
  → **弾メタもカードと同じ振り分けに変更**: 公開済み＝`data/sets.json`、
  制作中＝`data/wip/sets.json`（gitignore）／非公開リポの `sets.wip.json`。
  管理画面（ローカル・クラウド両方）は保存時に status で自動振り分け、公開ボタンで公開側へ移す。
  検査は `engine/test/sets.test.ts`（公開側に draft があると落ちる）＋ `scripts/check-no-wip-leak.mjs`。
  **注意: この漏れは 07-24 の a63a57b から公開リポの git 履歴に残っている**（履歴の書き換えは未実施）。
- 2026-07-26: **管理画面のクラウド化が完了。Tunnel 版は撤去した（PCの起動が不要になった）**。
  「使うとき家のPCが起動している必要がある」という唯一の制約をなくすため、管理画面ごと
  Cloudflare Pages に移した。手順書は `docs/CARD_MASTER_MOBILE.md` を全面的に書き換えた。
  - URL は **https://cards.racc.games** のまま。中身が Tunnel→**Cloudflare Pages `bravers-admin`** に変わった。
  - データの置き場が「PCのローカルファイル」から **GitHub の2リポ**になった。
    公開ずみ＝公開リポ `bravers_duel`／**制作中＝非公開リポ `RaccBigenner/bravers_duel_wip`**
    （`cards/volN.json`・`sets.wip.json`・`images/`）。第2弾8枚は非公開リポに投入ずみ。
  - サーバ実装＝`admin/functions/`（Pages Functions）。`_middleware.ts` が公式プラグインで
    Access の JWT を JWKS 署名・aud・exp まで検証する（ヘッダの有無だけでは通さない）。
  - Access アプリ「cards」はそのまま流用。ただし**ログイン方法は今は Cloudflare アカウント**
    （メールOTPではない）。OTP に戻すなら Zero Trust の Authentication で One-time PIN を有効化する。
  - 実測確認: 未認証の `/`・`/api/master`・`/api/save-card` はすべて 302 でブロック。
    トンネルを止めた状態でカード一覧（第1弾144枚・第2弾8枚）が出ることも確認した。
  - **当時の注意**: 旧環境変数 `GITHUB_TOKEN`（fine-grained PAT）は
    2026-08-24 ごろ期限切れ。OLG-003でprivate write/Actions用
    `GITHUB_PRIVATE_TOKEN`とpublic read-only用`GITHUB_PUBLIC_TOKEN`へ分離したため、
    本番切替後は旧tokenをrevokeする。差し替えたら再デプロイが必要。**`--branch main` を必ず付ける**
    （付けないと今の git ブランチ名で Preview 環境に上がり、cards.racc.games に反映されない）:
    `cd admin && npx vite build && npx wrangler pages deploy dist --project-name bravers-admin --branch main`
  - 撤去したもの: `~/Library/LaunchAgents/com.bravers.{admin,tunnel}.plist`（unload して削除）。
    トンネル `bravers-admin` 自体は残してあるので、DNS を戻せば Tunnel 版に復帰できる
    （復帰手順と plist の中身は `docs/CARD_MASTER_MOBILE.md` の末尾に保存した）。
  - やり残し2件（どちらも実害なし）: ①Pages のカスタムドメインが status=pending のまま
    （証明書の発行待ち。ゾーンの Universal SSL で動いているので表示は正常）
    ②古いデプロイ `8b253250.bravers-admin.pages.dev` は Access の外側にいるが、
    環境変数が無いので 500 で閉じている（消しておくと安心）。
- 2026-07-26: **管理画面のUIを作り直した（「一覧性が悪い・情報が薄い・スマホで使いづらい」の解消）**。
  原因は感覚ではなくはっきりした作りの問題だったので、そこを直した。
  - **原因**: ①横1100px以下だと3カラムが縦に積まれ、スマホでは「弾の設定フォーム」が最初に来て
    カードまで画面5〜6枚ぶんスクロールが必要だった ②一覧の情報が 画像・名前・レア・種類 の4つだけで
    並び替えが1つも無かった ③文字が9〜13pxでiPhoneが入力のたびに勝手に拡大していた
    ④画像配信が `Cache-Control: no-store` ＋ 公開前チェックが144枚を1枚ずつ確認しており、
    1回開くたび約290リクエスト飛んでいた ⑤「GitHubへ公開」がローカル版の遺物 `/api/git-status`
    を叩いていて壊れており、逆に実装済みの `/api/publish-set` を呼ぶUIが無かった。
  - **一覧はゲームと同じ `web/src/CardFrame` をそのまま使う**（社長の指示）。管理画面用に作り直すと
    本物とズレるため。大型カードも横向きのまま並ぶ＝ゲームのカード一覧と同じ見え方。
    表示は カード／リスト／表 の3通り（`admin/src/cardView.tsx`）。
  - スマホは **下タブ3つ（カード／弾の設定／チェックと公開）**。最初に出るのは必ずカード一覧。
    カードを押すと全画面シートで編集し、保存・削除は下に固定。戻ると元のスクロール位置に戻る。
  - 絞り込み（種類・レア・コスト・属性・未実装・画像なし・制作中・効果あり）と
    並び替え（番号・コスト・数値・レア・名前・種類／昇降）を追加。
  - **速度**: `/api/master` が画像一覧（ファイル名＋blob sha）も返すようにし、画像URLに `?v=sha` を付けて
    1年 immutable キャッシュ。1枚ずつの存在確認も廃止（約290リクエスト → ほぼ0）。
  - 「GitHubへ公開」を **「第N弾を公開する」（`/api/publish-set`）** に置換。公開前チェックが
    全部緑でないと押せない。ローカル開発サーバー（`vite.config.ts`）にも同じ publish-set を実装し、
    危険だった `git add -A` → push の git-status/git-push は削除した。
  - **iPhoneから画像を上げられなかったのを修正**（社長報告）。原因は2つあり両方対策:
    ①HEIC等 createImageBitmap が読めない形式 → `<img>` 経由で読み直す
    ②Safari がキャンバスから webp を書き出せず黙って png を返す → webp か必ず確認し、
    駄目なら `@jsquash/webp`（wasm）で変換。**この分岐に入った時だけ遅延読み込み**するので普段は無関係。
    本番環境で wasm が読めて正しい webp が出ることまで実測確認済み。
  - `web/src/cardAssets.ts` に `setImageRevisions()` を追加（管理画面だけが使う。ゲーム側の挙動は不変）。
  - 注意: カード名のフォント AFSMinNovaE.ttf は 2.8MB あり、初回だけ読み込みが重い（以後キャッシュ）。
    軽くしたい場合は admin.css の `@font-face` を消せば Murecho にフォールバックする（見た目は少し変わる）。
- 2026-07-26: **【事故と復旧】制作中の第2弾が管理画面から消えた。原因は弾メタの置き忘れ**。
  - **何が起きたか**: 「第2弾の情報漏れを塞ぐ」修正（`dc6ee09`）で公開リポの `data/sets.json` から
    第2弾の弾メタを削除した。移し先は**ローカルの `data/wip/sets.json`** だったが、
    **クラウド管理画面が読むのは非公開リポ直下の `sets.wip.json`** で、そちらは一度も作られていなかった。
  - **なぜ全部消えて見えたか**: `/api/master` は「弾メタに載っている vol」しか
    `cards/volN.json` を読みに行かない作りだった。弾メタが無い＝カードも読まれない。
  - **カード自体は無事だった**（非公開リポ `cards/vol2.json` に8枚そのまま）。
  - **復旧**: 非公開リポに `sets.wip.json` を作成（第2弾＝聖戦残火／黎明の光／DX／draft）。
    8枚とも表示を確認済み。
  - **再発防止**: `/api/master` が非公開リポの `cards/` を直接見るようにした。
    ファイルがある vol は弾メタが無くても必ず読み、弾タブを出して赤い「要設定」バッジを付ける
    （`orphanVols`）。同じPrinting IDは公開側を正として重複も排除。ローカル開発サーバーにも同じ処理を入れた。
  - **残る注意**: 制作中の弾メタの置き場は **ローカル=`data/wip/sets.json` / クラウド=非公開リポ
    `sets.wip.json`** と2つある。**片方を編集しても、もう片方には反映されない。**
    今はクラウド版だけを使うのでまず問題ないが、ローカル管理画面を触る時は必ず思い出すこと。
- 2026-07-26: 新UIの不具合2件を修正（社長のiPhone実機報告から）。
  - **カード名が枠にめり込んで上が切れる**: `.gallery-cell` に付けた `line-height: 0` が
    カード名に継承されていた。CardFrame のカード名は行の高さを指定していないため、
    行ボックスが潰れて文字が上にはみ出し、枠の `overflow:hidden` に切られていた。
    → `admin.css` に **`.card-frame, .card-frame * { line-height: normal; box-sizing: content-box }`**
    を追加してカードの中を隔離した。CardFrame はゲーム側のCSS（`* { box-sizing }` 無し）を
    前提に作られているので、**管理画面の全体設定をカードの中に入れないこと**。
  - **画像アップロードが必ず失敗する（真因は iPhone の webp 書き出し）**:
    **iOS Safari は `canvas.toBlob(cb, 'image/webp')` を頼まれると例外を投げる**
    （`SyntaxError: The string did not match the expected pattern.`）。
    社長が最初に言っていた「フォーマットが違うと言われる」もこれ。
    保険の wasm エンコーダは用意していたが、**「png が返ってきた場合」しか保険に回しておらず、
    「例外で落ちた場合」に回っていなかった**のが直接の不具合。→ 例外も握りつぶして保険へ回す。
    併せて base64 変換 `String.fromCharCode(...bytes)`（iPhone の引数上限を超えて RangeError）を
    `FileReader.readAsDataURL` に置き換え、どの段階で転んだかをエラーに出すようにした。
  - **検証方法**（同じ不具合を追う時に使える）: PC の Chrome で
    `HTMLCanvasElement.prototype.toBlob` を「webp なら例外」に差し替えると iPhone と同じ条件を作れる。
    実際にこの状態で通しでアップロードし、非公開リポに正しい webp（576x800）が保存されるまで確認済み。
  - サーバー側（`/api/save-image`）は実地テストで 200 を確認済み＝原因はクライアントだけだった。
  - 上げた直後は GitHub 側の反映に数秒かかり画像が 404 になることがあるため、
    画像配信（`card_images/[[path]].ts`）に「版番号つきの時だけ1.2秒待って1回だけ再取得」を入れた。
- 2026-07-26: **一覧に「ありもしない斬属性」が必ず1つ出ていたのを修正（表示＋データの両方）**。
  - **表示側**: `cardAttributes()` が attribute・conditionAttribute・addAttribute を
    全部つないでいた。**属性は種類ごとに置き場所が違うので、必ず種類で選ぶ**ように直した。
  - **データ側（こちらが根本）**: 新規カードは「スキル・条件属性=斬」で始まる（`onAddCard` の初期値）。
    種類をキャラに変えても `conditionAttribute:['斬']` や `costAp/baseValue/valueType` が
    消えずに残っていた。→ `stripForType()` を作り、**保存時に別種類の項目を必ず落とす**。
    知らない項目は消さない作りなので、将来項目が増えても壊れない。
  - **既存データの掃除**: 非公開リポ `cards/vol2.json` の9枚（全部キャラ）から
    `costAp/conditionAttribute/baseValue/valueType` を削除。属性・HP・名前・効果文は無変更。
    第2弾を公開した時にゴミが公開データへ混ざるのも防げた。
  - 公開済み `data/cards.json`（第1弾144枚）は元から種類ごとに項目が揃っていて、汚れは無かった。
- 2026-07-26: **保存すると一覧に戻った後で勝手にカード編集画面へ飛ばされる件を修正**（社長報告）。
  - **原因**: `onSaveCard` が `await reload()`（GitHubから全件読み直し・数秒）してから
    旧実装が `setSelectedId(card.id)` していた。待っている間に「← 一覧へ」を押しても、
    後から選択が復活してシートが開き直していた。**遅い非同期処理が、利用者の操作を後から上書きする**古典的な事故。
  - **直し方（2つ）**:
    ① `userClosedRef` で「保存中に閉じたか」を見て、閉じていたら開き直さない。
    ② **保存後に GitHub を読み直すのをやめ、手元のデータを直接更新する**（`applyCardLocally`）。
    保存が成功したなら中身は分かっているので読み直す必要がない。カード削除・弾の保存も同じにした。
  - **これは待ち時間だけの話ではない**: GitHub は書き込み直後の読み取りが数秒古いままのことがあり
    （実際に vol2.json でも画像でも観測した）、読み直すと**保存したのに古い内容が返ってくる**危険があった。
  - 保存ボタンは押している間 `保存中…` になり二度押しできない。
  - **検証**: iframe を 414px にしてスマホと同じ条件を作り、`fetch` の `/api/save-card` だけを
    「2秒かかる偽の成功」に差し替えて（＝実データを一切触らずに）競合を再現。
    「保存→すぐ戻る」で開き直さないこと、「保存→待つ」ではシートが開いたままトーストが出ることを確認。
- 2026-07-26: **スタンダードデッキ8種を全部組み直した**（社長の「デッキが全部悪い」指摘を受けて）。
  詳細は `docs/balance/2026-07-26_deck_rebuild.md`。
  - 原因は「アクターはスキル1回ごとに交代するのに、そのキャラが撃てない札だらけ」だったこと。
    ビコウ10%・ドッソ23%・パークル13%・アイ30%しか自分のデッキを撃てていなかった。
    **カードの強弱を測る前に、まず各キャラの「撃てる率」を見ること**（60%を切ったら組み直し）。
  - 並び順も実質デッキの一部。カードを変えずに槍衾の陣 47.6%→66.7%（+19.0ポイント）動いた。
  - 結果: 勝率の開きが 3.6〜82.1% → 47.1〜62.9%（竜王を除く7デッキ）。
  - **竜王の暴食(2.9%)は「今は仕様」**。ジエンドの自傷ミル2は第1弾のカードでは救えないと確認済みで、
    社長判断により能力は変えず、HPを20に戻して**第2弾のカードでメタ的に拾う**方針。
    第1弾だけでこのデッキを評価しないこと。
  - アイのHPは14のまま（2026-07-25 の社長指示）。
- 2026-07-26: **USR のキラ（ホロ加工）を「絵に描き込む」から「重ねる層」に変えた（第2弾以降のみ）**。
  - **調査結果**: 第1弾のキラは **USRキャラ4枚（1-A003〜1-A006）の絵そのものに焼き込まれている**。
    別レイヤーではなく、カードごとに面の割れ方も違う。USRスキル4枚（1-A037〜1-A040）にはキラ無し。
    LSR（アイ）にも無い。コード側にホロ演出の実装も無かった。
  - **テクスチャは社長支給**（`web/src/assets/kira_diamond.webp`／600x834・63KB）。
    元は `assets/card_images/background_frame_diamond.webp`（LSRの枠）を**淡くした専用版**で、
    社長が用意したもの。Ludo で作った案は不採用。
  - **対象**: `cardAssets.ts` の `kiraOverlay()` が「**vol>=2 かつ USR**」の時だけ返す。
    カードの種類（キャラ／スキル／装備／フィールド）は問わない。
    LSR は枠そのものがこの絵柄なので掛けない。**SSR は一度入れたが社長判断で外した**（`KIRA_RARITIES`）。
  - **重ねる位置（社長指示）**: **カード絵のすぐ上・名前/属性/HP/値プレート/説明より下**。
    そのため `RarityFrame` で一括して被せず、`KiraLayer` を各コンテンツの
    「絵を描いた直後」に差し込んでいる。全面絵のカードはカード全面、
    **SSRスキルは型抜きした絵の形に沿って**、装備は丸絵の中だけに乗る。
  - **第1弾に掛けてはいけない**（絵に焼き込み済みなので二重掛けになる）。境目は
    `cardAssets.ts` の `KIRA_FROM_VOL = 2`。
  - **強さの決め方**: 6枚に multiply / overlay / hard-light / soft-light / screen / color-dodge を
    当てて実機で見比べ、**hard-light・等倍**を採用（`CardFrame.tsx` の `KIRA_BLEND`/`KIRA_OPACITY`）。
    テクスチャ自体が淡いので等倍で丁度いい。soft-light と multiply はほぼ見えない。
  - 画像は**バンドルに含める**（`import` で読む）。`/card_images/` 配信に置くと
    GitHubへのpushが済むまで管理画面に出ないため、あえてこの形にした。
  - 内枠に `isolation: isolate` を追加（合成がカードの外に漏れないように）。
  - **注意: この変更はまだコミット・push していない。** 第2弾を公開する時までに main に入っていないと、
    ゲーム側にキラが出ない（管理画面は既にデプロイ済みなので見えている）。
- 2026-07-26: **画面内ログを追加**（`admin/src/log.ts` ＋ `LogPanel`）。スマホは開発者ツールが
  使えず「画像アップロードが失敗する」の原因が追えなかったため。
  - 画像アップロードの**全段階**を記録: 選んだファイルの種類/サイズ → 読み込み方法（createImageBitmap
    か `<img>` か）→ 縮小後の寸法 → 標準webp変換の結果か例外 → 保険のwasm使用 → 送信サイズ →
    **サーバーの応答（ステータスと本文）**。画面全体の例外・未処理の失敗も拾う。
  - localStorage に最大300行残るので、失敗して画面を閉じても後から読める。
    置き場所は「画像を選ぶ」ボタンの下と、「チェックと公開」タブ。コピーボタンつき。
  - 認証切れで管理画面のHTMLが返る場合も判別してメッセージを変える。
  - 検証: `canvas.toBlob` を例外化＋`/api/save-image` を500に差し替えて（実データ非書き込み）、
    10行のログに失敗箇所が正しく出ることを確認。
- 2026-07-26: **画像アップロードの 502 は「一時的なサーバー失敗」だと判明し、自動やり直しを入れた**。
  - 画面内ログのおかげで切り分けできた。**スマホ側は全段階成功**していた
    （Safari が webp を作れず png を返す → 保険の wasm が 103KB の webp を生成 → 送信）。
    落ちていたのはサーバーで、**Cloudflare の 502 エラーページ**（JSONではない＝
    `handle()` の外、つまり `_middleware` の Access プラグインか edge で転んでいる）。
  - **サイズは無関係**と実測で確認（4KB / 52KB / 167KB すべて 200。社長の失敗例は 138KB）。
    非公開リポには 2-A001〜2-A008 の画像が実際に入っており、失敗は 2-A009-SR の1回だけだった。
  - **対策1（クライアント）**: `saveImage` が **5xx と通信エラーだけ最大2回やり直す**
    （1.5秒→3秒）。400番台は何度やっても同じなのでやり直さない。
  - **対策2（サーバー）**: `_middleware.ts` が Access プラグインの例外を受け止め、
    Cloudflare の502ページではなく理由入りの JSON 503 を返す。**通さず必ず拒否する**（fail-closed）。
  - 検証: 1回目だけ 502 を返す偽サーバーで通しテスト → 1.5秒後に再送して成功、
    利用者にはエラーが出ないことを確認。テストで作った画像・カードは削除済み。
- 2026-07-27: **カードデザインをゲームと管理画面で完全に統一**（社長報告「微妙に違う」）。
  - **原因**: カードの中の文字が、置かれた画面の設定を継承していた。
    効果テキストの書体が ゲーム=Murecho／管理画面=system-ui。ほかに影(`box-shadow`)の有無、
    文字色、`* { margin: 0 }` の有無、`-webkit-text-size-adjust` の差もあった。
  - **対策**: **`web/src/cardFrame.css` を新設し、ゲームと管理画面の両方がこの1枚を読む**。
    書体・文字色・行の高さ・box-sizing・影・文字の自動拡大を全部ここで固定する。
    AFSフォントの定義と `.afs` もここへ移した（`styles.css`・`admin.css` からは削除）。
    **カードの見た目に関わる指定は、今後この1枚にだけ書くこと。**
- 2026-07-27: **カード1枚を背景透過PNGで保存できるようにした**（`admin/src/exportCard.tsx`）。
  カード編集画面の「カードを透過PNGで保存」。1000x1390（基準340pxの約3倍）で角の外は完全透明。
  - 画面のカードを撮るのではなく、**書き出し用に大きく描き直してから撮る**ので画質が落ちない。
  - **書体の埋め込みが要点**: PNG化するとカードは独立した絵になるため、画面で読み込み済みの
    書体は使えず、データを埋め込む必要がある。ただし Google Fonts の日本語は数百個に
    分割されていて全部取ると固まる。→ **そのカードで実際に使っている文字を含む分割だけ**
    選んで埋め込む（実測 610個中63個・1.4MB・0.7秒）。
  - **`toPng` は使わない。`toSvg` ＋ 自前で canvas に描く**。`toPng` は内部で
    `requestAnimationFrame` を待つが、**画面を見ていない時（スマホでアプリを切り替えた等）は
    発火せず永久に止まる**。実際にこれで固まった。自前のフレーム待ちも `setTimeout` に変えた。
  - 検証: 透過PNGの四隅が `a=0`、中央は不透明、1000x1390・2.7MBを実測確認。所要4秒ほど。
  - **スマホは「写真」アプリに入れられる**（社長要望）。ブラウザから写真アプリへ直接書き込む
    ことはできないので、**共有シート（`navigator.share`）に画像ファイルを渡し、
    そこで「画像を保存」を選んでもらう**。PC には共有シートが無いので普通のダウンロード。
  - **共有シートは「ボタンを押した直後」でないと開けない**（iPhone の制約）。画像作りに
    数秒かかるので、作り終えてから「写真に保存」を改めて押してもらう2段階にしてある。
    ここを1段階にすると `NotAllowedError` で開けなくなるので戻さないこと。
  - 検証: 共有シートに `image/png` 2719KB のファイルが正しく渡ること、
    共有シートが無い端末では直接ダウンロードになることを実測確認。
  - **iPhone では書き出しが壊れていた（実機のPNGで判明）**。iOS Safari は DOM を SVG に包んで
    画像化する時、**CSSの背景（画像もグラデーションも）を一切描かない**。枠・カード絵・キラ・
    属性の丸が全部消え、`<img>` と文字だけが残っていた（白文字のカード名も背景が無く見えない）。
    → `admin/src/flattenBackgrounds.ts` を新設し、**書き出し用の複製に対して
    背景をすべて本物の `<img>` に変換**してから画像化する。グラデーションは canvas に描いて
    画像化する（linear / radial の簡易パーサ入り）。
  - **差し込む背景 `<img>` には `z-index:-1` と親の `isolation:isolate` が必須**。
    「絶対配置は通常の要素より手前に描かれる」規則のせいで、無いと属性アイコンの絵が
    円の背景に隠れる（実際に起きた）。
  - **それでも iPhone では直らず、SVG方式そのものを捨てた**。実機ログの決定的な数字:
    素材の埋め込みが全部成功し「埋め込み漏れ0件」・下絵3847KBが正常に作れているのに、
    **出来上がりが 125KB（PCでは2700KB）＝ほぼ空っぽ**。
    つまり iOS Safari は foreignObject を含むSVGを絵に変換できない。
    → **html2canvas（canvasに直接描く方式）に変更**。SVGを経由しないので端末を選ばない。
    書体の埋め込みも不要になった（画面のフォントをそのまま使うため）ので、その処理は削除。
  - **html2canvas は重ね方（mix-blend-mode）を再現できない**ので、キラの層だけは
    `data-kira` の目印で見つけて一旦外し、**canvas の `globalCompositeOperation='hard-light'`
    で自分で合成する**（`detachKira` / `compositeKira`）。
  - 「原因が分からない時は、まず実機で追えるログを足す」が今回いちばん効いた。
    起動したプログラムの版・素材ごとの取り込み結果・出来上がりのバイト数を記録している。
- **残タスク**: スマホ実機での調整／ガード割り込みUIの実戦確認。
- 過去の「Firebase等で数日規模」というPvP概算は失効。現在はサーバー権威、再接続、
  秘匿projection、台帳を含むG3 PvP Closed Betaとして見積もる。
