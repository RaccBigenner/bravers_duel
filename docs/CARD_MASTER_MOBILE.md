# カードマスター管理をスマホから使う（クラウド版）

外出先のスマホから、ブラウザだけでカード管理できる。**アプリ不要・PCの電源も不要**。

## URL

**https://cards.racc.games**

## 仕組み（なぜ安全か）

- 管理画面は **Cloudflare Pages**（bravers-admin）で動く。24時間いつでも使える
- カードのデータは **GitHub の2つのリポジトリ**に入っている
  - 公開ずみの弾 → `RaccBigenner/bravers_duel`（公開リポ）の `data/cards.json`
  - **制作中の弾 → `RaccBigenner/bravers_duel_wip`（非公開リポ）** の `cards/volN.json` /
    `sets.wip.json` / `images/` / `effects/volN.ts` / `effects/volN.test.ts`
  - 制作中のテーマ名やサブタイトルも非公開リポにしか置かない（公開リポの `sets.json` は
    誰でも読めるので、そこに書くと必ず漏れる）
- 弾公開の重い画像コピーと全テストは **非公開リポのGitHub Actions** で動く。
  Cloudflareは画像本体を読まず、カード・弾・効果・test・画像SHAを固定して公開ジョブを起動するだけ
- Actionsは検証済みのカード・弾・全画像・効果module・回帰testを公開リポへ1コミットでpushする。
  失敗ログも非公開なので、公開に失敗したWIPの名前や効果文が外へ漏れない
- **Cloudflare Access** が `cards.racc.games` 全体に認証をかける。
  許可されているのは `racc.beginner@gmail.com` だけ（ポリシー名「Racc only」）
- 画面もデータAPI（`/api/master` など）も、未認証だと **302 で認証画面に飛ばされる**（実測確認ずみ）

## 使い方

1. スマホ/PCのブラウザで **https://cards.racc.games** を開く
2. 「Sign in with: **Cloudflare**」を押して、Cloudflare アカウント（`racc.beginner@gmail.com`）でログイン
3. 管理画面が開く。カード編集・画像アップロード・公開まで全部できる
   （認証は24時間有効。1日1回くらいの入力で済む）

ホーム画面に追加しておくとアプリのように使える。

## 画面の見方（スマホ）

下に **5つのタブ** がある。最初に出るのは必ずカード一覧。

| タブ | できること |
| --- | --- |
| **カード** | 一覧・検索・絞り込み・並び替え・カードの編集 |
| **並び** | 弾内の表示順・Printing ID採番 |
| **集計** | 種類・レアリティなどの集計 |
| **弾の設定** | テーマ名・サブタイトル・公開日など、弾そのものの情報 |
| **チェックと公開** | 効果の実装状況、公開前チェック、弾の公開 |

### 一覧

- 見た目は3通りから選べる。ボタンで切り替わる
  - **カード**…ゲームと同じカードデザインで並ぶ（既定）。大型カードは横向きのまま出る
  - **リスト**…1行に 名前・レア・種類・Printing ID・コスト・数値・属性・効果文 が並ぶ。見比べる時はこちら
  - **表**…PCのみ。全項目を表で見比べる
- 「絞り込み」を押すと、種類・レア・コスト・属性で絞れる。
  「未実装のみ」「画像なしのみ」「制作中のみ」「効果ありのみ」も選べる
- 並び替えは 番号・コスト・数値・レアリティ・名前・種類（昇順／降順）
- カードの左上・左下に出るバッジは **未実装 / 公開時に検査 / 制作中 / 画像なし** の印。
  非公開効果moduleがある制作中弾は、内容をブラウザへ漏らさず青い「公開時に検査」と表示する

### カードを編集する

カードを押すと下から編集画面が出る。上の「← 一覧へ」で戻ると、**元の位置に戻る**。
**保存と削除は画面の一番下に貼り付いている**ので、スクロールしなくても押せる。

