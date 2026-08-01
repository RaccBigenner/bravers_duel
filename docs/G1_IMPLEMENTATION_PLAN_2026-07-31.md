# G1 Internal Alpha 実装計画（2026-07-31）

目標日: **2026-08-12** に G1 完了。今日は8/1なので残り11日。

正本: `docs/ONLINE_IMPLEMENTATION_BACKLOG.md`（G1 exit 条件と P1 の各 OLG）、
`docs/ONLINE_SERVICE_DESIGN_2026-07-29.md`（設計の中身。§番号は本文で参照）。

## 1. G1 で作るもの（exit 条件のおさらい）

プレイヤーから見える完成条件（BACKLOG G1）:

1. ゲストとして開始し、サーバー権威の NPC 戦を最初から最後まで遊べる
2. バトル中にリロード・一時切断しても、同じ試合と操作待ちへ復帰できる
3. LINE/Google 等へ連携すると、NPC 進行・デッキ・進行中試合を失わずアカウントを保護できる
4. スマホ縦持ちと PC の共通バトル盤面で、勝敗・時間切れ・再接続理由を理解できる
5. 改変した勝敗/報酬 payload、期限切れ session、重複 command、古い revision、
   複数タブ競合、match 未参加者の直接 API 要求を E2E で拒否し、不正な結果/BP/所有行が 0 件

P1 exit の一言まとめ:
**「ゲスト開始 → NPC戦 → リロード → 同じ試合へ復帰 → 勝利 → アカウント保護」をサーバー権威で完走し、クライアント改変で勝敗/報酬を作れない。**

## 2. 前提と制約

- **engine のバトル本体には触らない。** タブ1（BD main）が vol2 effects の作業で
  `engine/src/battle.ts` と `engine/src/effects/*` を編集中。
  サーバー側（OLG-121 の adapter）は engine の**公開 API を呼ぶだけ**にする。
  必要な形はすでに揃っている: `createBattle` / `applyAction` / `actingPlayer` /
  `stateHash`（replay.ts）/ `checkDeckForMatchStart`（deckLegality.ts）/
  `ENGINE_VERSION` / `CONTENT_VERSION`（versions.ts）/ `formatVersionId`（formats.ts）。
  engine 側の追加が欲しくなったら、直接編集せず BACKLOG に書いてタブ1 と調整する。
- 新しいコードはすべて新設の `server/` `protocol/` `supabase/` ワークスペースと
  `web/` の PWA 部分に置く。既存ファイルとの競合を避ける。
- OLG-115（招待コード）は **G2 の入口**であり G1 の exit には含まれない。
  純粋ロジックは実装済み（`scripts/invites.mjs`）。DB/API 化は OLG-101 の後に
  できるが、G1 のクリティカルパスには載せない（余裕があれば 8/11 以降に着手）。
- 環境は設計 §10.6 の 4 段: local → development（dev-play.racc.games）→
  staging → production。G1 は **local と development まで**で成立させ、
  staging/production の昇格系（OLG-103 の一部・OLG-105）は G1 の検証が
  development で通ってから仕上げる。

## 3. 実装順（依存関係つき）

番号は着手順。「→」は依存。

### Step A: 土台（OLG-101 → OLG-102）

- **OLG-101（2026-08-01完了）** `server` / `protocol` / `supabase` ワークスペースの scaffold（設計 §10.4）
  - `server/`と`protocol/`のTypeScript設定、プレースホルダ各1つ、workspace解決テスト
  - `server/migrations/`をPostgreSQL正本とし、`supabase/migrations` symlinkからCLIへ接続
  - `supabase init`相当のローカル設定と既存npm workspaceへの組み込み
  - Command/Event/Snapshot実型、Wrangler、MatchDO、WebSocket疎通はまだ作らない
- **OLG-102（実装済み・実stack受入待ち）** ローカル環境: Supabase CLI + Wrangler local（DO/SQLite）が
  1 コマンドで立ち上がり、MatchDOの最小WebSocket疎通とヘルスチェック API が通る。
  Worker/MatchDOの実runtime smokeはgreen。Docker互換ランタイム起動後のSupabase migration実適用を
  最後の受入として残す

### Step B: アカウントの土台（OLG-111 → OLG-113）

