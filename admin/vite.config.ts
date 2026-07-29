import react from '@vitejs/plugin-react';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import {
  CardIdentityError,
  canonicalCardForWrite,
  canonicalCardsForWrite,
  duplicateOracleGameplayDrifts,
  duplicatePrintingIds,
  normalizeCardIdentity,
  provisionalOraclePrintingIds,
  validatePrintingRenames,
} from './shared/cardIdentity';
import { mutationRequestProblem } from './shared/requestSecurity';
import {
  webpBase64Payload,
  webpBase64Problem,
} from './shared/webp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DATA = resolve(REPO, 'data');
const WIP = resolve(DATA, 'wip');
const WIP_EFFECTS = resolve(WIP, 'effects');
const IMAGES = resolve(REPO, 'assets/card_images');
const WIP_IMAGES = resolve(REPO, 'assets/wip_card_images');
const PUBLIC_EFFECTS = resolve(REPO, 'engine/src/effects');
const PUBLIC_EFFECT_TESTS = resolve(REPO, 'engine/test/effects');
const RELEASED_EFFECTS = resolve(PUBLIC_EFFECTS, 'released.ts');
const LOCAL_ADMIN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'cards.racc.games',
  ...(process.env.ADMIN_ALLOWED_HOST
    ? [process.env.ADMIN_ALLOWED_HOST]
    : []),
]);

function localAdminHostAllowed(rawHost: string | undefined): boolean {
  if (!rawHost) return false;
  try {
    return LOCAL_ADMIN_HOSTS.has(new URL(`http://${rawHost}`).hostname);
  } catch {
    return false;
  }
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

/** JSON を人が読める形（2スペース）で保存。末尾に改行 */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function normalizeCardsForRead(cards: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return cards.map((card) => normalizeCardIdentity(card) as Record<string, unknown>);
}

function canonicalCardsForLocalWrite(
  cards: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return canonicalCardsForWrite(cards) as Record<string, unknown>[];
}

function requireNoOracleGameplayDrifts(cards: readonly Record<string, unknown>[]): void {
  const drifts = duplicateOracleGameplayDrifts(cards);
  if (drifts.length === 0) return;
  const detail = drifts
    .map((drift) => `${drift.oracleId} (${drift.printingIds.join(' / ')})`)
    .join('、');
  throw new CardIdentityError(`同じoracleIdのゲーム定義が一致しません: ${detail}`);
}

function requireResolvedOracleIds(cards: readonly Record<string, unknown>[]): void {
  const provisional = provisionalOraclePrintingIds(cards);
  if (provisional.length === 0) return;
  throw new CardIdentityError(
    `旧形式の仮Oracleが残っています: ${provisional.join('、')}。再録元を指定するか、新規Oracleを発行してください`,
  );
}

function wipCardsPath(vol: number): string {
  return resolve(WIP, `cards.vol${vol}.json`);
}

/** 制作中の弾のメタ情報の置き場（gitignore。公開リポにも公開ビルドにも入らない） */
const WIP_SETS = resolve(WIP, 'sets.json');
const PUBLIC_SETS = resolve(DATA, 'sets.json');

interface SetMetaLike {
  vol: number;
  status?: string;
  [k: string]: unknown;
}

function isReleasedVol(vol: number, sets: SetMetaLike[]): boolean {
  return sets.find((s) => s.vol === vol)?.status === 'released';
}

/**
 * 公開済みの弾は管理画面から一切変更できない（クラウド版 functions/_github.ts と同じ規則）。
 *
 * 実際に事故が起きた: 第2弾のつもりのカードが vol:1 で保存され、公開済みの第1弾に
 * 145枚目として紛れ込んで公開リポジトリに push された。engine のテストが止めたので
 * 公開ビルドには載らなかったが、画像さえ付いていれば素通りしていた。
 *
 * 戻り値: 変更してよければ null、駄目ならエラーメッセージ。
 */
function volLockError(vol: number, sets: SetMetaLike[]): string | null {
  const status = sets.find((set) => set.vol === vol)?.status;
  if (status === 'released') {
    return `第${vol}弾は公開済みのため、管理画面からは変更できません。直す必要がある場合はリポジトリを直接編集してください。`;
  }
  if (status === 'publishing') {
    return `第${vol}弾は公開処理中です。「弾を公開」をもう一度実行して完了させてください。`;
  }
  return null;
}

/**
 * 弾マスタは2つのファイルに分かれている。
 * - data/sets.json      … 公開済みの弾だけ（公開リポ・公開ビルドに入る）
 * - data/wip/sets.json  … 制作中の弾（gitignore・絶対に公開されない）
 * 管理画面では両方見えないと編集できないので、ここで1つに束ねる。
 * カードと同じ考え方（公開できるものだけ公開側のファイルに置く）。
 */
function loadSets(): SetMetaLike[] {
  const pub = readJson<{ sets: SetMetaLike[] }>(PUBLIC_SETS, { sets: [] }).sets ?? [];
  const wip = readJson<{ sets: SetMetaLike[] }>(WIP_SETS, { sets: [] }).sets ?? [];
  const byVol = new Map<number, SetMetaLike>();
  for (const s of [...pub, ...wip]) byVol.set(s.vol, s); // 同 vol は制作中側を優先
  return [...byVol.values()].sort((a, b) => a.vol - b.vol);
}

/** 弾の保存先。released だけ公開ファイル、それ以外は必ず wip 側 */
function setSaveTarget(set: SetMetaLike): string {
  return set.status === 'released' ? PUBLIC_SETS : WIP_SETS;
}

/**
 * カードの保存先を決める。
 * - カード個別が draft、または弾が未 released → data/wip（gitignore・非公開）
 * - それ以外（公開弾の公開カード） → data/cards.json（公開される）
 * これで「制作中のものが公開リポジトリに入る」ことを保存の時点で防ぐ。
 */
function cardSaveTarget(card: { vol: number; status?: string }, sets: SetMetaLike[]): string {
  const isPublic = card.status !== 'draft' && isReleasedVol(card.vol, sets);
  return isPublic ? resolve(DATA, 'cards.json') : wipCardsPath(card.vol);
}

/**
 * 画像の一覧を `{ printingId: 版番号 }` で返す（クラウド版 /api/master と同じ形）。
 * 版番号はローカルでは更新時刻。画像URLの `?v=` に使い、差し替えた時だけ
 * ブラウザが取り直すようにする（一覧で毎回全枚数を読み直さないため）。
 */
function loadImages(): Record<string, string> {
  const out: Record<string, string> = {};
  // 配信と同じ探索順（公開 → 制作中）に合わせ、公開側を優先させる
  for (const dir of [WIP_IMAGES, IMAGES]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const file = resolve(dir, f);
      out[f.replace(/\.[^.]+$/, '')] = String(statSync(file).mtimeMs | 0);
    }
  }
  return out;
}

