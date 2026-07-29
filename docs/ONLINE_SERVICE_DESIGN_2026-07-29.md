# BRAVER'S DUEL オンライン常設版 基本設計

- 版: v0.2
- 作成日: 2026-07-29
- 状態: 実装前の設計案
- 対象: 無料のブラウザゲームとして常設公開する次フェーズ
- ルールの正本: `docs/GAME_RULES.md`
- この文書の役割: プロダクト、オンライン機能、永続化、運用の基本設計

---

## 0. 結論

BRAVER'S DUEL は、現在の「CPU対戦ブラウザβ」を捨てずに、次の構成へ育てる。

1. **ブラウザ/PWAを正式クライアントにする**
2. **NPC戦を含む報酬対象バトルは、すべてサーバーで進行する**
3. **既存TypeScriptエンジンをサーバーでも使う**
4. **各カードコピーへ一意な個体IDを付け、DBの追記型台帳で移転履歴を残す**
5. **ブロックチェーンは使わない**
6. **最初の体験はゲストで始め、初回報酬の受取前にLINE/Googleでデータを保護する**
7. **人口が少ない間のレート戦は、レート帯で参加者を分けず、待機者から誰とでもマッチする**
8. **デュエルスペースはNPCとプレイヤーを同じ「店内にいるデュエリスト」として見せる**
9. **CHオープンチャットは、通報・ブロック・制裁・運営停止機能と同時に限定導入する**
10. **交換と大会は、対戦・所持・不正対策の土台が安定してから段階的に開放する**

推奨する初回の縦切りは、次の一連を最後までサーバー権威で成立させること。

> ゲスト開始 → チュートリアルNPC → リロード復帰 → 勝利 → アカウント保護 → 初回スターターを無償選択 → 所持カードでデッキ作成 → 下書き復帰

この縦切りが通れば、ルーム戦、レート戦、交換、大会を同じ基盤へ安全に追加できる。
実装計画上は、サーバー権威NPC戦までをPhase 1、所持/無償スターター/デッキ下書きまでを
Phase 2として分けるが、一般公開前には上の一連を通して検証する。

---

## 1. 現在地

### 1.1 すでに強い部分

- TypeScriptのルールエンジンがDOMから分離されている
- シード付き乱数と直列化可能な`BattleState`がある
- 行動は`BattleAction`、表示は型付き`BattleEvent`へ集約されている
- 第1弾144枚、カード効果113件、8つのプリセットデッキがある
- random/simple/searchのAIと自動対戦シミュレーターがある
- モバイル縦画面のバトルUI、カード物理演出、ドラッグ/タップ操作がある
- カード制作管理画面、未公開データ分離、公開漏れ検査がある
- 2026-07-29時点で`npm test`の99件と本番ビルドが通る

特に、以下はオンライン化後もそのまま中核として使える。

- `engine/src/battle.ts`のルール処理
- `engine/src/events.ts`の型付きイベント
- `web/src/battle/useBattle.ts`にある「正しい状態」と「演出用状態」の分離
- `web/src/pages/Battle.tsx`以下の盤面と操作
- `data/cards.json`、`data/sets.json`を起点にしたコンテンツ制作フロー

### 1.2 今は存在しない部分

- プレイヤーアカウント
- サーバー上のプレイヤーデータ
- カード個体と所有者
- BP残高と取引台帳
- ショップ、開封、売却、交換
- NPC進行、会話、解放条件
- PvP通信、マッチメイク、ルーム、大会
- リロード後のバトル復帰
- デッキ下書きの自動保存
- PWA manifest、Service Worker、IndexedDB
- フォーマット、禁止制限、ルール/カード版の固定
- プレイヤー別の秘匿情報投影
- Web UIの自動テスト、再接続テスト、同時取引テスト

今回の構想は「PvPを少し足す」規模ではなく、既存ゲームの外側へ**ライブサービス基盤を新設するフェーズ**として扱う。

### 1.3 2026-07-29に確定した公式ルール

1. キャラクターは**3枠ちょうど**を必ず埋める
2. 普通のキャラクターは1枠、LSRキャラクターの`legendaryLarge`は2枠を使う
3. したがって、場へ選ぶ実カード枚数は普通×3、またはLSR×1＋普通×1の**2〜3枚**
4. 場に選んだカードと同じカードを40枚側にも入れられる
5. 同名上限4枚は40枚側へ適用し、キャラクター枠の1枚は合算しない
6. 同じ1個体を場と40枚側へ同時に使うことはできない。場1枚＋40枚側4枚なら別々の5個体が必要
7. 40枚側のデッキ枚数は40枚
8. 手札の同名キャラクターカードを使うと、場の同名キャラクターを2回復する
9. 装備カードとフィールドカードは実装済み
10. キャラクター枠へ同じキャラクターを複数枚選ぶことはできない

大型2枠と同名キャラクターの2回復は、既存エンジンにも実装済みだった。今回、正本の
`GAME_RULES.md`をv0.10へ更新し、デッキ検証も「3枠必須」「場は同名不可」
「40枚側は同名4枚」へ同期した。
LSRキャラクターが必ず`legendaryLarge`になっていることもカードデータテストで固定する。

オンライン版では、同名判定と上限計算を表示名や再録ごとの`printing_id`ではなく、
ゲーム上同じカードを表す`oracle_id`で行う。

### 1.4 追加で確定したルール

キャラクター枠へ同じキャラクターを複数枚選ぶことは**不可**。同名1枚までとする。
現DeckBuilderはすでにこの操作を許可していなかったため、JSON直接読込でも抜けられないよう
デッキ検証器へ同名検査を追加した。

---

## 2. プロダクト方針

### 2.1 中心体験

> 仮想のカードショップへ通い、カードを1枚ずつ集め、常連NPCや他のプレイヤーと物理TCGのようにデュエルする。

機能名からではなく、画面ごとの感情を先に定義する。

| 場所 | 作りたい感情 |
|---|---|
| デュエルスペース | 店へ来れば誰かと遊べる安心感 |
| NPC戦 | 相手を知り、次の強さへ挑みたくなる感覚 |
| レート戦 | 待たされず、自分の成長が数字で分かる緊張感 |
| ルーム戦 | 友達とすぐ卓を囲める気軽さ |
| 大会 | 小さな店大会へ参加する高揚感 |
| カード一覧 | コレクションが埋まる満足感 |
| デッキ編集 | 自分の3枠と順番を考える面白さ |
| ショップ | 中身が分かった上で選ぶ安心と、開封の期待 |
| 交換 | 不安なく、欲しい1枚へ近づく楽しさ |

### 2.2 初期公開で守る境界

- プレイヤーから現金を受け取らない
- BPはゲーム内でのみ無償付与する
- BPの送付、現金化、外部商品との交換をできなくする
- プレイヤー交換にBPを使わせない
- ユーザー主催大会に参加料と賞金を設定させない
- 自由入力はCH内の公開テキストだけに限定し、DM、画像、ファイル、URL投稿を初期は置かない
- チャットの通報、ブロック、段階制裁、監査ログ、全体停止を同時に用意する
- RMT、BOT、複数アカウントによる報酬回収、談合を規約で禁止する
- 排出率は無料公開中でも表示する

この境界を越えて有料BP、現金化、外部マーケット、参加者拠出賞金を導入する場合は、別設計と日本の専門家確認を必須とする。

---

## 3. 情報設計と画面構成

### 3.1 グローバルナビゲーション

スマホは下部5タブ、PCは左サイドバーにする。

1. **デュエル**
2. **カード**
3. **ショップ**
4. **交換**
5. **メニュー**

バトル中はナビゲーションを隠し、盤面へ集中させる。進行中バトルがある時は、全画面の最上部に常に「対戦へ戻る」を出す。

### 3.2 初回導線

1. URLを開く
2. 自動でゲストセッションを作る
3. 言語は`ja-JP`を初期値にし、ブラウザ言語から候補を出す
4. デュエルスペースで案内NPCが声をかける
5. 貸出デッキで短いチュートリアル戦
6. 初勝利時に「データを守る」を案内
7. LINEを主ボタン、Googleを副ボタンとして表示
8. アカウント保護後、好きな初回スターターを1つ無償で選ぶ
9. 所持カードとして発行し、最初のデッキを確認する
10. 通常のデュエルスペースへ

ログイン、通知許可、PWA追加を初回画面でまとめて要求しない。

- ログイン: 最初の成功体験の後
- PWA追加: 2回目の訪問または初スターター選択後
- 通知: 大会参加やマッチ待機など、用途が明確になった時

### 3.3 デュエルスペース

初期版は3D空間ではなく、**軽量な2Dイラストのカードショップ**とする。

カウンター、常連席、フリー卓のようにNPCとプレイヤーを場所で分けない。両者を同じ
「店内にいるデュエリスト」レイヤーへ、同じ大きさの名札/立ち絵として並べる。

```text
duel_space_actor
  actor_kind: NPC | PLAYER
  display_name
  portrait
  status: 対戦受付中 | 対戦中 | 離席
  interaction: 話す | 対戦する | 対戦申請 | 観戦する
```

