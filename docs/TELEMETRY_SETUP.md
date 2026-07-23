# ログ収集のセットアップ（5分・無料）

公開βのログ（戦闘数・デッキ・勝敗・戦闘内容・カスタムデッキ・レビュー）は、
社長のGoogleアカウントの **Google Apps Script（GAS）** で受けて、
スプレッドシートに自動で溜まります。サーバー代はかかりません。

## 手順

1. https://script.google.com/home を開く → 「新しいプロジェクト」
2. エディタに下のコードを全部貼り付けて保存（プロジェクト名は「BRAVERS DUEL ログ」など）
3. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 説明: なんでもOK
   - 実行ユーザー: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」→ 表示された **ウェブアプリのURL**（https://script.google.com/macros/s/…/exec）をコピー
5. そのURLを `web/src/telemetry.ts` の `ENDPOINT = ''` に貼る（またはClaudeに渡す）

初回のログ受信時に「BRAVERS DUEL ログ」というスプレッドシートが
自動で作られ、イベント種別ごとにシートが分かれて追記されます。

## 貼り付けるコード

```javascript
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SHEET_ID');
    var ss;
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('BRAVERS DUEL ログ');
      props.setProperty('SHEET_ID', ss.getId());
    }
    var name = String(data.type || 'unknown').slice(0, 30);
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['受信日時', 'イベント日時', '匿名ID', '内容(JSON)']);
    }
    sheet.appendRow([new Date(), data.at || '', data.uid || '', JSON.stringify(data)]);
  } catch (err) {
    // 壊れたデータは無視
  }
  return ContentService.createTextOutput('ok');
}
```

## 記録される内容

| type | 内容 |
|---|---|
| battle_start | 自分のデッキ名と種別（preset/custom/imported）、敵デッキ名、敵ランダムか |
| battle_end | 上記 + 勝敗（player/enemy/draw）・決着理由・ターン数・両者の使用カードと回数・チャージ回数 |
| custom_deck | 作られたカスタムデッキ（名前・キャラ・40枚） |
| review | 星（1〜5）とフリーテキスト（1000文字まで）+ 対戦の文脈 |

全イベントに **匿名ID（uid）** が付くので、同一人物の行動を横断して追えます。
匿名IDはランダムなUUIDで、個人情報は含まれません（端末のlocalStorageに保存）。
