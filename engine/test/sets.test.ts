/**
 * 弾（セット）マスタと「公開ゲート」の検証。
 * ここが緑である限り、制作中の弾が公開ビルドに漏れないことが機械的に保証される。
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/cards';
import { ALL_SETS, isVolReleased, RELEASED_SETS, setOfVol } from '../src/sets';
import { hasEffectImplementation } from '../src/effects';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const IMAGES_DIR = resolve(REPO, 'assets/card_images');

describe('弾マスタ', () => {
  it('第1弾のメタ情報が正しい', () => {
    const vol1 = setOfVol(1);
    expect(vol1).toBeDefined();
    expect(vol1!.themeNo).toBe(1);
    expect(vol1!.themeName).toBe('聖戦残火');
    expect(vol1!.themeSubtitle).toBe('禍いの足音');
    expect(vol1!.packType).toBe('DX');
    expect(vol1!.status).toBe('released');
  });

  it('全ての弾は vol が一意', () => {
    const vols = ALL_SETS.map((s) => s.vol);
    expect(new Set(vols).size).toBe(vols.length);
  });
});

describe('公開ゲート（制作中カードが漏れないこと）', () => {
  it('公開カードは全て released の弾に属する', () => {
    for (const c of ALL_CARDS) {
      expect(isVolReleased(c.vol)).toBe(true);
    }
  });

  it('公開カードに status:draft のものは無い', () => {
    expect(ALL_CARDS.every((c) => c.status !== 'draft')).toBe(true);
  });

  it('未定義の弾は未公開扱い（存在しない vol=99 は released ではない）', () => {
    expect(isVolReleased(99)).toBe(false);
  });

  it('released の弾が少なくとも1つある', () => {
    expect(RELEASED_SETS.length).toBeGreaterThan(0);
  });
});

describe('画像とカードの対応（リリース事故防止）', () => {
  it('公開カードには対応する画像ファイルがある', () => {
    for (const c of ALL_CARDS) {
      expect(existsSync(resolve(IMAGES_DIR, `${c.id}.webp`))).toBe(true);
    }
  });

  it('カード番号の形をした画像で、公開カードに対応しないもの（stray）が無い', () => {
    // 例: 1-A200-C.webp のような「id形式だがカードが存在しない画像」＝未公開カードの絵の置き忘れ
    const publicIds = new Set(ALL_CARDS.map((c) => c.id));
    const strays = readdirSync(IMAGES_DIR)
      .filter((f) => /^\d+-[A-Z]\d+-[A-Z]+\.webp$/.test(f))
      .map((f) => f.replace(/\.webp$/, ''))
      .filter((id) => !publicIds.has(id));
    expect(strays).toEqual([]);
  });
});

describe('効果実装の突き合わせ（参考・落とさない）', () => {
  it('効果テキストがあるのに未実装のカードを数える', () => {
    const missing = ALL_CARDS.filter((c) => c.effectText !== '' && !hasEffectImplementation(c.id));
    // 情報として記録するだけ（落とさない）。管理画面でも同じ集計を出す
    expect(missing.length).toBeGreaterThanOrEqual(0);
  });
});