- NPCには文字の`NPC`ラベルと専用アイコンを必ず表示する
- NPCだけを上段、プレイヤーだけを下段のように分離しない
- NPCを人間として偽装しない
- プレイヤーの入退室で並びが頻繁に動き、誤タップしないよう位置を安定させる
- 対戦中の人物から、許可された試合の観戦へ入れる
- クイック対戦、ルーム、大会、ショップは店内の常設ボタンとして置く

PCでは店内の右側へCHチャットを常設し、スマホでは下から開くシートにする。

### 3.4 CHオープンチャット

オープンチャットは入れられる。ただし、実装の難所は送受信ではなく、公開後の通報確認、
証跡保全、荒らし対応である。初期は次の範囲に絞る。

許可:

- CH内の公開プレーンテキスト
- 運営の定型メッセージ
- 定型スタンプ

初期は不許可:

- DM、スレッド、メンション
- 画像、ファイル、ボイス
- URLと外部連絡先
- 観戦専用チャット
- ユーザー作成CH名

CH仕様:

- `locale + duel_space_id + channel_number`で分ける
- 1CH最大30人を初期値とし、満員時は次CHへ自動入室
- CH切替は15秒に1回、最大20回/時
- 1投稿120文字まで
- 通常は3秒に1件、10件/分、100件/時
- 新規アカウントは10秒に1件、30件/時
- 投稿には外部ID連携、チュートリアル完了、ガイドライン同意を要求
- 同一文反復、URL、外部ID、RMT誘導、脅迫等を正規化後に検査
- 全CHを即時read-onlyにできるkill switchを持つ

年齢不明または低年齢プレイヤーを自由入力可能にする条件は、公開前に別途決定する。
安全側の初期値は「年齢帯を確認できない間は閲覧と定型スタンプのみ」とする。

通報:

- メッセージ長押し/メニューから1操作で通報
- 分類は暴言、差別/性的発言、個人情報、脅迫/自傷他害、RMT/不正、スパム、その他
- 対象メッセージ、前後の文脈、CH、時刻、送信者、通報者を証跡として固定
- 通常チャット原文は90日、通報証跡と制裁監査は対応終了後365日を初期案とする
- チャットBANとゲームBANを分離する

ブロック:

- 相手のチャットとスタンプを即時非表示
- 双方向の直接対戦申請を止める
- 相手の試合を観戦できなくする
- クイック対戦/大会ではレート操作防止のため対戦する可能性を残し、その試合中は交流を自動ミュート

### 3.5 問い合わせ・意見

メニューとバトル中メニューへ、常設の「お問い合わせ・ご意見」を置く。

- 種別: 不具合、ルール、バランス、UI、アカウント、対戦/取引、要望、その他
- 対戦中は`match_id`と直近`event_sequence`を自動添付
- 同意を得てbuild ID、OS、ブラウザ、画面サイズ、locale、通信状態を添付
- 自由記述を送る前に、含まれる診断情報を確認できる
- 送信後に受付番号を表示する
- 返信が必要な問い合わせと、返信不要の意見を分ける
- プレイヤー通報とは別キューにし、管理画面で状態と対応履歴を管理する

---

## 4. バトルモード

すべてのモードは、同じ`match`集約、同じルールエンジン、同じ復帰プロトコルを使う。

### 4.1 NPCデュエル

NPCは一覧ではなく、デュエルスペース内の人物として配置する。

各NPCは次のデータを持つ。

```text
npc
  npc_id
  name_key
  portrait_asset
  personality

npc_node
  node_id
  npc_id
  tier
  prerequisite_node_ids
  deck_revision_id
  ai_profile_id
  opening_dialogue_key
  win_dialogue_key
  lose_dialogue_key
  first_clear_reward_id
  repeat_reward_id
  tutorial_rules
```

基本構成:

- Tier 1: そのNPCの基本デッキ
- Tier 2: 主戦術が明確になった強化デッキ
- Tier 3: サイドプランや対策札まで入った本気デッキ

勝利すると次Tierと短い会話が解放される。同じNPCを倒し続けるだけで無限にBPを作れないよう、初回報酬を大きくし、再戦報酬には日次上限と逓減を入れる。

チュートリアルNPCは、1戦で全ルールを説明しない。

1. 攻撃とアクター交代
2. APとチャージ
3. guard割り込み
4. 装備/フィールド
5. デッキ切れと長期戦

の順に教える。

### 4.2 レートマッチ

名称は初期UIでは「レート戦」より「クイック対戦」を主にし、結果画面でレート変動を見せる。

仕様:

- 登録済みアカウントのみ
- 有効なデッキを1つロックして待機
- 同じフォーマットの待機者からマッチ
- 人口が少ない間はレート帯による入場分離をしない
- 複数候補がいる時だけ近いレートを優先
- 一定時間後はレート差に関係なく誰とでもマッチ
- NPCを人間として偽装しない
- 切断、投了、時間切れもサーバーが結果を確定する

参加前に、フォーマットごとの現在状況を次の2段階で表示する。

- `待機者なし`: 今参加すると待つ可能性がある
- `相手が待機中`: すぐ始められそう

名前、レート、デッキ、所属CH、低人数時の正確な人数は出さない。狙い撃ちを防ぎつつ、
「今すぐ遊べるか」という判断材料を渡す。試合数が十分にある時だけ、直近30分の
待ち時間中央値も表示する。

`QueueDO`は、自分、確保済み、heartbeat切れを除いた有効な待機者から表示を作る。
表示は5秒程度キャッシュし、「参加直前に別の対戦が成立する場合があります」と添える。
待機中もデュエルスペースとCHチャットを閲覧でき、成立時は画面内通知、設定に応じた音と
振動で知らせる。

レートは**Glicko-2**を採用する。

- 初期値: rating 1500 / RD 350 / volatility 0.06
- 最初の10戦は暫定表示
- 1試合ごとに更新
- 引き分けは0.5
- レート、RD、volatilityを保存
- マッチ相手の探索範囲には使うが、参加資格には使わない

同一ペアの短時間反復は、他の相手を優先して避ける。低人口時に遊べなくなることは避け、BP報酬停止や不正検知フラグを明示的なルールで適用する。レート計算を黙って変形させない。

### 4.3 ルームマッチ

公開ルーム一覧は作らない。見知らぬ相手との対戦は、クイック対戦またはデュエルスペースの
直接申請へ集約し、ルームは友人を招待するための**非公開卓**とする。

作成者が次を選ぶ。

- フォーマット
- 観戦可否と観戦用招待
- 持ち時間プリセット

参加方法:

- 招待URL
- 6文字の短期ルームコード

ルームコードは認証情報ではなく、参加先を見つけるためだけに使う。参加時にはログインセッションとサーバー認可が必要。

- 有効期限を持つ
- 総当たりのコード試行をrate limitする
- レートは付けない
- 正常な実戦にはクイック対戦と同じ基本BPを付ける
- 同一ペアは1日3戦まで満額、4〜5戦目は半額、6戦目以降は0 BP
- 早期離脱された側への最低保証は、複数アカウントによる相互離脱を防ぐためルームでは付けない
- フレンド対戦の戦績だけ残す

### 4.4 トーナメント

初期は4人/8人枠のシングルエリミネーションだけに絞る。主催者による組合せ・勝敗の
手入力は許可せず、参加受付、組合せ、試合作成、勝敗反映、報酬付与をサーバーが行う。

#### 大会種別

| 種別 | 開催方法 | 報酬 |
|---|---|---|
| ユーザー主催・時刻指定 | 検索公開または招待限定 | 各実戦の共通BP |
| システム即時大会 | フォーマットごとの共通4人待機列 | 共通BP＋順位ボーナス |
| 公式大会 | 運営が日時と報酬を設定 | 共通BP＋表示済みの公式報酬 |

参加料、ユーザー拠出賞品、カード賞品の持ち寄りは実装しない。作成者も他の参加者と
同じ条件で参加できる。

#### 時刻指定大会

作成時に次を設定する。

- 大会名
- 検索公開または招待限定
- 定員4人または8人
- 開始時刻
- フォーマット
- 持ち時間プリセット
- 観戦可否
- デッキリストの公開範囲

MVPでは開始時刻を作成時点の30分後〜7日後から選び、公開と同時に募集を始める。
募集期限と大会開始時刻を分離する。MVPでは次の固定進行にし、作成画面と参加画面で
終了見込みまで表示する。

```text
T-10分  募集締切、チェックイン開始
T-2分   チェックイン締切、参加者・デッキ・組合せ確定
T       1回戦開始
T+25分  次ラウンド開始
T+50分  8人枠の決勝開始
```

4人枠は開始から最大約50分、8人枠は最大約75分を予定時間として表示する。次ラウンドの
実開始時刻は次で決める。

```text
actual_round_start =
  max(nominal_round_start, previous_round_finished_at + 3分)
```

前ラウンドが早く終わっても表示済み時刻より前に強制開始しない。遅延時は理由と更新後の
時刻を表示する。将来、両者が同意した場合だけ早く始める機能を追加できる。

参加登録時に使用予定デッキを選ぶ。募集締切までは変更/取消でき、定員超過分は登録順の
補欠とする。補欠もチェックインでき、締切時に未チェックイン者を除外して自動繰上げする。

大会を`OPEN`にした時点で`format_version`、`content_version`、`engine_version`を固定し、
参加画面へ表示する。チェックイン締切時に次を大会終了までロックする。

- `deck_revision`
- 使用するカード個体