function loadEffectModules(): Record<string, string> {
  if (!existsSync(WIP_EFFECTS)) return {};
  return Object.fromEntries(
    readdirSync(WIP_EFFECTS)
      .map((name) => {
        const vol = /^vol(\d+)\.ts$/.exec(name)?.[1];
        if (!vol) return null;
        const file = resolve(WIP_EFFECTS, name);
        return [vol, String(statSync(file).mtimeMs | 0)] as const;
      })
      .filter(
        (entry): entry is readonly [string, string] => entry !== null,
      ),
  );
}

function loadEffectTests(): Record<string, string> {
  if (!existsSync(WIP_EFFECTS)) return {};
  return Object.fromEntries(
    readdirSync(WIP_EFFECTS)
      .map((name) => {
        const vol = /^vol(\d+)\.test\.ts$/.exec(name)?.[1];
        if (!vol) return null;
        const file = resolve(WIP_EFFECTS, name);
        return [vol, String(statSync(file).mtimeMs | 0)] as const;
      })
      .filter(
        (entry): entry is readonly [string, string] => entry !== null,
      ),
  );
}

function releasedEffectsSource(vols: readonly number[]): string {
  const canonicalVols = [...new Set(vols)].sort((a, b) => a - b);
  return [
    '/**',
    ' * 公開済み弾の効果module一覧。',
    ' * publisherがdata/sets.jsonから決定的に再生成するため、手で編集しない。',
    ' */',
    "import type { CardEffect } from './types';",
    ...canonicalVols.map(
      (releasedVol) =>
        `import { VOL${releasedVol}_EFFECTS } from './vol${releasedVol}';`,
    ),
    '',
    'const MODULES: readonly Readonly<Record<string, CardEffect>>[] = [',
    ...canonicalVols.map(
      (releasedVol) => `  VOL${releasedVol}_EFFECTS,`,
    ),
    '];',
    'const releasedEffects: Record<string, CardEffect> = Object.create(null);',
    'for (const moduleEffects of MODULES) {',
    '  for (const [oracleId, effect] of Object.entries(moduleEffects)) {',
    '    if (Object.prototype.hasOwnProperty.call(releasedEffects, oracleId)) {',
    "      throw new Error('効果module間でOracle IDが重複しています');",
    '    }',
    '    releasedEffects[oracleId] = effect;',
    '  }',
    '}',
    'export const RELEASED_EFFECTS: Readonly<Record<string, CardEffect>> = releasedEffects;',
    '',
  ].join('\n');
}

