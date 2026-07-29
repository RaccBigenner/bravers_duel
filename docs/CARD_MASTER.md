# カードマスター管理（管理画面と弾の運用）

第1弾のカードプールが完成し、第2弾以降を作っていくための仕組み。
他社TCG（MTG/Scryfall・ポケカ・遊戯王）のデータ管理を調べて設計した。

## 基本の考え方

- **カードは「弾（セット）」に属する**。弾のメタ情報は公開済みが `data/sets.json`、
  制作中は非公開リポ `bravers_duel_wip` の `sets.wip.json`。
  **制作中の弾のメタ情報を公開リポの `data/sets.json` に書かないこと**
  （このファイルは丸ごとブラウザに配信されるので、書いた文字列は必ず外から読める）。
  社長の言う「弾数」と「テーマNo.」を別フィールドで持つ（MTG の set と block の二軸に対応）。
- **公開されるのは `status: 'released'` の弾のカードだけ**。制作中の弾は `status: 'draft'`。
- **制作中カードは公開リポ・公開ビルドに入らない**。非公開リポの
  `cards/volN.json`、`images/`、`effects/volN.ts`、`effects/volN.test.ts` に置く。
  静的配信では「クライアントに入ったデータ＝誰でも読める」ため、UIを隠すのではなく
  **データ自体を公開ビルドから外す**のが唯一確実な方法（Hearthstone等の実際のリーク事例に基づく）。

## 管理画面を開く

通常運用は **https://cards.racc.games** を使う。Cloudflare Pages上の管理画面全体を
Cloudflare Accessで認証し、Pages Functionsが制作中データを非公開リポへ保存する。
弾公開だけは画像量が大きいため、非公開リポのGitHub Actionsが検証と公開を担当する。
詳しいログイン・トークン更新・デプロイ手順は `docs/CARD_MASTER_MOBILE.md` が正本。

開発時だけ `npm run admin` で `http://localhost:5273` を起動できる。ローカル版は
`data/wip/` と `assets/wip_card_images/`（ともにgitignore）を使うテスト用ミラーで、
クラウド運用の非公開リポとは自動同期しない。

### できること

- 弾タブで弾を切り替え／新しい弾を作る
- 弾のメタ情報（テーマNo.・テーマ名・サブタイトル・パックタイプ・公開日）を編集
  （弾数と状態は事故防止のため直接変更不可）
- カードの一覧・検索・フィルタ（種類/レア/未実装のみ）
- カードの追加（弾内で `A001` から自動連番）・編集・削除
- **効果の実装状況を可視化**。制作中moduleの中身は管理画面へ配信せず
  「公開時に検査」と表示し、非公開Actionsで完全性を判定
- **公開前チェック**（空弾、画像、効果module/test、基本値、二層ID、重複を判定）
- スキルの基本値の理論値（`(コスト+1)×2−1＋(条件属性数−1)＋盾ガード+1`）を表示・ワンタップ適用

### 保存先の自動振り分け

- 制作中カード／画像 → 非公開リポ `cards/volN.json`／`images/{printingId}.webp`
- 制作中効果／回帰test → 非公開リポ `effects/volN.ts`／`effects/volN.test.ts`
- 公開ボタン → Pages Functionsがカード・弾・効果・test・全画像SHAを固定し、非公開GitHub Actionsを起動
- Actions → カード・弾・画像・効果module・回帰test・生成registryを**単一Git commit**で反映
- 公開済み弾は管理画面から変更・削除しない。修正時は公開リポを直接編集してCIを通す