#### 参加人数とBYE

| チェックイン人数 | 処理 |
|---:|---|
| 0〜2人 | 不成立・取消 |
| 3人 | 4枠で開催、BYE 1 |
| 4人 | 4枠で開催 |
| 5人 | 8枠で開催、BYE 3 |
| 6人 | 8枠で開催、BYE 2 |
| 7人 | 8枠で開催、BYE 1 |
| 8人 | 8枠で開催 |

組合せはサーバー生成乱数で決め、主催者は変更できない。seedと結果を監査ログへ残す。
BYEは勝利数と実戦数に数えず、対戦BPも発行しない。将来の公式競技大会だけ、レートや
予選順位によるシード方式を追加できる。

#### 即時大会

低人口時に待機列が分散しないよう、MVPはフォーマットごとの共通4人待機列を1つだけ持つ。

- 参加操作をチェックイン兼Readyとする
- 待機人数を`2/4`のように表示する
- 4人揃ったら即座にロックして開始
- 3人以上で最古の参加者が3分待ったら、BYE 1の3人大会として開始
- 10分経過しても2人以下なら不成立とし、ペナルティ/BPなしでロック解除
- 8人即時大会は同時接続人口を確認してから追加

#### ラウンド進行

各ラウンド開始時に`TournamentDO`が`MatchDO`を自動作成し、大会画面からバトルへ遷移する。

1. ラウンド開始3分前にReady受付
2. 開始後2分を接続猶予にする
3. 両者接続後、サーバーが試合を開始
4. `MatchDO`が確定結果を`TournamentDO`へ一度だけ通知
5. 全対戦の確定後、次ラウンド時刻と相手を表示

初期持ち時間は1人8分のチェスクロック方式とする。

- サーバーがそのプレイヤーへ意思決定を要求した時だけ減る
- 有効なcommandを受理した時、相手の選択中、サーバー処理/演出中は止まる
- guard等の割り込み待機中は、回答する側の時計が減る
- 切断中でも、そのプレイヤーの意思決定中なら減り続ける
- 各行動の60秒/30秒上限では自動pass/skipし、消費した時間は戻さない
- 合計持ち時間が0になった時点で`TIMEOUT`敗北

サーバー処理を除く両者の総意思決定時間は最大16分になるため、Ready/遷移を含めても
25分ラウンド枠へ収める。実測で超過する場合は、ラウンド枠ではなく時計/演出停止条件を
先に見直す。

no-show:

- 片側だけ不在: 不在側の`NO_SHOW`敗北
- 両側不在: `DOUBLE_FORFEIT`で、その枠から勝者を出さない
- 後続枠の片側に勝者がいない: もう片側をBYEで進出
- 決勝が二重不在: 優勝者なし
- 大会開始後の棄権: 以降の枠をBYEで処理
- no-show反復者には大会参加クールダウン

#### 大会報酬

実際に開始・終了した各試合へ、クイック戦/ルーム戦と同じ18 BPと勝利加算6 BPを付ける。
対戦開始後に相手が途中離脱した場合、ルーム以外では残された側へ最低18 BPを保証する。
離脱側、BYE、試合前no-showには付与しない。

ユーザー主催大会は各実戦の共通BPまでとし、順位ボーナスは談合によるBP増殖を避けるため、
システム即時大会と公式大会だけに付ける。

| bracket | 大会完走 | ベスト4 | 準優勝 | 優勝 |
|---|---:|---:|---:|---:|
| 4枠 | +20 | — | +20 | +40 |
| 8枠 | +20 | +20 | +50 | +100 |

順位ボーナスは到達した最高順位の1つだけを付ける。BYEなしの8人大会優勝時は、
3勝分72 BP、完走20 BP、優勝100 BPの計192 BPが初期目安となる。5〜7人開催では
実際に開始・終了した試合数だけ共通BPを付け、BYEを勝利報酬へ数えない。

- BYEだけで実戦していない参加者には順位ボーナスなし
- システム即時大会の順位ボーナスは1日2大会まで
- 報酬停止時も大会の勝敗は改変しない
- 大会取消時は完了済み実戦のBPだけ維持
- `tournament_id + account_id + reward_type`を一意にする

#### 状態遷移

```text
DRAFT → OPEN → CHECK_IN → LOCKED
  → ROUND_READY → ROUND_RUNNING → INTERMISSION
  → ROUND_READY ... → COMPLETED

DRAFT / OPEN / CHECK_IN → CANCELLED
LOCKED以降 → SUSPENDED
  → suspended_from_stateへ復帰 / CANCELLED
```

起動時は`active-match`を最優先し、なければ`active-tournament`から大会表、次ラウンド時刻、
Ready状態を復元する。結果通知には`match_id`と`result_revision`を持たせ、同じ結果を一度
しか適用しない。矛盾する結果を受信したら自動進行せず`SUSPENDED`にして運営へ通知する。

`SUSPENDED`は中断元状態と各`bracket_match.match_id`を保存する。復旧時に進行中
`MatchDO`を作り直さず、同じmatchへ再接続する。match作成も`bracket_match_id`を
idempotency keyにし、すでに`match_id`がある枠へ2つ目を作らない。

#### MVP外

- 8人即時大会
- スイスドロー、ダブルエリミネーション
- BO3、サイドボード
- 主催者の手動シード/手動勝敗
- 参加料、ユーザー設定賞品
- 複数日大会、予選リーグ
- 外部大会連携

### 4.5 フォーマット

最初からデータ駆動にする。

```text
format
  format_id
  version
  name_key
  active_from / active_to
  set_policy: ALL | LATEST_N | EXPLICIT
  latest_n
  allowed_set_ids
  banned_oracle_ids
  restricted_oracle_ids
  deck_size
  max_copies
  character_slot_policy
  zone_copy_policy
```

初期:

- `FREE_V1`: 公開済みの全弾
- `character_slot_policy = EXACT_CAPACITY_3`
- `zone_copy_policy = MAIN_DECK_LIMIT_ONLY`

将来:

- `LATEST_N_V1`: 最新N弾
- 大会専用フォーマット
- 禁止/制限改定

検証はデッキ保存時、キュー参加時、試合開始直前の3回行う。試合開始後は、その試合が参照するフォーマット版を変更しない。

### 4.6 観戦

観戦は実現可能で、デュエルスペースの「店内で他の卓を見る」感覚とも相性がよい。
ただし、プレイヤー用stateから手札を後で削るのではなく、公開項目だけから
`SpectatorProjection`を別生成する。

見せる:

- キャラクター、装備、フィールド、公開トラッシュ
- HP/AP等の公開数値
- 両者の手札枚数と山札枚数
- 公開済みカードとバトルログ
- ターン、フェーズ、持ち時間

見せない:

- 両者の手札内容
- 山札内容と順序
- 未公開の選択候補
- RNG seed/state
- legal actions
- `deck_revision`、所持個体ID、seat token

初期ポリシー:

| モード | 観戦 |
|---|---|
| ルーム | 作成時に許可し、両プレイヤーのReady時に同意。招待観戦、リアルタイム |
| クイック | 両者が許可した場合だけ。30秒遅延 |
| 大会 | 大会参加時に告知して許可。60秒遅延 |
| NPC戦 | 原則非公開。運営デモだけ許可 |

遅延値は運用設定にし、クライアントではなくサーバーで適用する。途中から観戦した時も
`現在時刻 - delay`時点のsnapshotとeventだけを渡し、試合終了表示も同じ秒数だけ遅らせる。

MVPは1試合20人まで、登録済みアカウントのみ。観戦者の名前は対戦者へ出さず人数だけ表示し、
観戦チャットは置かない。ブロック関係にある相手の試合は観戦できない。

PCの余白には公開バトルログ、カード詳細、大会表を表示し、スマホでは同じ内容をbottom
sheetへ入れる。秘匿情報漏洩テストと遅延テストが通るまで、観戦機能をfeature flagで閉じる。

---

## 5. カード、所持、デッキ

### 5.1 4つのカード概念を分離する

```text
CardDefinition / Oracle
  ゲーム上「同じカード」と判定する単位

CardPrinting
  収録弾、番号、レアリティ、絵、加工の単位

OwnedCardInstance
  プレイヤーが持つ1枚ごとの個体

BattleCardInstance
  1試合の中だけ存在する秘匿可能なカード
```

現行の`1-A001-LSR`は`printing_id`として扱う。再録やエラッタを安全に扱うため、第2弾公開前に`oracle_id`を導入する。

コピー上限は`printing_id`ではなく`oracle_id`で数え、再録カードを混ぜて上限を回避できないようにする。

### 5.2 カード個体

各個体は次を持つ。

```text
card_instance
  instance_id: UUIDv7
  printing_id
  public_serial_no
  current_owner_account_id
  state
  finish
  obtained_via
  obtained_reference_id
  created_at
  version
```

状態:

- `AVAILABLE`
- `TRADE_ESCROW`
- `MATCH_LOCKED`
- `SOLD_TO_SYSTEM`
- `FROZEN`
- `REVOKED`

画面には長いUUIDではなく、`#000123`のような公開シリアルを見せる。

### 5.3 簡易ブロックチェーン風の履歴

実ブロックチェーンではなく、PostgreSQLの追記型台帳を使う。

