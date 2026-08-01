import { describe, expect, it } from 'vitest';
import {
  RECOVERY_MESSAGE_KEYS,
  recoveryMessages,
} from '../src/online/recoveryMessages';

describe('recovery message catalog', () => {
  it('ja-JPとenで同じkeyを持ち、空の翻訳を許さない', () => {
    const japanese = recoveryMessages('ja-JP');
    const english = recoveryMessages('en');
    const japaneseKeys = Object.keys(japanese).sort();
    const englishKeys = Object.keys(english).sort();

    expect(englishKeys).toEqual(japaneseKeys);
    expect([...RECOVERY_MESSAGE_KEYS].sort()).toEqual(japaneseKeys);
    for (const key of RECOVERY_MESSAGE_KEYS) {
      expect(japanese[key].trim()).not.toBe('');
      expect(english[key].trim()).not.toBe('');
    }
  });
});
