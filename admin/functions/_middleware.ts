/**
 * 全リクエストにかかる Cloudflare Access のガード（多層防御）。
 *
 * 公式プラグイン @cloudflare/pages-plugin-cloudflare-access で、Access が付与する
 * `Cf-Access-Jwt-Assertion` JWT を「JWKS による署名検証・aud 一致・exp 期限」まで
 * 完全に検証する。ヘッダの存在だけでは偽造ヘッダや設定漏れで突破され得るため、
 * 未公開カードのデータ保護の要としてここで確実に弾く。
 *
 * domain / aud はハードコードせず環境変数から読む（環境ごとに差し替え可能に）:
 *   - CF_ACCESS_TEAM_DOMAIN … 例: https://fragrant-paper-4363.cloudflareaccess.com
 *   - CF_ACCESS_AUD         … Access アプリケーションの Audience(AUD) タグ
 * 検証失敗時はプラグイン既定のレスポンス（403 等）を返す。
 */
import cloudflareAccessPlugin from '@cloudflare/pages-plugin-cloudflare-access';
import type { Env } from './_github';

export const onRequest: PagesFunction<Env> = async (ctx) => {
  try {
    return await cloudflareAccessPlugin({
      // 実値は環境変数(文字列)なので、plugin が要求する
      // `https://<team>.cloudflareaccess.com` 形式のテンプレートリテラル型へキャスト
      domain: ctx.env.CF_ACCESS_TEAM_DOMAIN as `https://${string}.cloudflareaccess.com`,
      aud: ctx.env.CF_ACCESS_AUD,
    })(ctx);
  } catch (e) {
    // 鍵の取得に失敗する等で plugin が例外を投げると、Cloudflare の 502 ページが返り
    // 画面には「なぜ失敗したか」が一切出ない（実際に画像アップロードで起きた）。
    // ここで受け止めて理由の分かる応答にする。**通すのではなく必ず拒否する**（fail-closed）。
    return new Response(
      JSON.stringify({ error: '認証の確認に失敗しました。少し待ってからやり直してください' }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
};