```text
ownership_event
  event_id
  instance_id
  from_account_id
  to_account_id
  reason
  reference_type
  reference_id
  actor_type
  created_at
  previous_hash
  event_hash
```

原則:

- 過去行を更新/削除しない
- 誤発行の訂正は補償イベントで行う
- 現在所有者は`card_instance`へ投影して高速参照する
- 台帳と現在所有者の整合性を日次検査する
- 過去所有者の表示名は他プレイヤーへ公開しない
- 必要なら日次のルートハッシュを別ストレージへ署名保存する

ブロックチェーンを使わない理由:

- 発行、失効、復旧、ルールを決める主体が運営1者である
- 分散合意が必要ない
- ウォレット鍵紛失をプレイヤー責任にするとライトなアカウント体験と衝突する
- 不正取引の巻戻し、アカウント復旧、個人情報対応が難しくなる
- 手数料、遅延、コントラクト更新リスクを増やす

UIでは法的な「所有権」と断定せず、「所持カード」「カード個体」「取得履歴」と表現する。

### 5.4 デッキ保存

通常のデッキ編集で、同じ性能の個体を1枚ずつ選ばせない。

- 保存デッキは`oracle_id/printing_id + 枚数`を基本にする
- キラ等を選びたい時だけ優先個体を指定できる
- 複数の保存デッキで同じ所持個体を共有してよい
- 40枚側の同名枚数を`oracle_id`単位で数え、4枚以内にする
- 対戦参加時にサーバーが具体的な個体を割り当ててロックする
- 場と40枚側へ同じ個体を二重割当てしない
- 交換/売却後に不足したデッキは「使用不可」にし、不足カードを明示する
- 進行中の試合で使っている個体は、試合終了まで交換/売却不可

試合内では全カードへランダムな`battle_card_id`を割り当て、グローバルな`instance_id`を相手へ出さない。

---

## 6. BPとショップ

### 6.1 BPの原則

- 完全無償
- 現金購入不可
- ユーザー間送付不可
- 現金化不可
- 有効期限なしを初期値とする
- 残高だけでなく、全増減を追記型台帳へ残す

```text
bp_ledger
  transaction_id
  account_id
  delta
  balance_after
  reason
  reference_type
  reference_id
  idempotency_key
  created_at
```

`idempotency_key`へ一意制約を付け、同じ勝利報酬や購入結果を2回反映できなくする。

### 6.2 初期の仮パラメータ

本番値はβログで調整する。ユーザーの基準価格に合わせ、ブースター5枚を150 BP、
追加スターターを1200 BPとする。初回スターターはアカウント保護後に1つ無償で選べる。

| 項目 | 仮値 |
|---|---:|
| 初回スターター | 4種類程度から1個無償 |
| 2個目以降のスターター | 1200 BP |
| ブースター5枚 | 150 BP |
| 報酬対象試合の正常完走 | 両者18 BP |
| 勝利加算 | 勝者+6 BP |
| 引き分け加算 | 両者+3 BP |
| 日次1戦完走 | +10 BP |
| 日次3戦完走 | +15 BP |
| 日次初勝利 | +20 BP |
| NPC Tier 1初回クリア | +30 BP |
| NPC Tier 2初回クリア | +45 BP |
| NPC Tier 3初回クリア | +60 BP |

勝利だけに報酬を寄せると、談合、初心者狩り、切断を誘発する。正常完走、初回クリア、デイリー目標を中心にし、勝利加算は小さくする。

共通試合報酬は、クイック、デュエルスペースPvP、NPC、ルーム、大会へ適用する。
勝率50%、1試合12〜15分の仮定では、5戦程度で約1パック、1日3戦なら追加スターターへ
約11アクティブ日が初期目安となる。目標は次の通り。

- 1パック: 中央値4〜7戦
- 初回パック購入: 累計90分以内またはD2まで
- 2個目スターター: 7〜14アクティブ日
- 勝者:敗者の獲得比: 約4:3

日次上限:

- 通常試合報酬: 240 BP/日
- 日次目標: 45 BP/日
- 大会完走/順位ボーナス: 120 BP/日
- NPC初回クリア等の一度限り報酬: 上限外
- リセット: 毎日04:00 JST

上限到達後も対戦、レート、大会参加はできる。対戦開始前に残り獲得可能BPを表示する。

反復対策:

- ルームの同一ペアは1日3戦まで満額、4〜5戦目半額、6戦目以降0
- 自動マッチの同一ペアは5戦まで満額、6〜10戦目半額、11戦目以降0
- 同じNPC Tierは3戦満額、4〜5戦半額、6戦目以降0
- 報酬は`match_id + account_id + reward_policy_version`で冪等化
- 逓減条件と日次上限は公開し、不正検知の内部閾値だけ非公開

途中終了:

- 正式な投了は、報酬成立条件後なら正常完走として敗者18/勝者24 BP
- 成立条件前の投了、切断、AFK、時間切れは離脱側0 BP
- クイック、デュエルスペースPvP、大会で離脱された側には最低18 BP
- 通常勝利報酬が成立する場合、残された側は24 BP
- ルームは途中離脱最低保証なし
- 一時通信断は90秒の再接続猶予後に判定
- ルール上の正規早期決着は、短時間でも通常報酬

単純な「5分未満は無報酬」は速攻デッキを不当に罰するため使わない。ターン数、意味のある
行動数、同一ペア反復、離脱保証の反復を組み合わせて報酬適格性と不正を判定する。

### 6.3 スターター

- 中身を購入前にすべて表示する
- 初期は4種類程度
- 1アカウントにつき最初の1個を無償で選べる
- 2個目以降は1200 BP
- 1個で合法デッキを作れる個体数を含める
- 初回分は`onboarding_bound`を付け、初期は売却/交換不可にする
- 無償スターターとBP報酬は、LINE/Google等でアカウントを保護してから確定する

無料でも、自分で最初のデッキを選んだ体験を残す。

### 6.4 ブースターパック

価格は150 BP、仮の5枚構成:

- C/UC枠 ×3
- UC以上枠 ×1
- R以上枠 ×1

追加:

- 10パック以内にSR以上を1枚保証
- 排出対象、各枠の確率、保証状況を購入前に表示
- 抽選はサーバーのCSPRNGで行う
- BP引落し、抽選結果、カード個体発行を1トランザクションで確定
- 応答前に注文と結果を保存し、リロードで引き直せないようにする
- 開封演出を飛ばしても同じ結果を再表示する

排出テーブルはコードへ埋め込まず、版付きの`pack_definition`として管理する。

### 6.5 カード売却

売却は運営NPCへの移転として扱い、個体を削除しない。

確認画面:

- カード画像
- 名前
- レアリティ
- 個体番号
- 枚数
- 得られるBP
- 使用不能になるデッキ

安全策:

- お気に入りは初期選択しない
- 最後の1枚は警告
- デッキ使用中は警告
- 進行中試合/交換escrow中は売却不可
- 高レア複数売却は再確認
- 「重複だけ選ぶ」機能

売値は、150 BPパックの期待売却総額が45〜60 BP以下になるよう設定し、購入→即売却でBPが増えないことを自動テストする。

---

## 7. 交換掲示板

### 7.1 NPC交換

ショップ店員が日替わり/週替わりのレシピを提示する。

例:

- 指定UC 3枚 → 指定R 1枚
- 同じR 2枚 → 同弾のランダムR 1枚
- イベント素材カード → 限定加工

抽選を含む場合も結果確定をサーバーで行う。

### 7.2 プレイヤー交換

初期版は構造化された直接交換だけにする。

出品者が指定:

- 出す個体 1〜4枚
- 欲しい`oracle_id/printing_id`と枚数
- 加工条件
- 有効期限

流れ:

1. 出品時に「出す個体」をescrowへ移す
2. 受付中は売却、別出品、対戦ロック不可
3. 受取側が条件を満たす具体的な個体を選ぶ
4. 最終確認で両側のカードを再表示
5. DBトランザクションで全個体を一括移転
6. 一部だけ成功した場合は全体をロールバック
7. 期限切れ/取消で出品者へ戻す

初期制限:

- 登録済みアカウントのみ
- チュートリアル完了
- アカウント作成から一定期間経過
- `onboarding_bound`の初回スターター個体は不可
- BPを交換条件にできない
- 自由記述欄なし
- 認証手段追加/復旧直後は高価値交換を一時停止

交換掲示板内の自由記述、オークション、BP売買は、運用負担とRMT誘導が大きいため後回しにする。

---

## 8. アカウント設計

### 8.1 認証導線

初期:

1. ゲスト
2. LINE Login
3. Google Login

後続:

4. パスキー
5. 回復コード

Apple Loginは、ネイティブアプリ/App IDとの連携が必要になった段階で追加判断する。

### 8.2 ゲスト

- 初回アクセスで匿名アカウントを作る
- NPCチュートリアルと貸出デッキを遊べる
- ブラウザを閉じても同じ端末なら戻れる
- ブラウザデータを消すと失う可能性を明示する
- レート、交換、大会は不可
- 初回スターター報酬を受け取る前にアカウント保護を案内する

ゲストをローカルUUIDだけで扱わず、サーバー上にも匿名`account_id`を作る。これにより、チュートリアル途中のリロード復帰ができる。

### 8.3 外部ID

プレイヤーの内部IDはランダムな`account_id`とし、メールアドレスを主キーにしない。

