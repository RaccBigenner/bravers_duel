# 制作中の弾のカード置き場（非公開）

このフォルダは `.gitignore` されており、**公開ビルドにも Git にも含まれません**。
第2弾以降の制作中カードは、リリースするまでここに置きます。

- `cards.vol2.json` … 第2弾の制作中カード（形式は data/cards.json と同じ配列）
- `sets.json` … 制作中の弾メタ
- `effects/vol2.ts` … `VOL2_EFFECTS` をexportする制作中のOracle効果module
- `effects/vol2.test.ts` … 第2弾固有の効果挙動を検証するVitest
- 画像は `assets/wip_card_images/` に置く

管理画面（`npm run admin`）はこのフォルダと data/cards.json の両方を読み書きします。
弾を「リリース」すると、カードは `data/cards.json`、画像は `assets/card_images/`、
効果は `engine/src/effects/volN.ts`、testは `engine/test/effects/volN.test.ts` へ
同じローカル公開操作で移ります。`engine/src/effects/released.ts` は自動再生成され、
効果testとengine型検査に失敗した場合は公開側の変更をすべて元へ戻します。

これはローカル開発用ミラーで、クラウド管理の非公開リポ
`RaccBigenner/bravers_duel_wip` とは自動同期しません。クラウド側の正本は
`cards/volN.json`、`sets.wip.json`、`images/`、`effects/volN.ts`、
`effects/volN.test.ts` です。
