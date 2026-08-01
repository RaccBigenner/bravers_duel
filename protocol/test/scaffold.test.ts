import { describe, expect, it } from 'vitest';
import { PROTOCOL_SCAFFOLD } from '../src/index';

describe('@bravers/protocol scaffold', () => {
  it('実型を先行確定せずworkspaceの入口だけを公開する', () => {
    expect(PROTOCOL_SCAFFOLD).toEqual({
      version: 'OLG-101',
      operational: false,
    });
  });
});