外部IDは次で一意にする。

```text
(issuer, subject)
```

LINE/Googleのメールが同じでも、自動でアカウント統合しない。ログイン済みの状態から明示的に認証手段を追加する。

### 8.4 セキュリティ

- OAuth/OIDCはAuthorization Code + PKCE
- `state`、`nonce`、issuer、audience、署名、期限を検証
- ブラウザには長期トークンをJavaScriptから読める形で置かない
- `HttpOnly; Secure; SameSite=Lax`の不透明セッションcookieを使う
- WebSocket接続前に短期のmatch seat tokenを発行
- 交換、認証手段の追加/削除、アカウント削除には直近再認証
- 最後の回復可能な認証手段は削除不可
- 新規認証リンク直後の高価値交換にクールダウン
- ログアウト時に全WebSocketを無効化

### 8.5 推奨認証基盤

初期候補は**Supabase Auth**。

理由:

- 匿名サインイン
- Google
- カスタムOAuth/OIDCでLINEを接続可能
- 匿名アカウントから外部IDをリンク可能
- ゲームデータ用PostgreSQLとまとめられる

パスキー機能は2026-07時点で実験扱いのため、初回リリースの必須条件にしない。認証層をadapter化し、安定後に追加する。

クライアントからゲームDBへ直接書かせない。Supabaseは認証に使い、所持、BP、試合、交換の書込みは必ずゲームAPIを通す。

---

## 9. PWA、リロード復帰、下書き保存

### 9.1 正本の置き場所

| データ | 正本 | ローカル |
|---|---|---|
| バトル | match server | 最後のmatch IDと表示用投影だけ |
| 所持カード/BP | PostgreSQL | 読取キャッシュのみ |
| 保存デッキ | PostgreSQL | IndexedDBへキャッシュ |
| 編集中デッキ | サーバー下書き | IndexedDBへ未送信操作 |
| UI設定 | サーバー任意 | IndexedDB |
| カード画像 | 公開アセット | Cache Storage |

PWAやIndexedDBがバトルを維持するのではない。**サーバー上の進行中バトルへ、いつでも戻れること**で復帰を実現する。

### 9.2 バトル復帰

有効な操作ごとに:

1. コマンドを検証
2. 状態を更新
3. revisionを上げる
4. snapshot/command/eventを永続化
5. 各プレイヤーへ見せてよい差分だけ送る

起動時:

1. `GET /me/active-match`
2. 進行中なら自動で復帰画面へ
3. WebSocketを再接続
4. `last_event_sequence`を送る
5. 差分が残っていれば差分、足りなければsnapshotを受け取る
6. 演出を短縮再生または最新状態へ追いつく

同じアカウントの複数タブは、1つだけ操作権を持ち、残りは観戦状態にする。

### 9.3 デッキ下書き

- 変更を即座にIndexedDBへ記録
- 300〜800msのdebounceでサーバーへ保存
- `draft_version`を使う
- 競合時はサーバー版とローカル差分を比較
- 同じ端末の誤リロードは自動復帰
- 別端末では最後にサーバーへ保存できた状態から再開

### 9.4 Service Worker

事前キャッシュ:

- HTML shell
- 最小JS/CSS
- カード裏面
- 共通枠/アイコン
- 最初の画面に必要な画像

実行時キャッシュ:

- カード絵
- SE
- NPC画像

全144枚のカード絵を初回に事前キャッシュしない。容量と初回通信を抑える。

API、認証応答、WebSocket、所持情報はキャッシュしない。

更新版を検出しても、バトル中に`skipWaiting`で強制更新しない。「更新があります」を表示し、バトル外で適用する。

---

## 10. サーバーアーキテクチャ

### 10.1 採用案

```text
Browser / Installed PWA
  ├─ HTTPS API ───────────────┐
  └─ WebSocket ────────────┐  │
                           │  │
Cloudflare Worker API      │  │
  ├─ auth/session          │  │
  ├─ player/inventory      │  │
  ├─ shop/trade            │  │
  └─ tournament API        │  │
                           │  │
Cloudflare Durable Objects │  │
  ├─ MatchDO per match  ◀──┘  │
  ├─ QueueDO per format       │
  ├─ DuelSpaceDO              │
  └─ TournamentDO per event   │
                              │
Supabase / PostgreSQL  ◀──────┘
  ├─ Auth
  ├─ accounts/progression
  ├─ card instances/ledger
  ├─ BP/shop/trade
  ├─ deck revisions
  └─ match summaries/rating
```

静的WebはCloudflare PagesまたはWorkers Static Assetsで配信し、ゲームAPI/WebSocketと同じ`racc.games`配下へ置く。

### 10.2 Cloudflare Durable Objectsを使う部分

`MatchDO`:

- 1試合につき1オブジェクト
- 2人/NPCの接続を集約
- コマンドを直列処理
- サーバー上でエンジンを実行
- snapshot、command log、event sequenceをSQLite storageへ保存
- プレイヤー別projectionと観戦専用projectionを生成
- 観戦用の遅延snapshot/eventを保持
- WebSocket Hibernationを使う
- 期限はalarmで処理

`QueueDO`:

- フォーマットごとの待機列
- 候補選定
- 重複参加防止
- マッチ作成
- 匿名化した`待機者なし/相手が待機中`状態を配信

`DuelSpaceDO`:

- CHごとの店内presence
- NPC/プレイヤー共通actor一覧
- 対戦申請
- 定型スタンプ
- オープンチャットの検証、rate limit、broadcast
- ブロック反映と全CH read-only切替

`TournamentDO`:

- bracket
- check-in
- 補欠/BYE/no-show
- ラウンド開始
- Readyと時刻管理
- 対戦結果の集約
- 大会eventと報酬の冪等化

### 10.3 PostgreSQLを使う部分

カード個体、BP、交換は、行ロック、制約、短いDBトランザクションが重要なためPostgreSQLを正本にする。

Cloudflare WorkerからはHyperdrive等の接続プールを使い、取引中はキャッシュを無効にする。外部API呼出しや重い計算をDBトランザクション内へ入れない。

### 10.4 リポジトリ構成案

```text
engine/
  既存の決定論的ルールエンジン

server/
  src/api/
  src/auth/
  src/durable/MatchDO.ts
  src/durable/QueueDO.ts
  src/durable/DuelSpaceDO.ts
  src/durable/TournamentDO.ts
  src/economy/
  src/projections/
  migrations/

protocol/
  command/event/snapshotの共有型

i18n/
  ja-JP/
  en/

web/
  PWAクライアント

admin/
  カード制作 + 将来のGM運用

data/
  cards/
  formats/
  npcs/
  packs/
  starters/
```

### 10.5 コンテンツ公開

`data/cards.json`を制作正本として残す。

公開CI:

1. releasedデータだけを抽出
2. `oracle_id`、翻訳キー、効果実装を検証
3. `content_version`とmanifest hashを生成
4. Webアセットを公開
5. サーバーへ不変のcontent manifestを登録
6. 新規試合のactive versionを切り替える

進行中試合は開始時の`engine_version`、`content_version`、`format_version`を使い続ける。参照中の旧版をデプロイから削除しない。

### 10.6 開発・検証・本番環境

データ、認証、Durable Object、secretを環境ごとに完全分離する。画面のURLだけ変えて同じDBを
使う構成にはしない。

| 環境 | 用途 | URL例 | データ |
|---|---|---|---|
| local | 日常開発/自動テスト | `localhost` | Wrangler local DO＋Supabase CLI |
| development | 複数端末/外部IdPの結合確認 | `dev-play.racc.games` | dev専用、リセット可能 |
| staging | リリース候補/E2E/移行リハーサル | `stg-play.racc.games` | 本番相当の合成データ |
| production | 一般公開 | `play.racc.games` | 実プレイヤーデータ |

原則:

- Cloudflare Worker、DO namespace/binding、Supabase project、Auth redirect URI、secretを別にする
- `APP_ENV`とDB内の`environment_marker`が不一致なら起動時にfail closed
- non-productionは常に画面上部へ環境名を表示する
- PWAの表示名とruntime configへ環境名を含める。originが異なるためCache Storageは環境間で分離される
- development/stagingからproductionのDB、Auth、DOを参照できない
- productionデータを非本番へコピーしない。必要なら匿名化した最小fixtureを作る
- `cards.racc.games`の制作adminと、将来の`ops.racc.games`のGM機能を別権限/別deployにする

ローカルではSupabase CLIでPostgreSQL/Authを再現し、IdPはテスト用providerまたは開発専用
callbackを使う。LINE/Googleのproduction client secretをローカルへ配らない。

デプロイ:

1. feature branch/PRでtest、build、migration lint、秘匿情報漏洩検査
2. `main`の同一commitをstagingへ自動deploy
3. migrationをstagingで適用し、E2Eと復帰テスト
4. 承認済みcommit/artifactをproductionへ手動昇格
5. production migrationはバックアップ確認後に適用
6. deploy後のsmoke testとメトリクス監視

stagingとproductionで別buildを作らず、環境非依存の同じ成果物へWorkerが実行時設定と
環境別manifestを配信する。
DB変更はexpand → code切替 → contractの順にし、進行中試合が参照する旧版を先に消さない。

