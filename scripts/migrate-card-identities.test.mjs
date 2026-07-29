import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migrateDocument,
  validateDocuments,
} from './migrate-card-identities.mjs';

const legacy = {
  id: '1-A001-C',
  vol: 1,
  code: 'A001',
  rarity: 'C',
  name: 'test',
};

test('bootstrap弾だけoracleIdを自動採番し、旧idを落とす', () => {
  const migrated = migrateDocument([legacy], 'vol1');
  assert.deepEqual(migrated[0], {
    oracleId: '1-A001',
    printingId: '1-A001-C',
    vol: 1,
    code: 'A001',
    rarity: 'C',
    name: 'test',
  });
  assert.deepEqual(migrateDocument(migrated, 'vol1'), migrated);
});

test('bootstrap以外の弾はoracleId明示を必須にする', () => {
  assert.throws(
    () =>
      migrateDocument(
        [{ ...legacy, id: '2-A001-C', vol: 2 }],
        'vol2',
      ),
    /oracleIdを明示/,
  );
});

test('oracleIdの前後空白を移行時に拒否する', () => {
  for (const oracleId of [' 1-A001', '1-A001 ']) {
    assert.throws(
      () => migrateDocument([{ ...legacy, oracleId }], 'whitespace'),
      /oracleId の前後に空白/,
    );
  }
});

test('旧idとprintingIdの食い違い、printing規則違反を拒否する', () => {
  assert.throws(
    () =>
      migrateDocument(
        [{ ...legacy, printingId: '1-A002-C' }],
        'mismatch',
      ),
    /id と printingId/,
  );
  assert.throws(
    () =>
      migrateDocument(
        [{ ...legacy, id: '1-A999-C' }],
        'invalid',
      ),
    /vol-code-rarity/,
  );
  assert.throws(
    () =>
      migrateDocument(
        [{ ...legacy, id: '1-A001-ZZ', rarity: 'ZZ' }],
        'rarity',
      ),
    /rarityは既知値/,
  );
});

test('複数入力ファイルを横断してprintingId重複を拒否する', () => {
  const migrated = migrateDocument([legacy], 'one');
  assert.throws(
    () =>
      validateDocuments([
        { label: 'one', parsed: migrated },
        { label: 'two', parsed: migrated },
      ]),
    /入力ファイル間で重複/,
  );
});
