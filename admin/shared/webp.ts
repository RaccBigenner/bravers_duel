/** 管理画面から受け付けるカード画像の上限。800px/quality 85–90なら通常は数百KB。 */
export const MAX_CARD_IMAGE_BYTES = 1024 * 1024;
export const WEBP_DATA_URL_PREFIX = 'data:image/webp;base64,';

const BASE64_BODY_RE = /^[A-Za-z0-9+/]+$/;
const IMAGE_TOO_LARGE =
  `webp画像は${MAX_CARD_IMAGE_BYTES / 1024 / 1024}MB以下にしてください`;

/** 巨大なdata URL全体へ正規表現を掛けず、固定prefixだけを確認してpayloadを取り出す。 */
export function webpBase64Payload(dataUrl: unknown): string | null {
  return typeof dataUrl === 'string' && dataUrl.startsWith(WEBP_DATA_URL_PREFIX)
    ? dataUrl.slice(WEBP_DATA_URL_PREFIX.length)
    : null;
}

/**
 * base64を全展開せず、形式・WebPのRIFFヘッダ・宣言サイズ・上限を検査する。
 * nested反復regexは数MBでV8のstackを使い切るため、1MB上限の単純な文字classだけを使う。
 */
export function webpBase64Problem(base64: unknown): string | null {
  if (
    typeof base64 !== 'string' ||
    base64.length < 16 ||
    base64.length % 4 !== 0
  ) {
    return 'webp画像のbase64が不正です';
  }
  // 上限を超える文字列へ正規表現を掛けない。最大+1 byteは同じbase64長に
  // なることがあるため、padding反映後のbyteLengthも下で検査する。
  if (base64.length > Math.ceil(MAX_CARD_IMAGE_BYTES / 3) * 4) {
    return IMAGE_TOO_LARGE;
  }
  const padding = base64.endsWith('==')
    ? 2
    : base64.endsWith('=')
      ? 1
      : 0;
  const body = padding > 0 ? base64.slice(0, -padding) : base64;
  if (
    body.length === 0 ||
    !BASE64_BODY_RE.test(body) ||
    base64.slice(body.length) !== '='.repeat(padding)
  ) {
    return 'webp画像のbase64が不正です';
  }
  const byteLength = (base64.length / 4) * 3 - padding;
  if (byteLength < 25 || byteLength > MAX_CARD_IMAGE_BYTES) {
    return byteLength > MAX_CARD_IMAGE_BYTES
      ? IMAGE_TOO_LARGE
      : '画像の実データがWebPではありません';
  }

  try {
    const header = atob(base64.slice(0, 16));
    const ascii = (offset: number, length: number) =>
      header.slice(offset, offset + length);
    const declaredSize =
      header.charCodeAt(4) |
      (header.charCodeAt(5) << 8) |
      (header.charCodeAt(6) << 16) |
      (header.charCodeAt(7) << 24);
    if (
      ascii(0, 4) !== 'RIFF' ||
      ascii(8, 4) !== 'WEBP' ||
      (declaredSize >>> 0) + 8 !== byteLength
    ) {
      return '画像の実データがWebPではありません';
    }
  } catch {
    return 'webp画像のbase64が不正です';
  }
  return null;
}