function loadMaster() {
  const sets = loadSets();
  const released = normalizeCardsForRead(
    readJson<Record<string, unknown>[]>(resolve(DATA, 'cards.json'), []),
  );
  // 制作中の弾のカードを data/wip から全部集める
  const wip: Record<string, unknown>[] = [];
  if (existsSync(WIP)) {
    for (const f of readdirSync(WIP)) {
      if (!f.endsWith('.json')) continue;
      if (f === 'sets.json') continue; // 弾メタであってカードではない
      const parsed = readJson<unknown>(resolve(WIP, f), []);
      const arr = Array.isArray(parsed) ? parsed : ((parsed as { cards?: unknown[] }).cards ?? []);
      wip.push(...normalizeCardsForRead(arr as Record<string, unknown>[]));
    }
  }

  // 弾メタが無いのにカードだけある vol（＝迷子）。弾メタが消えるとカードが丸ごと
  // 見えなくなる事故が実際に起きたので、タブだけは必ず出して直せるようにする。
  const known = new Set(sets.map((s) => s.vol));
  const orphanVols = [...new Set(wip.map((c) => Number(c.vol)))].filter((v) => !known.has(v)).sort((a, b) => a - b);
  for (const vol of orphanVols) {
    sets.push({ vol, themeNo: vol, themeName: '', themeSubtitle: '', packType: 'DX', status: 'draft', releasedAt: '', codename: '' });
  }
  sets.sort((a, b) => a.vol - b.vol);

  // oracleIdの重複は再録として合法。同じprintingIdだけ公開側を正としてまとめる。
  const byPrintingId = new Map<string, Record<string, unknown>>();
  const allCards = [...released, ...wip];
  const sourceDuplicatePrintingIds = duplicatePrintingIds(allCards);
  for (const card of allCards) {
    const printingId = String(card.printingId ?? '');
    if (!byPrintingId.has(printingId)) byPrintingId.set(printingId, card);
  }

  return {
    sets,
    cards: [...byPrintingId.values()],
    images: loadImages(),
    effectModules: loadEffectModules(),
    effectTests: loadEffectTests(),
    duplicatePrintingIds: sourceDuplicatePrintingIds,
    orphanVols,
  };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** ローカル公開でも、同じcommitへ載せる効果testと型検査をWIP削除前に必ず通す。 */
function runLocalEffectPublicationGates(): void {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commands = [
    ['効果回帰test', ['--workspace', 'engine', 'test']],
    ['engine型検査', ['--workspace', 'engine', 'run', 'typecheck']],
  ] as const;
  for (const [label, args] of commands) {
    const result = spawnSync(npm, args, {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      throw new Error(
        `${label}に失敗しました${detail ? `\n${detail.slice(-6000)}` : ''}`,
      );
    }
  }
}

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** ローカル専用のマスターデータ API（fs 直読み書き）。公開環境には絶対にデプロイしない */
function masterApi(): Plugin {
  // dev サーバーと本番プレビューの両方に同じ API・画像配信ミドルウェアを挿す
  const attach = (server: { middlewares: { use: (...args: any[]) => void } }) => {
      // custom middlewareはVite本体のhost checkより先に動くため、DNS rebindingを
      // 防ぐ固定allowlistをAPI・WIP画像の最前段に置く。サブドメインwildcardは使わない。
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url ?? '';
          if (
            !url.startsWith('/api/') &&
            !url.startsWith('/card_images/')
          ) {
            return next();
          }
          if (!localAdminHostAllowed(req.headers.host)) {
            res.statusCode = 403;
            res.setHeader('Cache-Control', 'no-store');
            res.end('forbidden host');
            return;
          }
          next();
        },
      );

      // カード画像を配信（公開画像 → 無ければ制作中画像の順で探す）
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/card_images/')) return next();
        const name = decodeURIComponent(url.slice('/card_images/'.length).split('?')[0]);
        for (const dir of [IMAGES, WIP_IMAGES]) {
          const file = resolve(dir, name);
          if (file.startsWith(dir) && existsSync(file)) {
            res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
            // `?v=`（/api/master が返す版番号）付きは中身が変われば別URLになるので焼き付けてよい
            res.setHeader(
              'Cache-Control',
              dir === WIP_IMAGES
                ? 'private, no-store'
                : url.includes('?v=')
                  ? 'public, max-age=31536000, immutable'
                  : 'public, max-age=300',
            );
            res.end(readFileSync(file));
            return;
          }
        }
        res.statusCode = 404;
        res.end('not found');
      });

      // マスターデータ API
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        try {
          if (req.method === 'POST') {
            const securityProblem = mutationRequestProblem({
              contentType: req.headers['content-type'],
              origin: req.headers.origin,
              fetchSite: req.headers['sec-fetch-site'],
              expectedHost: req.headers.host,
            });
            if (securityProblem) {
              return sendJson(res, securityProblem.status, {
                error: securityProblem.message,
              });
            }
          }
          if (req.method === 'GET' && url === '/api/master') {
            return sendJson(res, 200, loadMaster());
          }

          if (req.method === 'POST' && url === '/api/save-card') {
            // 1枚保存とID変更を一つの操作にまとめる。元を消すのは新カードと画像が
            // 保存できた後だけにし、移動先の別カード・別画像は409で拒否する。
            const {
              card: rawCard,
              originalPrintingId,
              originalVol,
            } = await readBody(req);
            if (!rawCard || typeof rawCard.vol !== 'number') {
              return sendJson(res, 400, { error: 'card と vol が必要' });
            }
            if (
              (originalPrintingId == null) !== (originalVol == null) ||
              (originalPrintingId != null &&
                (typeof originalPrintingId !== 'string' || originalPrintingId.trim() === '')) ||
              (originalVol != null &&
                (typeof originalVol !== 'number' || !Number.isFinite(originalVol)))
            ) {
              return sendJson(res, 400, {
                error: '編集時は originalPrintingId と originalVol の両方が必要です',
              });
            }
            const card = canonicalCardForWrite(
              rawCard as Record<string, unknown>,
            ) as Record<string, unknown> & {
              oracleId: string;
              printingId: string;
              vol: number;
              status?: string;
            };
            const sets = loadSets();
            const locked = volLockError(card.vol, sets);
            if (locked) return sendJson(res, 403, { error: locked });
            if (originalVol != null) {
              const originalLocked = volLockError(originalVol, sets);
              if (originalLocked) return sendJson(res, 403, { error: originalLocked });
            }

            // 編集可能な弾は必ずWIPへ保存する。公開ファイルの変更はpublish-setだけ。
            const target = wipCardsPath(card.vol);
            const targetCards = normalizeCardsForRead(
              readJson<Record<string, unknown>[]>(target, []),
            );
            if (targetCards.some((existing) => existing.vol !== card.vol)) {
              return sendJson(res, 409, {
                error: `${target.replace(REPO + '/', '')} に別volのカードがあります`,
              });
            }

            if (originalPrintingId == null || originalVol == null) {
              const existing = targetCards.find(
                (candidate) => candidate.printingId === card.printingId,
              );
              if (existing) {
                if (
                  JSON.stringify(canonicalCardForWrite(existing)) ===
                  JSON.stringify(card)
                ) {
                  return sendJson(res, 200, {
                    ok: true,
                    savedTo: target.replace(REPO + '/', ''),
                    movedImage: false,
                    cleanupPending: false,
                    alreadySaved: true,
                  });
                }
                return sendJson(res, 409, { error: `${card.printingId} は既に存在します` });
              }
              if (
                existsSync(resolve(WIP_IMAGES, `${card.printingId}.webp`))
              ) {
                return sendJson(res, 409, {
                  error:
                    `${card.printingId} の孤立画像が既にあります。` +
                    '先に画像を整理してください',
                });
              }
              writeJson(target, canonicalCardsForLocalWrite([...targetCards, card]));
              return sendJson(res, 200, {
                ok: true,
                savedTo: target.replace(REPO + '/', ''),
                movedImage: false,
                cleanupPending: false,
              });
            }

            const source = wipCardsPath(originalVol);
            const sameFile = source === target;
            const sourceCards = sameFile
              ? targetCards
              : normalizeCardsForRead(readJson<Record<string, unknown>[]>(source, []));
            const identityChanged =
              originalPrintingId !== card.printingId || originalVol !== card.vol;
            const sourceImage = resolve(WIP_IMAGES, `${originalPrintingId}.webp`);
            const targetImage = resolve(WIP_IMAGES, `${card.printingId}.webp`);
            const sourceIndex = sourceCards.findIndex(
              (existing) => existing.printingId === originalPrintingId,
            );
            if (sourceIndex < 0) {
              // 旧逐次版でカード更新後の画像削除だけ失敗した状態を、同じPOSTで回収する。
              const completed = targetCards.find(
                (existing) => existing.printingId === card.printingId,
              );
              if (
                identityChanged &&
                completed &&
                JSON.stringify(canonicalCardForWrite(completed)) ===
                  JSON.stringify(card)
              ) {
                let movedImage = existsSync(targetImage);
                let cleanupPending = false;
                if (existsSync(sourceImage)) {
                  try {
                    mkdirSync(WIP_IMAGES, { recursive: true });
                    if (!existsSync(targetImage)) {
                      copyFileSync(sourceImage, targetImage);
                      movedImage = true;
                    }
                    unlinkSync(sourceImage);
                  } catch {
                    cleanupPending = true;
                  }
                }
                return sendJson(res, 200, {
                  ok: true,
                  savedTo: target.replace(REPO + '/', ''),
                  movedImage,
                  cleanupPending,
                });
              }
              return sendJson(res, 409, {
                error: `変更元 ${originalPrintingId} が見つかりません。再読み込みしてください`,
              });
            }
            if (sourceCards[sourceIndex].vol !== originalVol) {
              return sendJson(res, 409, {
                error: `変更元 ${originalPrintingId} のvolが一致しません`,
              });
            }

            if (
              identityChanged &&
              targetCards.some((existing) => existing.printingId === card.printingId)
            ) {
              return sendJson(res, 409, {
                error: `移動先 ${card.printingId} は別カードが使用しています`,
              });
            }

            let copiedImage = false;
            if (identityChanged && existsSync(targetImage)) {
              return sendJson(res, 409, {
                error: `移動先 ${card.printingId} の画像は既に存在します`,
              });
            }
            if (identityChanged && existsSync(sourceImage)) {
              mkdirSync(WIP_IMAGES, { recursive: true });
              copyFileSync(sourceImage, targetImage);
              copiedImage = true;
            }

            let targetWritten = false;
            try {
              if (sameFile) {
                const output = [...sourceCards];
                output[sourceIndex] = card;
                writeJson(target, canonicalCardsForLocalWrite(output));
              } else {
                writeJson(target, canonicalCardsForLocalWrite([...targetCards, card]));
                targetWritten = true;
                writeJson(
                  source,
                  canonicalCardsForLocalWrite(
                    sourceCards.filter(
                      (existing) => existing.printingId !== originalPrintingId,
                    ),
                  ),
                );
              }
            } catch (error) {
              if (targetWritten) writeJson(target, canonicalCardsForLocalWrite(targetCards));
              if (copiedImage && existsSync(targetImage)) unlinkSync(targetImage);
              throw error;
            }

            let cleanupPending = false;
            if (copiedImage && existsSync(sourceImage)) {
              try {
                unlinkSync(sourceImage);
              } catch {
                cleanupPending = true;
              }
            }
            return sendJson(res, 200, {
              ok: true,
              savedTo: target.replace(REPO + '/', ''),
              movedImage: copiedImage,
              cleanupPending,
            });
          }

          if (req.method === 'POST' && url === '/api/save-cards') {
            // 並び替えと採番のための一括保存。
            // 1枚ずつ保存すると100枚超で100回ファイルを書くことになるので、
            // その弾のファイルを一度だけ書き換える。
            // renamesが付いていれば画像も一緒に引っ越す（printingIdがファイル名なので、
            // これをやらないと採番し直した瞬間に全部の絵が迷子になる）。
            const { vol, cards: rawCards, renames } = await readBody(req);
            if (
              typeof vol !== 'number' ||
              !Array.isArray(rawCards) ||
              (renames != null && !Array.isArray(renames))
            ) {
              return sendJson(res, 400, {
                error: 'vol・cards配列と、任意のrenames配列が必要です',
              });
            }
            const cards = canonicalCardsForLocalWrite(
              rawCards as Record<string, unknown>[],
            );
            if (cards.some((card) => card.vol !== vol)) {
              return sendJson(res, 400, { error: 'cards には同じ vol のカードだけを入れてください' });
            }
            const setsForBulk = loadSets();
            const lockedBulk = volLockError(vol, setsForBulk);
            if (lockedBulk) return sendJson(res, 403, { error: lockedBulk });

            const bulkTarget = wipCardsPath(vol);
            const current = canonicalCardsForLocalWrite(
              normalizeCardsForRead(
                readJson<Record<string, unknown>[]>(bulkTarget, []),
              ),
            );
            if (current.some((card) => card.vol !== vol)) {
              return sendJson(res, 409, {
                error: `cards.vol${vol}.json に別volのカードがあります`,
              });
            }
            const requestedRenames =
              (renames ?? []) as { from: string; to: string }[];

            // 旧逐次版でカード保存後のfrom-only画像削除だけ失敗した場合の冪等再試行。
            // 保存前一覧はrenameの逆写像から復元し、通常の厳格validatorをもう一度通す。
            if (
              requestedRenames.length > 0 &&
              JSON.stringify(current) === JSON.stringify(cards)
            ) {
              const renameByTarget = new Map(
                requestedRenames.map((rename) => [rename.to, rename.from]),
              );
              const reconstructed = current.map((card) => {
                const from = renameByTarget.get(String(card.printingId));
                if (!from) return card;
                return {
                  ...card,
                  printingId: from,
                  code: from.split('-')[1],
                };
              });
              const completedRenames = validatePrintingRenames(
                reconstructed,
                cards,
                requestedRenames,
                vol,
              );
              const completedToIds = new Set(
                completedRenames.map((rename) => rename.to),
              );
              const cleanupPending: string[] = [];
              let restoredImages = 0;
              for (const rename of completedRenames) {
                if (completedToIds.has(rename.from)) continue;
                const sourceImage = resolve(
                  WIP_IMAGES,
                  `${rename.from}.webp`,
                );
                const targetImage = resolve(
                  WIP_IMAGES,
                  `${rename.to}.webp`,
                );
                if (!existsSync(sourceImage)) continue;
                try {
                  if (!existsSync(targetImage)) {
                    copyFileSync(sourceImage, targetImage);
                    restoredImages++;
                  }
                  unlinkSync(sourceImage);
                } catch {
                  cleanupPending.push(rename.from);
                }
              }
              return sendJson(res, 200, {
                ok: true,
                savedTo: bulkTarget.replace(REPO + '/', ''),
                saved: cards.length,
                movedImages: restoredImages,
                cleanupPending,
              });
            }
            const renameList = validatePrintingRenames(
              current,
              cards,
              requestedRenames,
              vol,
            );

            // 公開画像には触れず、WIP画像だけをカード対応と照合して移す。
            // 元はカード保存成功後まで残し、失敗時は移動先を元の内容へ戻す。
            const fromIds = new Set(renameList.map((rename) => rename.from));
            const toIds = new Set(renameList.map((rename) => rename.to));
            const targetOriginals = new Map<string, Buffer | null>();
            const desired: { from: string; to: string; buf: Buffer | null }[] = [];
            for (const rename of renameList) {
              const sourceImage = resolve(WIP_IMAGES, `${rename.from}.webp`);
              const targetImage = resolve(WIP_IMAGES, `${rename.to}.webp`);
              const targetOriginal = existsSync(targetImage)
                ? readFileSync(targetImage)
                : null;
              if (targetOriginal && !fromIds.has(rename.to)) {
                return sendJson(res, 409, {
                  error: `移動先 ${rename.to} の画像は既に存在します`,
                });
              }
              targetOriginals.set(rename.to, targetOriginal);
              desired.push({
                ...rename,
                buf: existsSync(sourceImage)
                  ? readFileSync(sourceImage)
                  : null,
              });
            }

            try {
              mkdirSync(WIP_IMAGES, { recursive: true });
              for (const image of desired) {
                const targetImage = resolve(WIP_IMAGES, `${image.to}.webp`);
                if (image.buf) writeFileSync(targetImage, image.buf);
                else if (existsSync(targetImage)) unlinkSync(targetImage);
              }
              writeJson(bulkTarget, cards);
            } catch (error) {
              for (const [printingId, original] of targetOriginals) {
                const targetImage = resolve(WIP_IMAGES, `${printingId}.webp`);
                if (original) writeFileSync(targetImage, original);
                else if (existsSync(targetImage)) unlinkSync(targetImage);
              }
              throw error;
            }

            const cleanupPending: string[] = [];
            for (const from of fromIds) {
              if (toIds.has(from)) continue;
              const sourceImage = resolve(WIP_IMAGES, `${from}.webp`);
              if (!existsSync(sourceImage)) continue;
              try {
                unlinkSync(sourceImage);
              } catch {
                cleanupPending.push(from);
              }
            }
            return sendJson(res, 200, {
              ok: true,
              savedTo: bulkTarget.replace(REPO + '/', ''),
              saved: cards.length,
              movedImages: desired.filter((image) => image.buf !== null).length,
              cleanupPending,
            });
          }

          if (req.method === 'POST' && url === '/api/delete-card') {
            const {
              printingId: rawPrintingId,
              id: legacyId,
              vol,
            } = await readBody(req);
            const printingId = rawPrintingId ?? legacyId;
            if (
              typeof printingId !== 'string' ||
              typeof vol !== 'number' ||
              !Number.isInteger(vol) ||
              vol < 1 ||
              !new RegExp(
                `^${vol}-A\\d{3}-(?:C|UC|R|SR|SSR|USR|LSR)$`,
              ).test(printingId)
            ) {
              return sendJson(res, 400, { error: 'printingId と vol が不正です' });
            }
            const lockedDel = volLockError(vol, loadSets());
            if (lockedDel) return sendJson(res, 403, { error: lockedDel });
            const published = normalizeCardsForRead(
              readJson<Record<string, unknown>[]>(resolve(DATA, 'cards.json'), []),
            );
            if (published.some((card) => card.printingId === printingId)) {
              return sendJson(res, 403, {
                error: `${printingId} は公開済みです。管理画面からは削除できません`,
              });
            }
            const target = wipCardsPath(vol);
            const list = normalizeCardsForRead(
              readJson<Record<string, unknown>[]>(target, []),
            );
            const found = list.find((card) => card.printingId === printingId);
            if (!found) {
              let cleanupPending = false;
              const orphanImage = resolve(
                WIP_IMAGES,
                `${printingId}.webp`,
              );
              if (existsSync(orphanImage)) {
                try {
                  unlinkSync(orphanImage);
                } catch {
                  cleanupPending = true;
                }
              }
              return sendJson(res, 200, {
                ok: true,
                cleanupPending,
                alreadyDeleted: true,
              });
            }
            if (found.vol !== vol) {
              return sendJson(res, 409, {
                error: `${printingId} の保存volとリクエストvolが一致しません`,
              });
            }
            writeJson(
              target,
              canonicalCardsForLocalWrite(
                list.filter((card) => card.printingId !== printingId),
              ),
            );
            let cleanupPending = false;
            const image = resolve(WIP_IMAGES, `${printingId}.webp`);
            if (existsSync(image)) {
              try {
                unlinkSync(image);
              } catch {
                cleanupPending = true;
              }
            }
            return sendJson(res, 200, {
              ok: true,
              cleanupPending,
              alreadyDeleted: false,
            });
          }

          if (req.method === 'POST' && url === '/api/save-image') {
            // 保存済みWIPカードにだけwebp画像を保存する。公開画像はpublish-setだけが触る。
            const { printingId: rawPrintingId, id: legacyId, vol, dataUrl } =
              await readBody(req);
            const printingId = rawPrintingId ?? legacyId;
            const base64 = webpBase64Payload(dataUrl);
            if (!printingId || typeof vol !== 'number' || !base64) {
              return sendJson(res, 400, {
                error: 'printingId・vol・webp の dataUrl が必要',
              });
            }
            const imageProblem = webpBase64Problem(base64);
            if (imageProblem) {
              return sendJson(res, 400, { error: imageProblem });
            }
            const imgSets = loadSets();
            const lockedImg = volLockError(vol, imgSets);
            if (lockedImg) return sendJson(res, 403, { error: lockedImg });
            const owner = normalizeCardsForRead(
              readJson<Record<string, unknown>[]>(wipCardsPath(vol), []),
            ).find((card) => card.printingId === printingId);
            if (!owner || owner.vol !== vol) {
              return sendJson(res, 409, {
                error: `${printingId} はvol${vol}の保存済みWIPカードではありません`,
              });
            }
            mkdirSync(WIP_IMAGES, { recursive: true });
            const imagePath = resolve(WIP_IMAGES, `${printingId}.webp`);
            writeFileSync(imagePath, Buffer.from(base64, 'base64'));
            return sendJson(res, 200, {
              ok: true,
              savedTo: imagePath.replace(REPO + '/', ''),
            });
          }

          if (req.method === 'POST' && url === '/api/publish-set') {
            // ローカル開発ではGitHub Actionsを使わず、完成形を退避付きで直接反映する。
            // クラウド版と同じ検査を通し、公開側が部分更新にならないよう全対象をrollbackする。
            const { vol } = await readBody(req);
            if (typeof vol !== 'number') return sendJson(res, 400, { error: 'vol が必要' });

            // 1. 制作中カードの status:'draft' を外す（＝弾に従わせる）
            const wipFile = wipCardsPath(vol);
            const wipCards = normalizeCardsForRead(
              readJson<Record<string, unknown>[]>(wipFile, []),
            );
            const promoted = wipCards.map((c) => {
              if (c.status !== 'draft') return c;
              const { status: _drop, ...rest } = c;
              return rest;
            });
            const canonicalPromoted = canonicalCardsForLocalWrite(promoted);
            if (canonicalPromoted.some((card) => card.vol !== vol)) {
              return sendJson(res, 409, {
                error: `cards.vol${vol}.json に別volのカードがあります。公開前に修正してください`,
              });
            }

            // 公開状態と再実行可否を、公開ファイルへ触る前に確定する。
            const wipSetsFile = readJson<{ sets: SetMetaLike[] }>(
              WIP_SETS,
              { sets: [] },
            );
            const pubSetsFile = readJson<{ sets: SetMetaLike[] }>(
              PUBLIC_SETS,
              { sets: [] },
            );
            const publishedSet = (pubSetsFile.sets ?? []).find(
              (set) => set.vol === vol,
            );
            const alreadyReleased = publishedSet?.status === 'released';
            const source =
              (wipSetsFile.sets ?? []).find((set) => set.vol === vol) ??
              publishedSet;
            if (!source) {
              return sendJson(res, 404, { error: `vol${vol} の弾が見つかりません` });
            }
            if (!alreadyReleased && canonicalPromoted.length === 0) {
              return sendJson(res, 409, {
                error: `vol${vol} に公開するWIPカードがありません`,
              });
            }
            const wipEffectFile = resolve(
              WIP_EFFECTS,
              `vol${vol}.ts`,
            );
            const wipEffectTestFile = resolve(
              WIP_EFFECTS,
              `vol${vol}.test.ts`,
            );
            const publicEffectFile = resolve(
              PUBLIC_EFFECTS,
              `vol${vol}.ts`,
            );
            const publicEffectTestFile = resolve(
              PUBLIC_EFFECT_TESTS,
              `vol${vol}.test.ts`,
            );
            if (
              !existsSync(wipEffectFile) &&
              (!alreadyReleased || !existsSync(publicEffectFile))
            ) {
              return sendJson(res, 409, {
                error: `data/wip/effects/vol${vol}.ts がありません`,
              });
            }
            if (
              !existsSync(wipEffectTestFile) &&
              (!alreadyReleased || !existsSync(publicEffectTestFile))
            ) {
              return sendJson(res, 409, {
                error: `data/wip/effects/vol${vol}.test.ts がありません`,
              });
            }
            // cleanup途中でWIP effectだけ削除済みなら、公開済みの完全一致側を使って再開する。
            const effectBytes = readFileSync(
              existsSync(wipEffectFile) ? wipEffectFile : publicEffectFile,
            );
            const effectTestBytes = readFileSync(
              existsSync(wipEffectTestFile)
                ? wipEffectTestFile
                : publicEffectTestFile,
            );
            const effectSource = effectBytes.toString('utf8');
            if (
              effectBytes.length < 1 ||
              effectBytes.length > 256 * 1024 ||
              !new RegExp(
                `export\\s+const\\s+VOL${vol}_EFFECTS(?:\\s*:[^=]+)?\\s*=`,
                's',
              ).test(effectSource)
            ) {
              return sendJson(res, 409, {
                error: `vol${vol} の効果module形式が不正です`,
              });
            }
            if (
              effectTestBytes.length < 1 ||
              effectTestBytes.length > 512 * 1024 ||
              !/\b(?:it|test)(?:\.each)?\s*\(/.test(
                effectTestBytes.toString('utf8'),
              )
            ) {
              return sendJson(res, 409, {
                error: `vol${vol} の効果回帰test形式が不正です`,
              });
            }
            if (
              alreadyReleased &&
              (!existsSync(publicEffectFile) ||
                !readFileSync(publicEffectFile).equals(effectBytes))
            ) {
              return sendJson(res, 409, {
                error: `公開済みvol${vol}の効果moduleがWIPと一致しません`,
              });
            }
            if (
              alreadyReleased &&
              (!existsSync(publicEffectTestFile) ||
                !readFileSync(publicEffectTestFile).equals(effectTestBytes))
            ) {
              return sendJson(res, 409, {
                error: `公開済みvol${vol}の効果回帰testがWIPと一致しません`,
              });
            }
            if (
              alreadyReleased &&
              (!existsSync(RELEASED_EFFECTS) ||
                readFileSync(RELEASED_EFFECTS, 'utf8') !==
                  releasedEffectsSource(
                    (pubSetsFile.sets ?? [])
                      .filter((set) => set.status === 'released')
                      .map((set) => set.vol),
                  ))
            ) {
              return sendJson(res, 409, {
                error: '公開済み効果registryが弾一覧と一致しません',
              });
            }
            if (!alreadyReleased && existsSync(publicEffectFile)) {
              return sendJson(res, 409, {
                error: `公開側にvol${vol}の効果moduleが既にあります`,
              });
            }
            if (!alreadyReleased && existsSync(publicEffectTestFile)) {
              return sendJson(res, 409, {
                error: `公開側にvol${vol}の効果回帰testが既にあります`,
              });
            }

            // 2. 公開data/cards.jsonとの衝突を検査し、未公開弾だけ追記する。
            const pubFile = resolve(DATA, 'cards.json');
            const list = canonicalCardsForLocalWrite(
              normalizeCardsForRead(
                readJson<Record<string, unknown>[]>(pubFile, []),
              ),
            );
            const originalPublicByPrintingId = new Map(
              list.map((card) => [String(card.printingId), card]),
            );
            for (const card of canonicalPromoted) {
              const i = list.findIndex((existing) =>
                existing.printingId === card.printingId
              );
              if (i >= 0) {
                if (JSON.stringify(list[i]) !== JSON.stringify(card)) {
                  return sendJson(res, 409, {
                    error:
                      `公開側の ${card.printingId} はWIPと内容が異なります。` +
                      '上書きせず停止しました',
                  });
                }
              } else if (alreadyReleased) {
                return sendJson(res, 409, {
                  error:
                    `vol${vol} は公開済みですが ${card.printingId} が公開側にありません`,
                });
              } else {
                list.push(card);
              }
            }
            const canonicalPublicCards = canonicalCardsForLocalWrite(list);
            // engine buildより前、公開ファイルへ触る直前に同一oracleの定義driftを止める。
            requireResolvedOracleIds(canonicalPublicCards);
            requireNoOracleGameplayDrifts(canonicalPublicCards);

            // 3. 全画像を最初の公開書き込みより前に確認する。
            const sourceImageDir = alreadyReleased ? IMAGES : WIP_IMAGES;
            const missingImages = canonicalPromoted
              .filter(
                (card) =>
                  !existsSync(resolve(sourceImageDir, `${card.printingId}.webp`)),
              )
              .map((card) => card.printingId);
            if (missingImages.length > 0) {
              return sendJson(res, 409, {
                error: `画像が無いため公開できません: ${missingImages.join('、')}`,
              });
            }
            if (!alreadyReleased) {
              const orphanImageCollisions = canonicalPromoted
                .filter(
                  (card) =>
                    existsSync(resolve(IMAGES, `${card.printingId}.webp`)) &&
                    !originalPublicByPrintingId.has(String(card.printingId)),
                )
                .map((card) => card.printingId);
              if (orphanImageCollisions.length > 0) {
                return sendJson(res, 409, {
                  error:
                    `公開側に所有者不明の同名画像があります: ${orphanImageCollisions.join('、')}`,
                });
              }
            }

            // 4. 公開側の完成形を作り、途中失敗時は全対象を元へ戻す。
            const pubSets = (pubSetsFile.sets ?? []).filter((s) => s.vol !== vol);
            pubSets.push({ ...source, status: 'released' });
            pubSets.sort((a, b) => a.vol - b.vol);
            if (!alreadyReleased) {
              const publicCardsBefore = existsSync(pubFile)
                ? readFileSync(pubFile)
                : null;
              const publicSetsBefore = existsSync(PUBLIC_SETS)
                ? readFileSync(PUBLIC_SETS)
                : null;
              const publicEffectBefore = existsSync(publicEffectFile)
                ? readFileSync(publicEffectFile)
                : null;
              const publicEffectTestBefore = existsSync(publicEffectTestFile)
                ? readFileSync(publicEffectTestFile)
                : null;
              const releasedEffectsBefore = existsSync(RELEASED_EFFECTS)
                ? readFileSync(RELEASED_EFFECTS)
                : null;
              const imageBackups = new Map<string, Buffer | null>();
              for (const card of canonicalPromoted) {
                const target = resolve(IMAGES, `${card.printingId}.webp`);
                imageBackups.set(
                  target,
                  existsSync(target) ? readFileSync(target) : null,
                );
              }
              try {
                writeJson(pubFile, canonicalPublicCards);
                mkdirSync(IMAGES, { recursive: true });
                for (const card of canonicalPromoted) {
                  copyFileSync(
                    resolve(WIP_IMAGES, `${card.printingId}.webp`),
                    resolve(IMAGES, `${card.printingId}.webp`),
                  );
                }
                writeJson(PUBLIC_SETS, { ...pubSetsFile, sets: pubSets });
                mkdirSync(PUBLIC_EFFECTS, { recursive: true });
                writeFileSync(publicEffectFile, effectBytes);
                mkdirSync(PUBLIC_EFFECT_TESTS, { recursive: true });
                writeFileSync(publicEffectTestFile, effectTestBytes);
                writeFileSync(
                  RELEASED_EFFECTS,
                  releasedEffectsSource(pubSets.map((set) => set.vol)),
                  'utf8',
                );
                runLocalEffectPublicationGates();
              } catch (error) {
                if (publicCardsBefore) writeFileSync(pubFile, publicCardsBefore);
                else if (existsSync(pubFile)) unlinkSync(pubFile);
                if (publicSetsBefore) writeFileSync(PUBLIC_SETS, publicSetsBefore);
                else if (existsSync(PUBLIC_SETS)) unlinkSync(PUBLIC_SETS);
                if (publicEffectBefore) {
                  writeFileSync(publicEffectFile, publicEffectBefore);
                } else if (existsSync(publicEffectFile)) {
                  unlinkSync(publicEffectFile);
                }
                if (publicEffectTestBefore) {
                  writeFileSync(publicEffectTestFile, publicEffectTestBefore);
                } else if (existsSync(publicEffectTestFile)) {
                  unlinkSync(publicEffectTestFile);
                }
                if (releasedEffectsBefore) {
                  writeFileSync(RELEASED_EFFECTS, releasedEffectsBefore);
                } else if (existsSync(RELEASED_EFFECTS)) {
                  unlinkSync(RELEASED_EFFECTS);
                }
                for (const [target, backup] of imageBackups) {
                  if (backup) writeFileSync(target, backup);
                  else if (existsSync(target)) unlinkSync(target);
                }
                throw error;
              }
            }

            // 5. 公開完成後はWIP側をpublishingでロックしてから掃除する。
            // 途中失敗でもカード編集へ戻らず、同じ公開操作だけを再実行できる。
            if ((wipSetsFile.sets ?? []).some((s) => s.vol === vol)) {
              writeJson(WIP_SETS, {
                ...wipSetsFile,
                sets: (wipSetsFile.sets ?? []).map((set) =>
                  set.vol === vol
                    ? { ...set, status: 'publishing' }
                    : set
                ),
              });
            }
            const cleanupPending: string[] = [];
            for (const card of canonicalPromoted) {
              const from = resolve(WIP_IMAGES, `${card.printingId}.webp`);
              if (!existsSync(from)) continue;
              try {
                unlinkSync(from);
              } catch {
                cleanupPending.push(String(card.printingId));
              }
            }
            if (cleanupPending.length > 0) {
              return sendJson(res, 409, {
                error:
                  '公開は完了しましたがWIP画像の後片付けが残っています。' +
                  '同じ「弾を公開」をもう一度実行してください',
              });
            }
            if (existsSync(wipFile)) unlinkSync(wipFile);
            if (existsSync(wipEffectFile)) unlinkSync(wipEffectFile);
            if (existsSync(wipEffectTestFile)) unlinkSync(wipEffectTestFile);
            if ((wipSetsFile.sets ?? []).some((s) => s.vol === vol)) {
              writeJson(WIP_SETS, { ...wipSetsFile, sets: (wipSetsFile.sets ?? []).filter((s) => s.vol !== vol) });
            }

            return sendJson(res, 200, {
              ok: true,
              status: 'complete',
              cardCount: canonicalPromoted.length,
            });
          }

          if (req.method === 'POST' && url === '/api/save-set') {
            // 弾（セット）の追加・更新
            const { set } = await readBody(req);
            if (typeof set?.vol !== 'number') return sendJson(res, 400, { error: 'set.vol が必要' });
            // 公開済みの弾のメタ情報も変更させない
            const lockedSet = volLockError(set.vol, loadSets());
            if (lockedSet) return sendJson(res, 403, { error: lockedSet });
            // 「状態」を手で released にして公開状態を作ることも認めない。
            // 公開は publish-set（カードと画像を移してから最後に released にする）だけの仕事
            if (set.status === 'released' || set.status === 'publishing') {
              return sendJson(res, 403, { error: '弾の公開状態は直接変更できません。「弾を公開」を使ってください。' });
            }
            // 公開済みなら data/sets.json、制作中なら data/wip/sets.json（非公開）へ。
            // 反対側に同じ vol が残っていたら消す（draft⇄released を行き来しても二重化しない）
            const target = setSaveTarget(set);
            const other = target === PUBLIC_SETS ? WIP_SETS : PUBLIC_SETS;
            for (const [file, keep] of [[target, true], [other, false]] as [string, boolean][]) {
              const file0 = readJson<{ sets: SetMetaLike[]; _comment?: string }>(file, { sets: [] });
              const list = (file0.sets ?? []).filter((s) => s.vol !== set.vol);
              if (keep) list.push(set);
              list.sort((a, b) => a.vol - b.vol);
              if (keep || list.length !== (file0.sets ?? []).length) writeJson(file, { ...file0, sets: list });
            }
            return sendJson(res, 200, { ok: true, savedTo: target.replace(REPO + '/', '') });
          }

          return sendJson(res, 404, { error: 'unknown api' });
        } catch (e) {
          if (e instanceof CardIdentityError) {
            return sendJson(res, 400, { error: e.message });
          }
          return sendJson(res, 500, { error: String(e) });
        }
      });
  };
  return {
    name: 'bd-master-api',
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), masterApi()],
  server: {
    fs: { allow: [REPO] },
    // Cloudflare Tunnel 経由（cloudflared → https://cards.racc.games）でスマホから開くため、
    // cards.racc.games だけを許可する。Cloudflare Access のメール認証も併用する。
    // 特定ホストに絞りたい時は ADMIN_ALLOWED_HOST 環境変数で上書きできる。
    allowedHosts: process.env.ADMIN_ALLOWED_HOST
      ? [process.env.ADMIN_ALLOWED_HOST]
      : ['cards.racc.games', 'localhost', '127.0.0.1'],
  },
  // 本番プレビュー（HMRなし＝画面を離れても勝手にリロードされない）。npm run serve がこちらを使う
  preview: {
    allowedHosts: process.env.ADMIN_ALLOWED_HOST
      ? [process.env.ADMIN_ALLOWED_HOST]
      : ['cards.racc.games', 'localhost', '127.0.0.1'],
  },
});
