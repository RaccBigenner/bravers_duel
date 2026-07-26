# カードマスター管理をスマホから使う（クラウド版）

外出先のスマホから、ブラウザだけでカード管理できる。**アプリ不要・PCの電源も不要**。

## URL

**https://cards.racc.games**

## 仕組み（なぜ安全か）

- 管理画面は **Cloudflare Pages**（bravers-admin）で動く。24時間いつでも使える
- カードのデータは **GitHub の2つのリポジトリ**に入っている
  - 公開ずみの弾 → `RaccBigenner/bravers_duel`（公開リポ）の `data/cards.json`
  - **制作中の弾 → `RaccBigenner/bravers_duel_wip`（非公開リポ）** の `cards/volN.json` /
    `sets.wip.json` / `images/`
  - 制作中のテーマ名やサブタイトルも非公開リポにしか置かない（公開リポの `sets.json` は
    誰でも読めるので、そこに書くと必ず漏れる）
- **Cloudflare Access** が `cards.racc.games` 全体に認証をかける。
  許可されているのは `racc.beginner@gmail.com` だけ（ポリシー名「Racc only」）
- 画面もデータAPI（`/api/master` など）も、未認証だと **302 で認証画面に飛ばされる**（実測確認ずみ）

## 使い方

1. スマホ/PCのブラウザで **https://cards.racc.games** を開く
2. 「Sign in with: **Cloudflare**」を押して、Cloudflare アカウント（`racc.beginner@gmail.com`）でログイン
3. 管理画面が開く。カード編集・画像アップロード・公開まで全部できる
   （認証は24時間有効。1日1回くらいの入力で済む）

ホーム画面に追加しておくとアプリのように使える。

## 保存すると何が起きるか

管理画面の保存ボタンは、GitHub に直接コミットする（PCは一切関係ない）。

| 操作 | 保存先 |
| --- | --- |
| 制作中の弾のカードを保存 | 非公開リポ `cards/volN.json` |
| 公開ずみの弾のカードを保存 | 公開リポ `data/cards.json` |
| 制作中の弾メタを保存 | 非公開リポ `sets.wip.json` |
| 画像アップロード（制作中） | 非公開リポ `images/{id}.webp` |
| 画像アップロード（公開ずみ） | 公開リポ `assets/card_images/{id}.webp` |
| 弾を公開（publish-set） | 非公開リポの中身を公開リポへ移して `sets.json` を released に |

## 運用でひとつだけ注意：GitHub トークンの期限

Pages の環境変数 `GITHUB_TOKEN`（GitHub の fine-grained PAT）は **有効期限つき**。
切れると管理画面が「GitHub 連携でエラー」になる。

- 発行日: 2026-07-25 ／ **期限: 30日（2026-08-24 ごろ）**
- 権限: `bravers_duel` と `bravers_duel_wip` の **Contents: read/write** のみ

### 更新のしかた

1. GitHub → Settings → Developer settings → Fine-grained tokens で新しいトークンを作る
   （対象リポ2つ・Contents read/write・期限は最長で）
2. Cloudflare Pages → bravers-admin → Settings → Variables and Secrets で
   `GITHUB_TOKEN` を新しい値に差し替える
3. **再デプロイする**（環境変数を変えただけでは反映されない）

```
cd admin
npx vite build
npx wrangler pages deploy dist --project-name bravers-admin
```

## 管理画面のプログラムを直したときも同じ

上の再デプロイコマンドを流せば反映される。

## セキュリティ

- `cards.racc.games` は Cloudflare Access で保護。`racc.beginner@gmail.com` 以外は入れない
- 制作中カードのデータと画像は **非公開リポにしか無い**。公開リポにも公開サイトにも出ない
- `GITHUB_TOKEN` は Cloudflare の Secret。画面にもエラーメッセージにも出さない実装
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
