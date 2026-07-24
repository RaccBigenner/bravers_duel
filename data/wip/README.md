# 制作中の弾のカード置き場（非公開）

このフォルダは `.gitignore` されており、**公開ビルドにも Git にも含まれません**。
第2弾以降の制作中カードは、リリースするまでここに置きます。

- `cards.vol2.json` … 第2弾の制作中カード（形式は data/cards.json と同じ配列）
- 画像は `assets/wip_card_images/` に置く

管理画面（`npm run admin`）はこのフォルダと data/cards.json の両方を読み書きします。
弾を「リリース」すると、カードが data/cards.json へ、画像が assets/card_images/ へ移り、
`data/sets.json` のその弾の status が `released` になります。
