# カードマスター管理をスマホから使う（Cloudflare Access）

外出先のスマホから、ブラウザだけでカード管理できる（アプリ不要）。

## URL

**https://cards.racc.games**

## 仕組み（なぜ安全か）

- 管理画面は今までどおり**社長のPCの中だけ**で動く（データはPCから一歩も出ない）
- **Cloudflare Tunnel** が `cards.racc.games` ↔ PCの `localhost:5273` を暗号化して繋ぐ
- **Cloudflare Access** が `cards.racc.games` にメール認証をかける（`racc.beginner@gmail.com` だけ許可）
- スマホはブラウザで開いてメールに届くコードを入れるだけ。**アプリは不要**
- 未認証・許可外メールは、管理画面にもデータAPIにも一切到達できない（認証画面へ強制リダイレクト）

## 使い方

1. **PCを起動しておく**（ログイン状態ならOK。スリープは可、シャットダウンは不可）
2. スマホ/PCのブラウザで **https://cards.racc.games** を開く
3. `racc.beginner@gmail.com` を入力 → **「Send me a code」**
4. Gmailに届く**6桁コード**を入力
5. 管理画面が開く。カード編集・画像アップロード・「GitHubへ公開」まで全部できる
   （認証は24時間有効。1日1回くらいの入力で済む）

ホーム画面に追加しておくとアプリのように使える。

## セットアップは完了済み（社長がやることは無い）

- cloudflared インストール・認証・トンネル `bravers-admin` 作成
- DNS: `cards.racc.games` → トンネル
- Cloudflare Access アプリ（`cards.racc.games`、One-time PIN、許可メール `racc.beginner@gmail.com` のみ）
- **自動起動**: `~/Library/LaunchAgents/com.bravers.admin.plist` と `com.bravers.tunnel.plist`
  → **PCを起動（ログイン）すると、管理画面とトンネルが自動で立ち上がる**

## 手動で止める / 再開する

```
# 止める
launchctl unload ~/Library/LaunchAgents/com.bravers.admin.plist
launchctl unload ~/Library/LaunchAgents/com.bravers.tunnel.plist

# 再開する
launchctl load ~/Library/LaunchAgents/com.bravers.admin.plist
launchctl load ~/Library/LaunchAgents/com.bravers.tunnel.plist
```

ログ: `/tmp/bravers-admin.err` / `/tmp/bravers-tunnel.err`

## うまく開けないとき

- **PCが起動しているか**（シャットダウン中は使えない仕組みです）
- `https://cards.racc.games` が 502 等になる → PCで管理画面が動いているか確認
  （ターミナルで `curl http://127.0.0.1:5273/api/master` が `ok`/200 を返すか）
- 認証画面がループする → いったんブラウザのCookieを消して開き直す

## セキュリティ

- `cards.racc.games` は Cloudflare Access で保護。`racc.beginner@gmail.com` 以外はメールコードを受け取れず入れない
- 未公開カードのデータ・画像は**PCの中だけ**。Cloudflare は中身を保持しない（暗号化トンネルの通り道なだけ）
- **自己チェック**: Cloudflareにログインしていない別の端末（例: スマホをモバイル回線にして別ブラウザ）で
  `cards.racc.games` を開くと、必ずメール認証画面が出て中身は見えないのが正常
- 許可メールを変える/増やすには: Cloudflare Zero Trust → Access → Applications →
  「cards」→ ポリシー「Racc only」を編集