現行GitHub Pages版は、オンライン縦切りがproductionで安定するまでCPU対戦βとして残す。

---

## 11. 完全サーバー権威のバトル

### 11.1 クライアントが送るもの

クライアントは結果や新しい状態を送らず、「行動意図」だけを送る。

```ts
interface CommandEnvelope {
  matchId: string;
  commandId: string;
  expectedRevision: number;
  action: MatchAction;
}
```

`MatchAction`は`handIndex`ではなく、安定した`battleCardId`と対象slotを使う。

### 11.2 サーバー処理

```text
セッション確認
→ match seat確認
→ Origin確認
→ commandId重複確認
→ expectedRevision確認
→ schema検証
→ 手番/フェーズ/コスト/対象/所有デッキを検証
→ cloneした状態へ行動適用
→ 成功時だけcommit
→ snapshot/event/commandを永続化
→ プレイヤー別projectionを配信
```

エンジンが例外を出した時に中途半端な状態を保存しない。

### 11.3 秘匿情報

現在の`BattleState`をそのまま送ると、相手の手札と山札順が漏れる。必ずviewer別projectionを作る。

自分に見せる:

- 自分の手札内容
- 公開盤面
- 両者の公開トラッシュ
- 自分に許可された山札の一覧情報
- 合法手候補

相手に見せない:

- 自分の手札内容
- 山札順
- 未公開サーチ結果
- RNG seed/state
- 非公開の具体的カード個体ID

相手向け:

- 手札枚数
- 山札枚数
- AP枚数
- 公開盤面/トラッシュ
- 公開された使用カードとイベント

イベントの`info.text`は廃止し、`code + params`へ変更して、秘匿情報と翻訳の両方をサーバーで制御する。

### 11.4 決定論とリプレイ

試合ごとに保存:

- server-generated seed
- engine version
- content version
- format version
- 初期デッキsnapshot
- 全command
- 各command後のstate hash
- 終了理由

seedと完全ログは試合終了までプレイヤーへ渡さない。

同じ入力から同じ結果になることをCIで検証する。エンジン内では`Math.random()`、`Date.now()`、外部I/Oを禁止する。

### 11.5 時間切れと切断

初期仮値:

- 通常の意思決定: 最大60秒
- guard: 最大30秒
- プレイヤー持ち時間: 8分
- 一時切断猶予: 90秒

サーバー時計だけを正とする。クライアント表示は補助。

自動処理:

- guard時間切れ → pass
- ターン開始能力時間切れ → skip
- プレイ時間切れ → endPlay
- 必須チャージが残る場合 → サーバー定義の決定的な自動チャージ
- 連続2回または合計3回の大きな時間切れ → 敗北

実際の値と処理はプレイテストで調整する。ルームは「ゆっくり」プリセットを選べるようにする。

---

## 12. 主要データモデル

| 集約 | 主なテーブル |
|---|---|
| アカウント | `account`, `profile`, `auth_identity`, `session` |
| 進行 | `npc_progress`, `quest_progress`, `reward_grant` |
| コンテンツ | `content_version`, `card_oracle`, `card_printing`, `format`, `npc_node` |
| 所持 | `card_instance`, `ownership_event`, `card_lock` |
| BP | `bp_wallet`, `bp_ledger` |
| デッキ | `deck`, `deck_revision`, `deck_entry`, `deck_draft` |
| ショップ | `starter_definition`, `pack_definition`, `shop_order`, `pack_result` |
| 交換 | `trade_offer`, `trade_escrow_item`, `trade_acceptance` |
| マッチ | `match`, `match_player`, `match_result`, `match_reward` |
| レート | `rating`, `rating_history` |
| 大会 | `tournament`, `tournament_entry`, `tournament_round`, `bracket_match`, `tournament_event`, `tournament_reward` |
| ソーシャル | `duel_space_channel`, `chat_message`, `player_block`, `chat_report`, `moderation_action` |
| 問い合わせ | `support_ticket`, `support_message`, `support_audit` |
| 運用 | `ban`, `report`, `admin_audit`, `feature_flag`, `environment_marker` |

必須不変条件:

1. `card_instance`の現在所有者は最大1人
2. `AVAILABLE`以外のカードは同時に別用途へロックできない
3. 交換は全個体が移るか、1枚も移らないか
4. `bp_wallet.balance = bp_ledgerの合計`
5. 1つの`shop_order`に抽選結果は1つ
6. 1つの`match_id + reward_type`に報酬は1回
7. 1つの`command_id`は1回だけ適用
8. 1アカウントは同時に1つのレートキューへだけ参加
9. 進行中試合のカード個体は交換/売却不可
10. 1アカウントは同時に1つの進行中大会だけ
11. 1つの`bracket_match`に確定結果は1つ
12. 同じ所持個体をキャラクター枠と40枚側へ二重割当てしない
13. 非本番serviceから本番DB/DOへ接続しない

これらはアプリコードだけでなく、`UNIQUE`、`FOREIGN KEY`、`CHECK`、行ロック、DBトランザクションで守る。

---

## 13. 日本向けUI/UX

### 13.1 モバイルとPC

バトル盤面はモバイル用とPC用に別実装しない。入力、表示、演出、projection購読を持つ
`BattleBoardCore`を共通化し、その外側のresponsive shellだけを変える。

スマホ:

- 縦持ちを第一
- 片手で主要導線を触れる
- safe area対応
- 下部ナビ
- バトルログ、カード詳細、CHチャット、大会表はbottom sheet

PC:

- 共通の縦長盤面を中央または左へ置き、比率を崩して横へ引き伸ばさない
- 余白へバトルログ、カード詳細、CHチャット、観戦人数、大会表のタブを置く
- デッキ編集は一覧と詳細を2ペイン
- デュエルスペースは横方向の余白を活かす
- キーボード操作を提供

対戦中の直接自由チャットは初期には置かない。PC右側へCHチャットを出す場合も、
ブロック/制裁を含むデュエルスペースCHの同じ機能を表示し、別の無監督チャットを作らない。

### 13.2 操作

- 重要操作のヒット領域は44×44 CSS px相当を目標
- ドラッグに必ず「カード選択 → 配置先タップ」の代替を残す
- 使用可能な場所を光らせる
- タップ、マウス、キーボードで同じ行動を行える
- 二重送信中はボタンを無効化し、command ack後に戻す
- 通信待ちと演出待ちを見分けられる表示にする
- 売却/交換は取り返しのつかない対象を再表示する

### 13.3 アクセシビリティ

目標はWCAG 2.2 AA。

- 色だけで属性、合法/非合法、勝敗を表現しない
- 属性アイコンへテキスト名を併記できる
- `prefers-reduced-motion`で演出を短縮
- SEなしでも重要イベントが分かる
- フォーカスを見えるようにする
- カード/手札/ログをDOMとARIAで読める
- 読み上げは「名称、コスト、種類、主要値、状態」の順
- タイマーは視覚だけでなく読み上げ可能にする

### 13.4 初心者保護

現βは最初から144枚、フルルール、8デッキへ触れるため、最初の完走率に課題がある。

- 初戦は固定貸出デッキ
- 手札を3〜4枚へ絞った短縮チュートリアルを検討
- 1戦目に装備/フィールドを出さない
- 「今できること」を1つだけ強調
- アクター交代後に「次に誰が何を使えるか」を表示
- 初戦の目標時間を5〜8分
- 通常PvPの目標中央値を10〜15分

現行シミュレーションでは試合が30ターンを超えやすい。オンライン公開前に、ターン数、山札切れ比率、思考待ち時間を人間同士で測り直す。

---

## 14. 多言語対応

初回公開の表示言語は日本語だけでもよいが、データ構造は最初から分離する。

### 14.1 保存してはいけないもの

DBやプロトコルに次を識別子として保存しない。

- 日本語カード名
- 日本語効果文
- 日本語ログ
- 日本語画面文言

### 14.2 翻訳キー

```text
card.1-A001.name
card.1-A001.effect
card.1-A001.flavor
format.free.name
npc.shopkeeper.tier1.opening
battle.event.damage
```

ルールロジックは`oracle_id`、effect code、数値パラメータで動かす。

現在、同名キャラクター判定に`name`比較を使う箇所は、`oracle_id`比較へ変える。翻訳でゲーム挙動が変わってはいけない。

### 14.3 locale

- 初期: `ja-JP`
- フォールバック: `ja` → `en`
- BCP 47タグ
- 日時/数値は`Intl`
- 文字列連結ではなくICU MessageFormat相当
- 翻訳が30〜50%長くても崩れない
- カード内で読めない時は、文字を極端に縮めず詳細ビューを使う
- 日本語禁則と改行を確認する

カード絵が文字を焼き込んでいないため、現行の`CardFrame`は多言語化に有利。

---

## 15. セキュリティと不正対策

### 15.1 API/WebSocket

- 明示的なOrigin allowlist
- handshakeとメッセージごとの認証/認可
- payload schema検証
- 64KB以下を目安にメッセージサイズ制限
- ユーザー/IP別rate limit
- 1ユーザーの接続数制限
- heartbeatとidle timeout
- セッション失効時に切断
- token/session IDをログへ出さない
- 接続、拒否、異常切断、rate limitを監査

### 15.2 BOT/複数アカウント