カードには2種類のIDがある。

- **Printing ID** … 弾・番号・レアリティを含む収録単位。画像ファイル名にも使う
- **Oracle ID** … ゲーム上の「同じカード」。再録カードでは元カードと同じOracle IDを指定する

通常の新規カードはOracle IDが自動発行される。旧形式カードの仮Oracleが表示された場合は、
再録元のOracle IDを入力するか「新規Oracleを発行」で確定するまで公開できない。

### 弾を公開する

「チェックと公開」タブの **「第N弾を公開する」**。
公開前チェック（カード有無・画像・効果module/test・基本値・二層ID）が **全部緑になるまで押せない**。
押すと、制作中のカード・画像・効果・回帰testが公開リポジトリへ移り、数分でゲームに出る。
処理中はカード編集がロックされ、画面がGitHub Actionsの完了を追跡する。
ブラウザを閉じても処理は続く。「公開処理中」のままなら同じボタンを押せば安全に再開できる。

## 画像アップロードについて

「画像を選ぶ / 撮影」から、スマホの写真をそのまま上げられる。
アップロード時に **長辺800pxの webp に自動変換** される。

iPhone で「形式が違う」と怒られていた問題は解消済み。理由は2つあって、両方に対策が入っている。

1. HEIC など、ブラウザがそのままでは読めない形式 → `<img>` 経由で読み直す
2. Safari がキャンバスから webp を書き出せない（黙って png になる）
   → webp になったか必ず確かめ、駄目なら **webp エンコーダ（wasm）で変換**する

エンコーダはこの分岐に入った時だけ読み込むので、普段の速度は落ちない。

## 保存すると何が起きるか

管理画面の保存ボタンは、GitHub に直接コミットする（PCは一切関係ない）。

| 操作 | 保存先 |
| --- | --- |
| 制作中の弾のカードを保存 | 非公開リポ `cards/volN.json` |
| 公開ずみの弾のカードを変更 | 管理画面では不可。リポジトリで変更しテストを通す |
| 制作中の弾メタを保存 | 非公開リポ `sets.wip.json` |
| 制作中の効果と回帰test | 非公開リポ `effects/volN.ts` / `effects/volN.test.ts`（リポジトリで編集） |
| 画像アップロード（制作中） | 非公開リポ `images/{printingId}.webp` |
| 画像アップロード（公開ずみ） | 管理画面では不可（公開先は `assets/card_images/{printingId}.webp`） |
| 弾を公開（publish-set） | SHA固定manifestを非公開リポへ保存し、非公開Actionsが公開1commitとWIP cleanupを実行 |

## 表示が速い理由（さわる時の注意）

`/api/master` は **画像の一覧（ファイル名と版番号）もまとめて返す**。Git Trees APIを使うため、
1ディレクトリ1,000件を超えても欠落しない。管理画面はこれで
「画像があるか」を判断し、画像URLに `?v=版番号` を付ける。中身が変わった時だけURLが変わるので、
2回目からは画像を取りに行かない。

以前は画像を1枚ずつ確かめていて、1回開くたびに約290回の通信が出ていた。
**この仕組みを壊すと一気に遅くなる**ので、画像まわりを直す時は気をつける。

## 公開Actionsの初回設定

Cloudflare版をこの構成へ切り替える前に、次の3点を先に設定する。
効果module/testが無ければlock前に公開を拒否し、workflow/secretの設定不備があっても
WIPを推測で削除せず、再試行できる状態に保全する。

1. このリポの `ops/bravers_duel_wip/.github/` **全体**を、非公開リポ
   `RaccBigenner/bravers_duel_wip` の `.github/` へ同じ相対パスでコピーし、
   mainへcommitする。必須ファイルは次の3つ:
   - `.github/workflows/publish-set.yml`
   - `.github/scripts/publish-card-set.mjs`
   - `.github/scripts/decode-webp-sandbox.sh`（実行bit `100755` を維持）
