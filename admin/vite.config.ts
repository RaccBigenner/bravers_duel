import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DATA = resolve(REPO, 'data');
const WIP = resolve(DATA, 'wip');
const IMAGES = resolve(REPO, 'assets/card_images');
const WIP_IMAGES = resolve(REPO, 'assets/wip_card_images');

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

/** JSON を人が読める形（2スペース）で保存。末尾に改行 */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
  if (!isReleasedVol(vol, sets)) return null;
  return `第${vol}弾は公開済みのため、管理画面からは変更できません。直す必要がある場合はリポジトリを直接編集してください。`;
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
 * 画像の一覧を `{ カードid: 版番号 }` で返す（クラウド版 /api/master と同じ形）。
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

function loadMaster() {
  const sets = loadSets();
  const released = readJson<Record<string, unknown>[]>(resolve(DATA, 'cards.json'), []);
  // 制作中の弾のカードを data/wip から全部集める
  const wip: Record<string, unknown>[] = [];
  if (existsSync(WIP)) {
    for (const f of readdirSync(WIP)) {
      if (!f.endsWith('.json')) continue;
      if (f === 'sets.json') continue; // 弾メタであってカードではない
      const parsed = readJson<unknown>(resolve(WIP, f), []);
      const arr = Array.isArray(parsed) ? parsed : ((parsed as { cards?: unknown[] }).cards ?? []);
      wip.push(...(arr as Record<string, unknown>[]));
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

  // 同 id は公開側を正とする（公開済みの弾に制作中カードが残っていても二重に出さない）
  const byId = new Map<string, Record<string, unknown>>();
  for (const c of [...released, ...wip]) if (!byId.has(String(c.id))) byId.set(String(c.id), c);

  return { sets, cards: [...byId.values()], images: loadImages(), orphanVols };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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
              url.includes('?v=') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
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
          if (req.method === 'GET' && url === '/api/master') {
            return sendJson(res, 200, loadMaster());
          }

          if (req.method === 'POST' && url === '/api/save-card') {
            // { card } を弾の status に応じて cards.json か wip へ保存（id で差し替え/追加）
            const { card } = await readBody(req);
            if (!card?.id || typeof card.vol !== 'number') return sendJson(res, 400, { error: 'card.id と vol が必要' });
            const sets = loadSets();
            const locked = volLockError(card.vol, sets);
            if (locked) return sendJson(res, 403, { error: locked });
            const target = cardSaveTarget(card, sets);
            // 反対側のファイルに同じ id が残っていたら消す（released⇄draft を移動したとき二重化を防ぐ）
            const other = target.endsWith('cards.json') ? wipCardsPath(card.vol) : resolve(DATA, 'cards.json');
            if (existsSync(other)) {
              const otherList = readJson<Record<string, unknown>[]>(other, []);
              const pruned = otherList.filter((c) => c.id !== card.id);
              if (pruned.length !== otherList.length) writeJson(other, pruned); // 変化がある時だけ書く
            }
            const list = readJson<Record<string, unknown>[]>(target, []);
            const idx = list.findIndex((c) => c.id === card.id);
            if (idx >= 0) list[idx] = card;
            else list.push(card);
            writeJson(target, list);
            return sendJson(res, 200, { ok: true, savedTo: target.replace(REPO + '/', '') });
          }

          if (req.method === 'POST' && url === '/api/save-cards') {
            // 並び替えと採番のための一括保存。
            // 1枚ずつ保存すると100枚超で100回ファイルを書くことになるので、
            // その弾のファイルを一度だけ書き換える。
            // renames が付いていれば画像も一緒に引っ越す（id がファイル名なので、
            // これをやらないと採番し直した瞬間に全部の絵が迷子になる）。
            const { vol, cards, renames } = await readBody(req);
            if (typeof vol !== 'number' || !Array.isArray(cards)) {
              return sendJson(res, 400, { error: 'vol と cards が必要' });
            }
            const setsForBulk = loadSets();
            const lockedBulk = volLockError(vol, setsForBulk);
            if (lockedBulk) return sendJson(res, 403, { error: lockedBulk });

            // 画像を先に動かす。カードだけ先に書いて画像で失敗すると、
            // 新しい id に対応する絵が無い状態になり、どこが欠けたか分からなくなる
            let moved = 0;
            for (const { from, to } of (renames ?? []) as { from: string; to: string }[]) {
              if (!from || !to || from === to) continue;
              for (const dir of [WIP_IMAGES, IMAGES]) {
                const src = resolve(dir, `${from}.webp`);
                if (!existsSync(src)) continue;
                copyFileSync(src, resolve(dir, `${to}.webp`));
                unlinkSync(src);
                moved++;
              }
            }

            // 保存先は1枚目の振り分けに合わせる（弾単位で必ず同じ側に入る）
            const bulkTarget = cardSaveTarget(cards[0] ?? { vol, status: 'draft' }, setsForBulk);
            const others = readJson<Record<string, unknown>[]>(bulkTarget, []).filter(
              (c) => (c as { vol?: number }).vol !== vol,
            );
            writeJson(bulkTarget, [...others, ...cards]);
            return sendJson(res, 200, {
              ok: true,
              savedTo: bulkTarget.replace(REPO + '/', ''),
              saved: cards.length,
              movedImages: moved,
            });
          }

          if (req.method === 'POST' && url === '/api/delete-card') {
            const { id, vol } = await readBody(req);
            const lockedDel = volLockError(vol, loadSets());
            if (lockedDel) return sendJson(res, 403, { error: lockedDel });
            // 公開・非公開どちらに入っていても消す（両ファイルから除去。変化がある時だけ書く）
            for (const target of [resolve(DATA, 'cards.json'), wipCardsPath(vol)]) {
              if (!existsSync(target)) continue;
              const list = readJson<Record<string, unknown>[]>(target, []);
              const pruned = list.filter((c) => c.id !== id);
              if (pruned.length !== list.length) writeJson(target, pruned);
            }
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === 'POST' && url === '/api/save-image') {
            // スマホから撮った/選んだ画像（クライアントでwebp化済み data URL）を保存。
            // カードの公開状態に合わせて assets/card_images か assets/wip_card_images へ振り分ける
            const { id, vol, status, dataUrl } = await readBody(req);
            const m = /^data:image\/webp;base64,(.+)$/.exec(dataUrl ?? '');
            if (!id || !m) return sendJson(res, 400, { error: 'id と webp の dataUrl が必要' });
            const imgSets = loadSets();
            const lockedImg = volLockError(vol, imgSets);
            if (lockedImg) return sendJson(res, 403, { error: lockedImg });
            const isPublic = status !== 'draft' && isReleasedVol(vol, imgSets);
            const dir = isPublic ? IMAGES : WIP_IMAGES;
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${id}.webp`), Buffer.from(m[1], 'base64'));
            return sendJson(res, 200, { ok: true, savedTo: resolve(dir, `${id}.webp`).replace(REPO + '/', '') });
          }

          if (req.method === 'POST' && url === '/api/publish-set') {
            // 弾を公開する。クラウド版 functions/api/publish-set.ts と同じ手順・同じ順序
            // （公開側を全部書いてから最後に status を released にする）をローカルの
            // ファイル操作でやる。途中で失敗しても弾が中途半端に公開されない。
            const { vol } = await readBody(req);
            if (typeof vol !== 'number') return sendJson(res, 400, { error: 'vol が必要' });

            // 1. 制作中カードの status:'draft' を外す（＝弾に従わせる）
            const wipFile = wipCardsPath(vol);
            const wipCards = readJson<Record<string, unknown>[]>(wipFile, []);
            const promoted = wipCards.map((c) => {
              if (c.status !== 'draft') return c;
              const { status: _drop, ...rest } = c;
              return rest;
            });

            // 2. 公開 data/cards.json に反映（同 id は差し替え）
            const pubFile = resolve(DATA, 'cards.json');
            const list = readJson<Record<string, unknown>[]>(pubFile, []);
            for (const c of promoted) {
              const i = list.findIndex((x) => x.id === c.id);
              if (i >= 0) list[i] = c;
              else list.push(c);
            }
            writeJson(pubFile, list);

            // 3. 画像を制作中フォルダから公開フォルダへ移す
            mkdirSync(IMAGES, { recursive: true });
            for (const c of promoted) {
              const from = resolve(WIP_IMAGES, `${c.id}.webp`);
              if (existsSync(from)) copyFileSync(from, resolve(IMAGES, `${c.id}.webp`));
            }

            // 4. 弾メタを wip → 公開へ released で移す（＝ここで公開が確定する）
            const wipSetsFile = readJson<{ sets: SetMetaLike[] }>(WIP_SETS, { sets: [] });
            const pubSetsFile = readJson<{ sets: SetMetaLike[] }>(PUBLIC_SETS, { sets: [] });
            const source =
              (wipSetsFile.sets ?? []).find((s) => s.vol === vol) ??
              (pubSetsFile.sets ?? []).find((s) => s.vol === vol);
            if (!source) return sendJson(res, 404, { error: `vol${vol} の弾が見つかりません` });
            const pubSets = (pubSetsFile.sets ?? []).filter((s) => s.vol !== vol);
            pubSets.push({ ...source, status: 'released' });
            pubSets.sort((a, b) => a.vol - b.vol);
            writeJson(PUBLIC_SETS, { ...pubSetsFile, sets: pubSets });

            // 5. 最後に制作中側を空にする
            if (wipCards.length > 0) writeJson(wipFile, []);
            for (const c of promoted) {
              const from = resolve(WIP_IMAGES, `${c.id}.webp`);
              if (existsSync(from)) unlinkSync(from);
            }
            if ((wipSetsFile.sets ?? []).some((s) => s.vol === vol)) {
              writeJson(WIP_SETS, { ...wipSetsFile, sets: (wipSetsFile.sets ?? []).filter((s) => s.vol !== vol) });
            }

            return sendJson(res, 200, { ok: true, moved: promoted.length });
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
            if (set.status === 'released') {
              return sendJson(res, 403, { error: '弾を公開するには「弾を公開」を使ってください（状態を直接 released にはできません）。' });
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
    // racc.games のサブドメインを許可する。cards.racc.games には Cloudflare Access の
    // メール認証がかかっており、社長のメール以外は到達できない。
    // 特定ホストに絞りたい時は ADMIN_ALLOWED_HOST 環境変数で上書きできる。
    allowedHosts: process.env.ADMIN_ALLOWED_HOST
      ? [process.env.ADMIN_ALLOWED_HOST]
      : ['.racc.games', 'localhost', '127.0.0.1'],
  },
  // 本番プレビュー（HMRなし＝画面を離れても勝手にリロードされない）。npm run serve がこちらを使う
  preview: {
    allowedHosts: process.env.ADMIN_ALLOWED_HOST
      ? [process.env.ADMIN_ALLOWED_HOST]
      : ['.racc.games', 'localhost', '127.0.0.1'],
  },
});
