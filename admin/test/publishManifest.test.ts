import { describe, expect, it } from 'vitest';
import { isPublishManifest } from '../functions/api/publish-set';

const requestId = '15f7ea40-b0c4-4d9b-bc1f-4512bb5dbe37';
const sha = 'a'.repeat(40);
const valid = {
  schemaVersion: 3,
  vol: 2,
  requestId,
  set: {
    vol: 2,
    status: 'publishing',
    publishOperationId: requestId,
  },
  cardsSha: sha,
  effectsSha: sha,
  effectTestsSha: sha,
  imageShas: { '2-A001-C': sha },
  cardCount: 1,
  createdAt: '2026-07-29T00:00:00.000Z',
};

describe('publish manifest境界', () => {
  it('set lock・全SHA・件数が一致するschema v3だけを受ける', () => {
    expect(isPublishManifest(valid)).toBe(true);
    expect(
      isPublishManifest({
        ...valid,
        set: { ...valid.set, status: 'draft' },
      }),
    ).toBe(false);
    expect(isPublishManifest({ ...valid, effectsSha: 'bad' })).toBe(false);
    expect(isPublishManifest({ ...valid, effectTestsSha: 'bad' })).toBe(false);
    expect(isPublishManifest({ ...valid, cardCount: 2 })).toBe(false);
    expect(isPublishManifest({ ...valid, schemaVersion: 2 })).toBe(false);
  });
});