2. 公開する各弾について、非公開リポへ `effects/volN.ts` と
   `effects/volN.test.ts` を用意する。効果なしの弾も空moduleと回帰testが必要
3. 公開リポ`RaccBigenner/bravers_duel`だけを対象にし、
   **Contents: read/write**を持つfine-grained PATを作る。非公開リポの
   Settings → Secrets and variables → Actionsで
   `PUBLIC_PUBLISH_TOKEN`というRepository secretに保存する

workflowは外部取得をprivate checkout前に終え、外部Actionsをfull commit SHA、
validation用Node base imageをOCI digestへ固定する。`webp` decoder packageの取得と
runtime imageの組み立てもprivate checkout前に終える。
公開候補のtest/buildは対象弾を反映した候補copyだけ、WebP decoderは対象画像1枚だけを
networkなしのcontainerへmountする。WIP checkout全体や資格情報はmountしない。
テストログとsnapshotは非公開リポ側にだけ残る。
公開リポのmainは、このtokenによる通常のfast-forward pushを許可する必要がある。

## 運用で注意する3つのGitHubトークン

権限を1本へ集めない。次の3つを別々のfine-grained PAT / Secretにする。

| Secret名 | 置き場所 | 対象と最小権限 |
| --- | --- | --- |
| `GITHUB_PRIVATE_TOKEN` | Cloudflare Pages | `bravers_duel_wip`: Contents read/write、Actions read/write |
| `GITHUB_PUBLIC_TOKEN` | Cloudflare Pages | `bravers_duel`: Contents read-only |
| `PUBLIC_PUBLISH_TOKEN` | 非公開リポActions | `bravers_duel`: Contents read/write |

旧 `GITHUB_TOKEN` は2026-07-25発行・30日期限（2026-08-24ごろ）だが、
両リポwrite権限を1本に持つ旧構成なので、新しい2本へ移行後にrevokeする。

### 更新のしかた

1. GitHub → Settings → Developer settings → Fine-grained tokens で、
   上表どおり対象リポと権限を分けて3本を発行する
2. Cloudflare Pages → bravers-admin → Settings → Variables and Secrets で
   `GITHUB_PRIVATE_TOKEN` と `GITHUB_PUBLIC_TOKEN` をSecretとして設定する
3. 非公開リポ → Settings → Secrets and variables → Actionsで
   `PUBLIC_PUBLISH_TOKEN`を設定する
4. **管理画面を再デプロイする**（環境変数を変えただけでは反映されない）

```
cd admin
npx vite build
npx wrangler pages deploy dist --project-name bravers-admin --branch main
```

3本とも有効期限つき。どれかが切れてもWIPを推測で削除せず保全する。
同じ最小権限のtokenへ差し替え、管理画面tokenなら再デプロイ後、
Actions tokenならそのまま同じ公開ボタンから再開する。

## 管理画面のプログラムを直したときも同じ

上の再デプロイコマンドを流せば反映される。

### ⚠ よくある間違い

**GitHub に push しても管理画面は変わらない。**
公開サイト（GitHub Pages）は main への push で自動デプロイされるが、
管理画面は Cloudflare Pages にあり、**上のコマンドを手で流さないと更新されない**。
push だけして「反映した」と思い込む事故が実際に起きた。

**`--branch main` を必ず付ける。**
wrangler は「今いる git ブランチ名」をそのまま Cloudflare のブランチとして送る。
作業ブランチ（例 `feat/xxx`）にいるまま流すと **プレビュー環境にしか入らず**、
`cards.racc.games` は古いままになる。デプロイ後は

```
npx wrangler pages deployment list --project-name bravers-admin
```

で先頭行が `Production` / `main` になっているか必ず確かめる。

なお `cards.racc.games` は Cloudflare Access で守られているため、
curl などで外から中身を取って確認することはできない（302 が返る）。
最終確認はブラウザで開いて目で見る。