画像処理をActionsへ分ける理由は、[Cloudflare Workers FreeのCPU 10ms・50 subrequests制限](https://developers.cloudflare.com/workers/platform/limits/)と、
[GitHub RESTのcontent生成上限](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)を
弾の枚数に依存せず守るため。Workerから画像ごとにblobを作る実装には戻さない。

## 新しい弾（例: 第2弾）を作る流れ

1. `https://cards.racc.games` を開いて認証する
2. 「＋ 新しい弾」→ メタ情報を入力。**状態は draft のまま**。
   テーマ名は公開直前まで「コードネーム」で伏せてもよい（コミット履歴からの漏れ防止）
3. 「＋ カード追加」でカードを作る。draft弾は非公開リポだけに保存される
4. 効果は非公開リポの `effects/vol2.ts` に `VOL2_EFFECTS` として書く。
   同じ場所の `effects/vol2.test.ts` に弾固有の挙動テストも書く。
   **公開リポの `engine/src/effects/` へ先置きしない**（importすると公開JSへ焼き込まれる）
5. 「公開前チェック」が全て緑になったら「第N弾を公開する」を押す。Pages Functionsは
   全カード画像、vol、ID、Oracle定義を再検査し、カード・効果・test・画像の
   SHA付きmanifestを非公開リポへ保存して
   弾を`publishing`にロックする
6. 非公開GitHub Actionsが固定snapshotをrunner内で組み立て、
   networkなしの隔離copyで`npm test`・型検査・build・漏洩検査を通してから、
   カード・画像・効果・test・released弾メタを単一commitで公開する
7. 公開成功後に同じActionsがWIPを単一commitで掃除する。途中失敗時は同じ公開ボタンで
   完全一致を確認して再開できる
8. 公開リポへのpushで通常のPages CIが動き、ゲームへデプロイする

## 安全網（多層防御）

1. **認証と物理分離**: 管理画面はAccess認証、制作中データは非公開リポだけ
2. **固定snapshot**: `publish_jobs/active.json`へカード・効果・test・画像SHAとrequest IDを保存し、
   公開中は対象弾の全編集を止める
3. **原子的公開**: cards・sets・画像・効果・testは1つのGit commitで同時に可視化
4. **隔離された検証**: 外部取得をWIP checkout前に完了し、公開候補のtest/buildは
   対象弾を反映した公開候補copyだけをmountした、networkなし・資格情報なし・
   非対象WIPなしのcontainerで実行。画像decoderは対象画像1枚だけをmountして隔離
5. **engine のゲート**: `ALL_CARDS` は released の弾のカードだけ（`engine/src/cards.ts`）
6. **CI の最終スキャン**: `scripts/check-no-wip-leak.mjs` が公開ビルドJSを走査し、
   未公開のテーマ名・コードネーム・制作中カード名が混入していたらデプロイを止める
7. **テスト**: `engine/test/sets.test.ts` が公開弾・画像・効果の存在/種別・stray・
   module間Oracle重複を検査し、弾固有の `engine/test/effects/volN.test.ts` が挙動を検査

## データ形式

### data/sets.json（公開済みの弾だけ）

> ⚠️ **制作中の弾はここに書かない。** `data/sets.json` は JSON import で丸ごと公開バンドルに
> 埋め込まれるので、使っていなくても中身は開発者ツールから読める。
> 実際に第2弾のサブタイトルが公開JSに入っていた（2026-07-25 に発覚・修正）。
> 制作中の弾メタの置き場:
> - ローカル管理画面 … `data/wip/sets.json`（gitignore）
> - クラウド管理画面 … 非公開リポ `bravers_duel_wip` の `sets.wip.json`
>
> 保存時に status で自動的に振り分けられ、公開ボタンで公開側へ移る。
> 破ると `engine/test/sets.test.ts` と `scripts/check-no-wip-leak.mjs` が落ちる。

```json
{
  "sets": [
    {
      "vol": 1,
      "themeNo": 1,
      "themeName": "聖戦残火",
      "themeSubtitle": "禍いの足音",
      "packType": "DX",
      "status": "released",
      "releasedAt": "2026-07-01",
      "codename": ""
    }
  ]
}
```

### カード（公開 `data/cards.json` / 非公開 `cards/volN.json`）

カードIDは次の二層を必須で持つ。

```json
{
  "oracleId": "1-A001",
  "printingId": "1-A001-LSR",
  "vol": 1,
  "code": "A001",
  "rarity": "LSR"
}
```

- `oracleId`: ゲーム上の不変な同一性。コピー上限、同名回復、効果、禁止・制限判定に使う
- `printingId`: 収録弾、番号、レアリティ、画像を表す。従来の `id` の値をそのまま維持する
- 旧 `id` だけの制作中データは管理APIの読込境界で互換変換し、
  `oracleIdProvisional: true` を付けて保存する。採番後もこの印は残り、
  再録元のOracle指定または新規Oracle発行で明示確定するまで公開できない
- `status?: 'draft' | 'released'` は従来どおり任意（省略＝弾の状態に従う）

公開第1弾の一括移行は `scripts/migrate-card-identities.mjs` を使う。
Oracleの自動採番は既定でvol1 bootstrapだけに限定され、他の弾は再録判定を誤らないよう
`oracleId` の明示指定が必須。複数ファイルを渡した場合も、全入力のPrinting ID衝突を検査してから書く。

### 効果moduleと弾固有test

クラウド制作中の正本は非公開リポの次の2ファイル。

- `effects/volN.ts`: `VOLN_EFFECTS` をexportするOracle効果module
- `effects/volN.test.ts`: Vitestの `test(...)` / `it(...)` を含む弾固有の回帰test

公開時にそれぞれ `engine/src/effects/volN.ts` と
`engine/test/effects/volN.test.ts` へ同じsnapshotのまま移り、
`engine/src/effects/released.ts` も弾一覧から決定的に再生成される。
同じOracleを複数の弾moduleで定義すると公開ゲートが停止する。再録は元の効果を継承するため、
新弾moduleへ同じOracleの効果を重ねて書かない。

ローカルミラーでは正本を `data/wip/effects/volN.ts` と
`data/wip/effects/volN.test.ts` に置く。ローカル公開も効果testとengine型検査が通るまで
公開側への変更を確定せず、失敗時は全対象を元へ戻す。

## 再録・エラッタの運用

- 再録は新しい `printingId` を発行し、元カードと同じ `oracleId` を明示的に指定する
- 表示名から同一カードかどうかを推測しない
- レアリティ、コード、弾内の並びを変えても `oracleId` は変更しない
- カード画像のファイル名と採番変更時の画像移動は、必ず `printingId` を使う
- 同じ `oracleId` の収録違いでは、種類、HP、属性、コスト、基本値、実装効果などのゲーム定義を一致させる
  （`effectText` は翻訳・表記整理で変わってよい）