- **OLG-111（実装済み・実stack受入待ち）** server-side guest account（設計 §8.2）
  - ゲスト開始 = サーバーが匿名 account_id を発行（ローカル UUID だけにしない）
  - Supabase Auth の anonymous sign-in を使う
  - Auth userと同一UUIDの`public.account`を同一transactionのtriggerで作り、clientのData APIから隠す
  - tokenを外へ返さないrequest-scoped Worker内部providerまでを担当する。曖昧な失敗は再試行しない
  - browser向け`POST /auth/guest`は、OLG-113がopaque sessionへ収容できる段階で同時に開く
- **OLG-113（コード実装済み・実stack受入待ち）** secure session / seat token（設計 §8.4）
  - 10分TTLのHttpOnly bootstrap cookieとDB claimで、並行guest作成と応答喪失を同じaccountへ収束
  - Auth grantをserver-sideで暗号化し、HttpOnly / Secure / SameSite=Lax のopaque sessionへ収容
  - MatchDOのserver-owned assignmentからだけ30秒・一回限りのseat tokenを発行し、最初のauth frameで消費
  - unsafe HTTP/WebSocketはOriginを認証・DB照会より先に検査。logout intentをsession coordinatorへ
    alarmと原子的に先置きし、DB失効後に関連MatchDOへversion付きinvalidateを送り全ACKを待つ。
    応答喪失時もalarmでDB失効から再開し、DOの処理順でinvalidate後commandを拒否
  - MatchDOはregister RPC前のpendingとseat置換の旧参照cleanupをSQLite+alarmに先置きし、
    exact再送はmutating再登録でなくSessionCoordinatorのread-only barrierで確認する

### Step C: MatchDO の中核（OLG-121 → OLG-123 → OLG-122 → OLG-125 → OLG-124）

- **OLG-121（2026-08-01コード実装済み）** engine server adapter: MatchDO の中で engine を動かす。
  engine 公開 API のみ使用（前提②）。`POST /matches/npc`は空objectだけを受け、SessionCoordinatorが
  match IDとseedを生成・予約する。MatchDOは開始、合法action、権威snapshot、正常終了・取消・放棄を
  server権威で管理し、終端をSQLiteへ先に確定してから参照解除→予約解放の二段outboxを再試行する。
  client指定のmatch ID / seat / deck / seed / versionは受けず、seat token / WebSocketも参加台帳の
  positive確認後だけ対象DOへ到達する。OLG-125完了後はactive runtimeを保存履歴から復旧し、改変・gap・
  版不一致だけをseed再生成せずfail closedにする。browser向けgame frameは後続OLGまで`game-not-ready`とする。
- **OLG-123（2026-08-01コード実装済み）** stable `battleCardId`: 全カードへseed非依存の
  128-bit CSPRNG IDを割り当て、zone移動後も保持する。protocol / action logは手札indexでなく
  カード個体IDを使い、server adapterが現在の行動者handだけからengine actionへ変換する。
  malformed / stale / 他owner / 非hand IDと旧`handIndex`は盤面不変で拒否する。engineのstate hashと
  replay v1は不変。NPC pump前の初期ID manifest + stable stepsからCSPRNG再採番なしでruntimeを
  再演し、各state / identity hashを検証できる。永続化transactionはOLG-125、viewer別の秘匿はOLG-124へ続く
- **OLG-122（2026-08-01コード実装済み）** `commandId + expectedRevision`: client CSPRNGの
  `cmd_` + lowercase 32 hexを使い、初期revision 0からplayer command＋NPC pump全体の成功ごとに1増やす。
  bounded canonical payload + SHA-256をmatch / seat / revision / actionへ束縛し、同一ID・同一payloadは
  成功／拒否とも初回receiptを再送、別payloadはconflictにする。stale / ahead、invalid action、terminalを
  revision不変で拒否し、最終手のterminal commit失敗も同一再送で二重適用せず収束する。
  wire receiptはACK-onlyでtransition / events / lifecycleを含めない。台帳は全2,048件・拒否最大512件として
  accepted用容量を予約する。OLG-125完了後はSQLite台帳からexact復旧し、browser wireは引き続き閉じる
