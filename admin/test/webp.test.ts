import { describe, expect, it } from 'vitest';
import {
  MAX_CARD_IMAGE_BYTES,
  WEBP_DATA_URL_PREFIX,
  webpBase64Payload,
  webpBase64Problem,
} from '../shared/webp';

const ONE_PIXEL_WEBP =
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

describe('WebP upload境界', () => {
  it('RIFF/WEBPと宣言サイズが一致する画像だけを受ける', () => {
    expect(webpBase64Problem(ONE_PIXEL_WEBP)).toBeNull();
    expect(
      webpBase64Problem(
        Buffer.from('not actually a webp image payload').toString('base64'),
      ),
    ).not.toBeNull();
    expect(webpBase64Problem('')).not.toBeNull();
  });

  it('RIFF宣言サイズの改ざんを拒否する', () => {
    const bytes = Buffer.from(ONE_PIXEL_WEBP, 'base64');
    bytes.writeUInt32LE(1, 4);
    expect(webpBase64Problem(bytes.toString('base64'))).toContain('WebP');
  });

  it('1MB境界をstackを消費する正規表現なしで検査する', () => {
    const bytes = Buffer.alloc(MAX_CARD_IMAGE_BYTES);
    bytes.write('RIFF', 0, 'ascii');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WEBP', 8, 'ascii');
    expect(webpBase64Problem(bytes.toString('base64'))).toBeNull();

    const over = Buffer.alloc(MAX_CARD_IMAGE_BYTES + 1).toString('base64');
    expect(webpBase64Problem(over)).toContain('1MB以下');
  });

  it('不正文字とdata URLのprefix違いを拒否する', () => {
    const invalidCharacter = `${ONE_PIXEL_WEBP.slice(0, -1)}!`;
    expect(webpBase64Problem(invalidCharacter)).toContain('base64');
    expect(
      webpBase64Payload(`${WEBP_DATA_URL_PREFIX}${ONE_PIXEL_WEBP}`),
    ).toBe(ONE_PIXEL_WEBP);
    expect(webpBase64Payload(`data:image/png;base64,${ONE_PIXEL_WEBP}`)).toBeNull();
  });
});