- ゲスト作成、ログイン、ルーム試行へTurnstileをリスクベースで適用
- 正常プレイ時間、行動数、即投了を報酬判定へ使う
- 同一相手の反復報酬を制限
- ルーム戦は同一ペア報酬を逓減
- スターター/新規アカウントの交換待機期間
- 異常な勝敗、パック、売却、移転を検出
- 離脱最低保証を反復取得するペア/端末クラスタを検出
- クラウド費用の予算アラート

端末フィンガープリントを唯一のBAN根拠にしない。誤検知を前提に、人間が追跡できる台帳と異議申立て経路を持つ。

### 15.3 チャットとコミュニティ安全

- 投稿前にUnicode正規化、ゼロ幅文字除去、長さ/頻度/禁止パターン検査
- URL、外部連絡先、RMT、個人情報の投稿を初期は拒否
- 通常ログと通報証跡へアクセスできる運営権限を分離
- モデレーターが本文を閲覧した操作も監査
- 自動判定だけで永久BANしない
- 重大な脅迫、児童への接触誘導、個人情報流出はbroadcastせず隔離
- チャットだけを10分/24時間/7日/無期限で止められる
- 送信停止、CH read-only、全チャット停止の3段階kill switch
- 通報対応時間と重大案件の連絡先を運用開始前に決める

ブロックはチャットと直接交流へ適用する。クイック/大会のマッチングからブロック相手を
完全除外すると、強い相手をブロックするレート操作ができるため、対戦する可能性は残す。

### 15.4 管理機能

既存カード制作adminとは権限を分け、GM機能を追加する。

- アカウント検索
- BAN/解除
- カード凍結
- 台帳照会
- 補償イベント発行
- 交換取消
- 試合リプレイ
- レート修正
- 公式大会作成
- チャットログ/通報対応
- チャット制裁と全体停止
- 大会停止/取消/ロック解除
- 問い合わせ対応

管理操作もすべて`admin_audit`へ残す。直接SQLで残高や所有者を書き換えない。

---

## 16. 規約、プライバシー、無料公開

公開前に最低限用意する。

### 利用規約

- サービス終了とデータ取扱い
- バランス/効果/排出率の変更
- 誤発行と補償
- ロールバック
- BANと異議申立て
- BOT、複数アカウント、談合、RMT禁止
- コミュニティガイドラインと禁止投稿
- チャット投稿の削除/非表示、制裁、通報調査
- 年齢帯と保護者同意が必要になる場合の扱い
- カード個体の法的位置付け
- 交換成立時点
- 障害時の扱い

### プライバシーポリシー

- IdPのsubject
- 表示名
- IP/アクセスログ
- 端末/ブラウザ情報
- 対戦/取引履歴
- チャット本文、通報時の前後文脈、ブロック
- 問い合わせ本文と自動添付する診断情報
- 利用目的
- 保存期間
- 委託先/国外移転
- 削除/問い合わせ窓口

### 外部送信

- アクセス解析
- エラー監視
- 認証
- CDN

について、送信先、項目、目的を表示する。現行のGAS匿名テレメトリも、アカウント導入後は新しいポリシーに合わせて置き換える。

法務上の推奨境界:

- BPは無償のまま
- 有償/無償を混ぜない
- BPとカードを現金化させない
- 排出率を表示
- コンプガチャ型の「複数種類を揃えると別の利益」を避ける
- スターターとパックを購入確定前に明示

これは法的結論ではなく、無料公開時の安全側の設計方針。有料化時には別途確認する。

---

## 17. テスト戦略

### 17.1 エンジン

- 現99テストを維持
- serialize → restore → 同じ行動で同じ結果
- seed + command logから同じ最終hash
- property-based test
- 不正action fuzz
- ルール版ごとのgolden replay
- `Math.random/Date/I/O`禁止チェック

### 17.2 秘匿情報

- 相手projectionに手札IDがない
- 山札順がない
- seed/rngStateがない
- eventからサーチ先や未公開カードが漏れない
- エラーログからも漏れない
- spectator projectionへ両者の手札内容/個体ID/legal actionsがない
- 途中観戦でも遅延時点より新しいsnapshot/event/終了結果を取得できない

### 17.3 再接続

- 各phaseでリロード
- guard待機中に切断
- command送信後ack前に切断
- 同じcommandを再送
- 古いrevisionで送信
- 複数タブ
- server deploy/DO hibernation後に復帰

### 17.4 経済

- 同じ注文を100回再送しても1回だけ引落し
- 同じ交換を並列acceptしても1回だけ成立
- escrow中の売却不可
- match lock中の交換不可
- BP台帳合計と残高一致
- 発行個体数と所有/システム状態の合計一致
- パック期待売却額が価格未満
- 場と40枚側へ同じ個体を割り当てられない
- 報酬/離脱保証を100回再送しても1回だけ付与
- 同一ペア逓減と04:00 JSTの日次切替
- 初回無償スターターを売却/交換できない

### 17.5 Web

- iPhone Safari相当
- Android Chrome相当
- PC Chrome/Safari/Firefox
- 390×844を基準に小型/大型端末
- タップ代替で全操作可能
- reduced motion
- キーボード
- Service Worker更新
- offlineからonline復帰

### 17.6 チャット、大会、環境

- NG投稿をbroadcast前に拒否
- rate limit、同一文反復、blockが複数タブでも有効
- 通報時に改変不能な前後文脈を保存
- chat kill switch中は既存接続からも投稿不能
- 3/4、5/8、6/8、7/8人のBYE生成
- 補欠繰上げ、片側/両側no-show、棄権、ラウンド遅延
- チェスクロックは要求された側だけ減り、0で`TIMEOUT`敗北
- `ROUND_RUNNING`からSUSPENDED/復旧しても同じ`match_id`を使う
- 同じ大会結果/順位報酬を再送しても1回だけ反映
- 大会中のリロード、端末変更、deployから復帰
- non-production設定からproduction DB/DOへの接続をCIと起動時に拒否
- stagingでmigrationの前進/復旧手順をリハーサル

CIはrootでengineだけでなく、web、server、migration、E2E、漏洩検査を実行する。PRでもCIを動かす。

---

## 18. テレメトリと運用指標

### 導線

- 初回訪問 → チュートリアル開始
- 開始 → 完走
- 完走 → アカウント保護
- 保護 → 無償スターター選択
- スターター → 2戦目

### バトル

- ターン数
- 実時間
- 思考待ち時間
- guard待ち
- 投了/切断/時間切れ
- リロード復帰成功率
- 先攻勝率
- デッキ/カード別勝率
- 山札切れ比率

### PvP

- キュー待機時間
- マッチ成立率
- 同一相手率
- 対戦完走率
- 通報率
- `待機者なし/相手が待機中`表示からのキュー参加率
- 観戦開始/完走、観戦projection拒否数

### ソーシャル/問い合わせ

- CH閲覧者、投稿者、投稿数
- 投稿拒否理由、rate limit率
- ブロック/通報率
- 通報から初回確認/完了までの時間
- 制裁件数、異議申立て、誤判定
- 問い合わせ種別、受付から初回応答/完了までの時間

### トーナメント

- 募集閲覧→登録→チェックイン率
- 定員充足率、BYE率、no-show率
- ラウンド予定からの遅延
- 即時大会の成立/不成立と待機時間
- 大会完走率、再接続成功率
- 参加者1人あたりBPと同一ペア反復

### 経済

- BP発行/消費
- 平均/中央値残高
- パック購入数
- レアリティ発行数
- 売却数
- 交換成立率
- escrow滞留
- カード集中度
- 初回パックまでの累計試合/時間
- 2個目スターターまでのアクティブ日
- 日次上限到達率
- 離脱最低保証の発生/反復率

初期目標:

- チュートリアル完走率 70%以上
- 初戦中央値 8分以内
- 通常戦中央値 15分以内
- テスト上の再接続成功率 99%以上
- 二重報酬/二重所有 0件
- 日本からの通常行動ack p95 500ms以内
- 初回パックまで中央値4〜7戦
- 2個目スターターまで中央値7〜14アクティブ日
- 日次BP上限到達者1〜3%

サンプル数が少ない間は率だけで断定せず、実際の離脱画面とレビューを一緒に見る。

---

## 19. 実装順

### Phase 0: ルールと版管理を固定

- 3枠と、場/40枚間の同カード・個体の扱いを決定（完了）
- `GAME_RULES.md` v0.10とデッキ検証を同期（完了）
- キャラクター枠の同名複数選択を禁止（完了）
- `oracle_id`導入
- `format`定義
- engine/content/format version
- current branchとmainの統合基準を決定
- 古い文書を現行仕様へ同期

完了条件:

- 同じデッキがどのフォーマットで合法かサーバーなしでも判定できる
- 第1弾の全既存デッキが意図どおり判定される

### Phase 1: オンライン縦切り

- Supabase Auth/PostgreSQL
- Cloudflare Worker
- MatchDO
- local/development/staging/production分離
- staging→production昇格CI
- ゲスト
- LINE/Google
- NPCチュートリアル
- サーバー権威
- reload/reconnect
- PWA shell

完了条件:

- ブラウザを閉じ、別画面から戻っても同じNPC戦を続けられる
- クライアント改変で結果/BPを作れない

### Phase 2: 所持とショップ