- **OLG-125（2026-08-02コード実装済み）** snapshot / event の永続化: actionをcloneへprepareし、
  `match_battle_manifest / state / command / step / event`へheader・初期ID配置、current revision / snapshot、
  canonical payload / digest・seat・成功／拒否／final receipt、stable step / eventを保存する。関連する
  lifecycle・terminal cleanup outbox / deadlineも同じSQLite transactionで確定してからruntimeをswapし、
  失敗時はtrialを捨て旧runtimeを保つ。v1復旧は初期manifestから全stable stepを再演し、current checkpointと
  human step数 / revision / hashを照合する。履歴は4,096 step・32,768 event・16 MiBでfail closedに制限し、
  周期checkpoint + tail再演は版付きrestore APIを追加する将来最適化とする。terminal commit後の外部cleanupは
  alarmだけが担い、保存済みreceiptのprojection / ACK配信→authenticated socket closeはOLG-124が担う
- **OLG-124** player projection: 相手手札・山札・seed を送らない
  プレイヤー別ビュー（設計 §11.3）。**command 処理パイプライン（設計 §11.2）の
  順序をここまでで固定**。raw WebSocket frameはJSON.parse前にUTF-8 byte上限を検査し、canonicalの
  深さ・node・文字列等の上限はdecode後の値へ適用する: Origin / Fetch Metadata確認 → セッション確認 → seat 確認 →
  commandId 重複確認 → expectedRevision 確認 → schema 検証 → ルール検証 →
  clone prepare → SQLite atomic commit → runtime swap → projection / ACK配信 → 必要ならclose

### Step D: 復帰（OLG-126 → OLG-133 → OLG-131 → OLG-114）

- **OLG-126** reconnect / resume（設計 §9.2): `GET /me/active-match` →
  WebSocket 再接続 + `last_event_sequence` → 差分または snapshot
- **OLG-133** active-match recovery UX: リロード後に「試合に戻る」導線が出て、
  操作待ちの状態まで自動で戻る
- **OLG-131** manifest / installable shell: PWA の最低限（インストール可能・
  縦持ち対応の共通盤面シェル）
- **OLG-114** active session / 複数タブ制御: 操作権は 1 タブ、他タブは観戦
  （設計 §9.2）

### Step E: 保護と時間（OLG-112 → OLG-127 → OLG-132 → OLG-134）

- **OLG-112** LINE/Google linking（設計 §8.3): 匿名アカウントへ外部 ID を
  link。external ID は (issuer, subject) で一意。メール一致での自動マージはしない
- **OLG-127** timeout / disconnect: NPC 戦は時間無制限 + idle suspend
  （設計 §4.1）。切断・再接続理由の表示。PvP クロック本体は G3 なので
  ここでは NPC 戦ぶんの土台だけ
- **OLG-132** IndexedDB draft / outbox: 送信前 command の復元
- **OLG-134** safe Service Worker update: 版が変わっても進行中の試合を壊さない

### Step F: 総仕上げ（OLG-128 → OLG-104 → OLG-103 → OLG-105）

- **OLG-128** authoritative NPC tutorial E2E: exit 条件⑤の攻撃シナリオを
  自動テスト化（改変 payload / 期限切れ session / 重複 command / 古い revision /
  複数タブ競合 / 未参加者 API がすべて拒否される）
- **OLG-104** migration CI と environment marker: APP_ENV と DB の
  environment_marker 不一致で fail closed（設計 §10.6）
- **OLG-103** development/staging/production bindings（development を最優先）
- **OLG-105** production 昇格 workflow（同一 artifact を昇格。再ビルドしない）

## 4. 受け入れ条件（OLG ごと）