## セキュリティ

- `cards.racc.games` は Cloudflare Access で保護。`racc.beginner@gmail.com` 以外は入れない
- 制作中カードのデータと画像は **非公開リポにしか無い**。公開リポにも公開サイトにも出ない
- `GITHUB_PRIVATE_TOKEN` / `GITHUB_PUBLIC_TOKEN` はCloudflareのSecret。
  private writeとpublic readを分離し、画面・レスポンス・ログへ出さない
- `PUBLIC_PUBLISH_TOKEN` は非公開リポのActions secret。公開リポのContents以外は許可しない
- JSON変更APIはAccess認証に加え、same-origin `Origin`、`Sec-Fetch-Site`、
  `Content-Type: application/json`を必須にしてCSRFを拒否する
- Cloudflare Accessアプリ「cards」のCookie settingsは、単一ドメイン運用中は
  application-domain `CF_Authorization` のSameSiteを **Lax** にする。
  [Cloudflareの仕様では既定はNoneで、Strictはredirect loopになり得る](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)ため使わない
- WIP画像とAPI JSONは `no-store`。公開済み画像だけ長期cacheを許可する
- 公開前workflow、trusted scripts、ログ、snapshot manifestはすべて非公開リポ側に置く。
  [GitHubの推奨](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)どおり
  外部Actionsはfull commit SHA、validation Node base imageはOCI digestへ固定する
- **自己チェック**: Cloudflare にログインしていない別ブラウザで `cards.racc.games` を
  開くと、必ず認証画面が出て中身は見えないのが正常

## 主要なID・設定値（触るとき用）

| 名前 | 値 |
| --- | --- |
| Cloudflare アカウントID | `cb2f894ddc398afb811ed0bc31c29ff4` |
| Pages プロジェクト | `bravers-admin`（`bravers-admin.pages.dev`） |
| DNS | `cards` CNAME → `bravers-admin.pages.dev`（Proxied） |
| Access アプリ | 「cards」 app id `1f6c492d-ffdb-4212-b912-3242783dddfb` |
| Access チームドメイン | `https://fragrant-paper-4363.cloudflareaccess.com` |
| Access AUD | `16b7b946a0a56c4f59bb84441750ee6a22576bb769b4eeef94dc2ff914e4c737` |

## 昔のやり方（Cloudflare Tunnel 版）に戻したいとき

2026-07-26 まではPCの中で管理画面を動かし、Cloudflare Tunnel で外から繋いでいた。
「PCが起動していないと使えない」制約があったのでクラウド版に置き換えた。
トンネル `bravers-admin`（id `b53250e2-800b-48ec-8b37-54062cc3de09`）は消していないので戻せる。

1. Cloudflare DNS で `cards` の CNAME を
   `b53250e2-800b-48ec-8b37-54062cc3de09.cfargotunnel.com` に戻す
2. PCで管理画面とトンネルを動かす。自動起動の LaunchAgent は消したので作り直す:

`~/Library/LaunchAgents/com.bravers.admin.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.bravers.admin</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>/Users/maedayuto/.nodebrew/current/bin/npm</string>
    <string>--workspace</string><string>admin</string><string>run</string><string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/maedayuto/Desktop/games/bravers_duel</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/maedayuto/.nodebrew/current/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/bravers-admin.log</string>
  <key>StandardErrorPath</key><string>/tmp/bravers-admin.err</string>
</dict>
</plist>
```

`~/Library/LaunchAgents/com.bravers.tunnel.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.bravers.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string><string>run</string><string>bravers-admin</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/bravers-tunnel.log</string>
  <key>StandardErrorPath</key><string>/tmp/bravers-tunnel.err</string>
</dict>
</plist>
```

```
launchctl load ~/Library/LaunchAgents/com.bravers.admin.plist
launchctl load ~/Library/LaunchAgents/com.bravers.tunnel.plist
```
