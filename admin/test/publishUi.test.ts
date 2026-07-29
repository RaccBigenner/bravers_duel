import { describe, expect, it } from 'vitest';
import { canStartOrResumePublish } from '../src/publishUi';

describe('弾公開ボタン', () => {
  it('新規公開はpreflight合格後だけ許可する', () => {
    expect(canStartOrResumePublish('draft', false)).toBe(false);
    expect(canStartOrResumePublish('draft', true)).toBe(true);
  });

  it('publishing中はWIP cleanup途中でpreflight表示が欠けても再開できる', () => {
    expect(canStartOrResumePublish('publishing', false)).toBe(true);
  });
});