- card instance
- ownership/BP ledger
- 初回無償スターター/追加1200 BP
- 5枚150 BPブースター
- 共通試合報酬/日次上限/反復逓減
- 開封復帰
- カード一覧/デッキ下書き
- 売却

完了条件:

- すべての個体の発生源と現在状態を追跡できる
- 注文再送で二重発行されない

### Phase 3: ルームPvP

- room
- player projection
- seat token
- clocks
- reconnect
- replay
- 招待観戦の基礎
- 共通試合BPと同一ペア逓減

完了条件:

- 2台のスマホで一戦を完走
- 両者がリロードしても再開
- 秘匿情報漏れテスト全通過

### Phase 4: デュエルスペースとレート

- NPC/プレイヤー共通presence
- 対戦申請
- QueueDO
- 匿名の待機状況表示
- Glicko-2
- rating history
- anti-farming

完了条件:

- 低人口でも単一待機列で成立
- 同時キュー/二重マッチが起きない

### Phase 5: ソーシャルと観戦

- コミュニティガイドライン/年齢帯方針
- CHオープンチャット
- block/report
- moderation admin/audit
- chat kill switch
- spectator projection
- クイック30秒/大会60秒遅延
- 問い合わせ/意見フォーム

完了条件:

- ブロック/通報/制裁/全体停止を運営画面だけで完結
- 観戦者へ両者の手札と遅延前情報が漏れない
- 日次の通報確認担当と重大案件の連絡経路が稼働

### Phase 6: トーナメント

- 時刻指定4/8人大会
- システム共通4人即時大会
- check-in/補欠/BYE/no-show
- 25分ラウンド/Ready
- deck/card/version lock
- 共通BP/公式順位ボーナス
- 大会復帰/観戦

完了条件:

- 3〜8人の全人数で主催者の手入力なしに完了
- 開始後のカード/ルール更新が大会へ影響しない
- 結果/報酬の再送で二重反映されない

### Phase 7: 交換

- NPC交換
- escrow
- プレイヤー交換
- 取引制限
- GM凍結/補償

完了条件:

- 並列accept、取消、期限切れ、障害復帰で台帳が崩れない

### Phase 8: 最新N弾

- `LATEST_N`
- 禁止/制限改定
- フォーマット別キュー/大会

完了条件:

- 弾追加/ローテーション時に保存デッキの合法性を正しく再判定
- 進行中試合/大会は開始時の旧フォーマットを維持

---

## 20. 決定済みと残る意思決定

| 論点 | 状態 | 決定/推奨 |
|---|---|---|
| キャラクター枠 | 決定 | 3枠ちょうど、実カード2〜3枚 |
| 場の同名キャラクター複数 | 決定 | 不可。同名1枚まで |
| 場と40枚の同カード | 決定 | 入れられるが同じ個体の共有不可 |
| 同名上限 | 決定 | 40枚側を`oracle_id`で数えて4枚。場は合算しない |
| 初期スターター | 決定 | 1個無償、2個目以降1200 BP |
| ブースター | 決定 | 5枚150 BP |
| 共通対戦BP | 仮値 | 完走18、勝利+6 |
| 途中離脱最低保証 | 決定 | ルーム以外で残された側へ最低18 BP |
| 初期認証 | 推奨 | ゲスト → LINE主/Google副 |
| パスキー | 推奨 | 初回必須にせず後から追加 |
| DB | 推奨 | PostgreSQL |
| 対戦セッション | 推奨 | Cloudflare Durable Objects |
| カード個体履歴 | 推奨 | DB追記型台帳、ブロックチェーン不採用 |
| プレイヤー交換 | 推奨 | カード同士のみ、escrow |
| レート | 推奨 | Glicko-2、誰でもマッチ |
| クイック待機表示 | 決定 | `待機者なし/相手が待機中` |
| ルーム | 決定 | 招待URL/コードのみ、レートなし、共通BP |
| デュエルスペース | 決定 | NPC/プレイヤーを同じactorレイヤーへ表示 |
| CHチャット | 決定 | 公開テキストを通報/ブロック付きで導入 |
| CH投稿可能年齢 | 要決定 | 不明/低年齢はスタンプ限定を安全側初期値 |
| 観戦 | 推奨 | 手札非公開、roomリアルタイム/quick 30秒/大会60秒 |
| 時刻指定大会 | 推奨 | T-10募集締切、T-2 check-in締切、25分ラウンド |
| 即時大会 | 推奨 | 共通4人キュー、3人なら3分後開始、2人以下10分で不成立 |
| 大会順位報酬 | 推奨 | システム/公式だけ。ユーザー主催は実戦BPのみ |
| バトル画面 | 決定 | mobile/PCで共通board、PC余白に補助panel |
| 問い合わせ | 決定 | ゲーム内フォーム＋match/build診断情報 |
| 環境 | 推奨 | local/development/staging/productionを完全分離 |
| 初期フォーマット | 推奨 | FREEのみ |
| NPC強化 | 推奨 | Tier 1〜3の解放グラフ |

---

## 21. 主なリスク

### High: 初心者が最初の1戦を完走しない

既存βでも兆候があり、現行AI同士は30ターンを超えやすい。機能追加より先に、短いチュートリアルと通常戦の目標尺を決める。

### High: オープンチャットの運営が追いつかない

通信機能だけ先に出すと、通報の未処理と重大投稿の見逃しが発生する。通報管理、制裁、
ログ監査、kill switch、日次担当を先に完成させ、限定CHから開放する。

### High: クライアント状態を流用して秘匿情報が漏れる

現`BattleState`は両者の完全情報を持つ。サーバー移植より先にprojection境界を作る。

### High: 交換解放でBOT/RMT価値が生まれる

無料でも交換可能な希少カードには外部価値がつく。交換は対戦基盤より後、登録/経過日数/escrow/監査/凍結を揃えてから開放する。

### High: ルーム/大会報酬が複数アカウント農場になる

全モード共通BPは遊び方を選ばせない利点がある一方、招待卓とユーザー大会は相手を固定できる。
同一ペア逓減、初回スターター拘束、順位ボーナスのシステム大会限定、離脱保証の反復検出を
同時に入れる。

### High: 観戦projectionまたは遅延から秘匿情報が漏れる

player stateの削除変換ではなく公開allowlistで別生成し、遅延snapshot、event、試合終了表示を
サーバーで同じ時刻へ揃える。

### Medium: ルール/カード更新で進行中試合が変わる

版を固定し、参照中の旧エンジンを残す。

### Medium: 大会の長期戦とno-showで予定が崩れる

25分ラウンド枠、8分持ち時間、Ready、接続期限、BYE、二重不在を自動処理し、更新後の
開始予定を参加者へ表示する。

### Medium: PWAを過信する

モバイルOSはタブとWebSocketを停止できる。サーバーsnapshotと復帰を正とする。

### Medium: 非本番から本番データへ誤接続する

環境別binding/project/secretだけでなく、`APP_ENV`とDB側markerの一致を起動時に検査する。

### Medium: 現ブランチとmainが分岐している

2026-07-29時点で`feat/ingame-fx`と`main`は双方に固有コミットがある。実装開始前に統合し、設計実装の基準ブランチを1つにする。

---

## 22. 調査根拠

技術:

- [Cloudflare Durable Objects WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cloudflare Durable Objects Environments](https://developers.cloudflare.com/durable-objects/reference/environments/)
- [Cloudflare Wrangler Environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Custom OAuth/OIDC Providers](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Supabase Local Development](https://supabase.com/docs/guides/local-development)
- [Supabase Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [LINE Login Web/OIDC](https://developers.line.biz/ja/docs/line-login/integrate-line-login/)
- [LINE Login PKCE](https://developers.line.biz/ja/docs/line-login/integrate-pkce/)
- [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [Glicko-2](https://www.glicko.net/glicko.html)
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/sql-set-transaction.html)

PWA/UX:

- [MDN Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)
- [WebKit Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Apple Web Push for Home Screen Web Apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)
- [Apple HIG Buttons](https://developer.apple.com/jp/design/human-interface-guidelines/buttons)
- [Google Passkey User Journeys](https://developers.google.com/identity/passkeys/ux/user-journeys)
- [Unicode CLDR](https://unicode.org/reports/tr35/)
- [W3C日本語組版処理の要件](https://www.w3.org/TR/jlreq/)

法務/運用の論点:

- [金融庁 FinTechサポートデスク・前払式支払手段](https://www.fsa.go.jp/news/27/sonota/20151214-2.html)
- [消費者庁 コンプガチャと景品表示法](https://www.caa.go.jp/policies/policy/representation/fair_labeling/guideline/pdf/120518premiums_1.pdf)
- [経産省 電子商取引及び情報財取引等に関する準則](https://www.meti.go.jp/press/2024/02/20250212003/20250212003-1r.pdf)
- [個人情報保護委員会 通則ガイドライン](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/)
- [個人情報保護委員会 子どもの同意に関するFAQ](https://www.ppc.go.jp/all_faq_index/faq1-q1-62/)
- [警察庁 子供の性被害防止](https://www.npa.go.jp/policy_area/no_cp/prevent/self-portrait.html)
- [違法・有害情報相談センター（総務省委託事業）](https://ihaho.jp/aboutus/index.html)

法務部分は実装上の安全境界を決めるための論点整理であり、個別案件への法的助言ではない。