| OLG | 受け入れ条件（これができたら done） |
|---|---|
| 101（完了） | `npm install`後にserver/protocolのtest・typecheckとルート`npm test`が通る。Supabase CLIが設定と`server/migrations/`へのsymlinkを認識し、外部resource/secretを作っていない |
| 102（受入待ち） | 1コマンド、MatchDO WebSocket、DO SQLiteを含むhealthは実装・検証済み。Docker互換ランタイム上でSupabase migrationが通ればdone |
| 111（受入待ち） | Auth anonymous userと同じUUIDのaccount行が原子的に作られ、clientから直接read/write不能。内部grantのtokenはHTTP/logへ出さず、曖昧失敗を自動再試行しない。Docker上のpgTAP＋GoTrue live smokeが通ればdone（browser route/cookieは113） |
| 113 | 同一bootstrapの並行/応答喪失が別accountを作らず、session cookieが本番で`__Host-`/HttpOnly/Secure/SameSite=Lax。期限切れ/失効APIは401。通常WebSocketはserver-owned assignment由来の一回限りseat tokenなしでは認証されず、logout後commandも拒否 |
| 121 | MatchDO 内で NPC 戦が開始→終了まで進み、結果が engine 単体実行と一致する（同 seed 同結果） |
| 123（完了） | 全カードIDが同seedから独立して一意で、重複printing・shuffle・zone移動後も保持される。手札の並びが変わっても指定個体へ当たり、旧index・未知・stale・他owner・非hand IDは盤面不変で拒否 |
| 122（完了） | 同じcommandId / payloadの逐次・並行再送は1回だけ適用され同じACK-only receipt。payload衝突、古い／未来revision、不正actionはrevision・盤面不変で拒否し、全2,048件・拒否最大512件でもaccepted用容量を失わない |
| 125（完了） | 5表とlifecycle/outboxをprepare→同一SQLite transaction→runtime swapで原子的に保存。transaction rollback、commit前後のDO reset、request終了後eviction、成功／拒否／final再送、constructor改変検知で二重適用せず同じID・盤面・receipt/resultへ復旧する |
| 124 | raw WebSocket frameをJSON.parse前にbyte上限で拒否し、wire receiptにtransition / events / lifecycle、projectionに相手手札・山札の中身・seedが含まれないことをテストで保証 |
| 126 | バトル中リロード→ 同じ試合・同じ操作待ちへ自動復帰。切断 30 秒→復帰も同様 |
| 133 | 復帰導線がスマホ縦持ち・PC の両方で表示され、タップ 1 回で盤面へ戻る |
| 131 | Lighthouse で installable 判定。縦持ちで盤面が崩れない |
| 114 | 2 タブ目を開くと片方だけが操作権を持ち、もう片方は観戦表示になる |
| 112 | ゲストが Google（または LINE）連携→ 進行・デッキ・進行中試合がそのまま。連携済み外部 ID の重複 link は拒否 |
| 127 | NPC 戦は時間無制限。放置で DO が suspend し、戻ると再開。切断理由が画面に出る |
| 132 | 送信直前にタブを閉じても、復帰後に未送信 command が復元または安全に破棄される |
| 134 | SW 更新を挟んでも進行中の試合が壊れず、次の区切りで新版へ切り替わる |
| 128 | exit 条件⑤の 6 種の攻撃が全部拒否される E2E が CI で green。不正な結果/BP/所有行 0 件 |
| 104 | marker 不一致の migration は CI で fail closed |
| 103 | development 環境（dev-play.racc.games）で E2E 一式が通る |
| 105 | development で検証した同一 artifact が staging→production へ昇格できる |

## 5. スケジュール（8/12 逆算）

| 日程 | やること |
|---|---|
| 7/31–8/1 | Step A（OLG-101, 102） |
| 8/2–8/3 | Step B（OLG-111, 113） |
| 8/4–8/6 | Step C（OLG-121, 123, 122, 125, 124） |
| 8/7–8/8 | Step D（OLG-126, 133, 131, 114） |
| 8/9–8/10 | Step E（OLG-112, 127, 132, 134） |
| 8/10–8/12 | Step F（OLG-128, 104, 103, 105）+ 予備日 |

- Step C が最大のリスク（MatchDO + engine adapter）。8/6 時点で C が
  終わっていなければ、Step E の OLG-132/134 を G1 後へ回して C/D を守る
  （exit 条件に直接必要なのは C/D/112/128）。
- OLG-115 の DB/API 化はこの表に入れない。全体が前倒しできたときだけ着手。

## 6. 進め方のルール

- 各 OLG が終わるたびにコミット（日本語メッセージ）。大きい OLG は中でも刻む。
- 受け入れ条件はテストで固定できるものは必ずテストにする（特に 122/124/125/128）。
- engine のファイルへの変更が必要になったら、その場で直さずタブ1 と調整。
- まとまった区切り（Step 単位）で `~/.raccterm/reviews.json` にレビュー依頼を出す。
