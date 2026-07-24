import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

interface SetMetaLike {
  vol: number;
  status?: string;
  [k: string]: unknown;
}

function isReleasedVol(vol: number, sets: SetMetaLike[]): boolean {
  return sets.find((s) => s.vol === vol)?.status === 'released';
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

function loadMaster() {
  const setsFile = readJson<{ sets: SetMetaLike[] }>(resolve(DATA, 'sets.json'), { sets: [] });
  const sets = setsFile.sets ?? [];
  const released = readJson<Record<string, unknown>[]>(resolve(DATA, 'cards.json'), []);
  // 制作中の弾のカードを data/wip から全部集める
  const wip: Record<string, unknown>[] = [];
  if (existsSync(WIP)) {
    for (const f of readdirSync(WIP)) {
      if (!f.endsWith('.json')) continue;
      const parsed = readJson<unknown>(resolve(WIP, f), []);
      const arr = Array.isArray(parsed) ? parsed : ((parsed as { cards?: unknown[] }).cards ?? []);
      wip.push(...(arr as Record<string, unknown>[]));
    }
  }
  return { sets, cards: [...released, ...wip] };
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
  return {
    name: 'bd-master-api',
    configureServer(server) {
      // カード画像を配信（公開画像 → 無ければ制作中画像の順で探す）
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/card_images/')) return next();
        const name = decodeURIComponent(url.slice('/card_images/'.length).split('?')[0]);
        for (const dir of [IMAGES, WIP_IMAGES]) {
          const file = resolve(dir, name);
          if (file.startsWith(dir) && existsSync(file)) {
            res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
            res.end(readFileSync(file));
            return;
          }
        }
        res.statusCode = 404;
        res.end('not found');
      });

      // マスターデータ API
      server.middlewares.use(async (req, res, next) => {
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
            const setsFile = readJson<{ sets: SetMetaLike[] }>(resolve(DATA, 'sets.json'), { sets: [] });
            const target = cardSaveTarget(card, setsFile.sets ?? []);
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

          if (req.method === 'POST' && url === '/api/delete-card') {
            const { id, vol } = await readBody(req);
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
            const setsFile = readJson<{ sets: SetMetaLike[] }>(resolve(DATA, 'sets.json'), { sets: [] });
            const isPublic = status !== 'draft' && isReleasedVol(vol, setsFile.sets ?? []);
            const dir = isPublic ? IMAGES : WIP_IMAGES;
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${id}.webp`), Buffer.from(m[1], 'base64'));
            return sendJson(res, 200, { ok: true, savedTo: resolve(dir, `${id}.webp`).replace(REPO + '/', '') });
          }

          if (req.method === 'GET' && url === '/api/git-status') {
            // 公開リポジトリ側（data/cards.json 等）に未コミットの変更があるか。
            // data/wip は gitignore なのでここには出ない＝未公開データは push されない
            const out = execFileSync('git', ['status', '--porcelain'], { cwd: REPO }).toString();
            return sendJson(res, 200, { changes: out.split('\n').filter(Boolean) });
          }

          if (req.method === 'POST' && url === '/api/git-push') {
            // スマホからの「公開」ボタン。PC の既存 git 認証だけを使い、トークンはブラウザに出さない。
            // gitignore により data/wip・wip画像は push 対象外なので、公開データだけが上がる
            const { message } = await readBody(req);
            execFileSync('git', ['add', '-A'], { cwd: REPO });
            const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: REPO }).toString().trim();
            if (!staged) return sendJson(res, 200, { ok: true, pushed: false, note: '変更なし' });
            execFileSync('git', ['commit', '-m', String(message || 'カードマスター更新（管理画面）')], { cwd: REPO });
            execFileSync('git', ['push'], { cwd: REPO });
            return sendJson(res, 200, { ok: true, pushed: true, files: staged.split('\n') });
          }

          if (req.method === 'POST' && url === '/api/save-set') {
            // 弾（セット）の追加・更新
            const { set } = await readBody(req);
            if (typeof set?.vol !== 'number') return sendJson(res, 400, { error: 'set.vol が必要' });
            const setsFile = readJson<{ sets: SetMetaLike[]; _comment?: string }>(resolve(DATA, 'sets.json'), { sets: [] });
            const sets = setsFile.sets ?? [];
            const idx = sets.findIndex((s) => s.vol === set.vol);
            if (idx >= 0) sets[idx] = set;
            else sets.push(set);
            sets.sort((a, b) => a.vol - b.vol);
            writeJson(resolve(DATA, 'sets.json'), { ...setsFile, sets });
            return sendJson(res, 200, { ok: true });
          }

          return sendJson(res, 404, { error: 'unknown api' });
        } catch (e) {
          return sendJson(res, 500, { error: String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), masterApi()],
  server: {
    fs: { allow: [REPO] },
    // Tailscale 経由（tailscale serve → https://＜PC名＞.＜tailnet＞.ts.net）でスマホから開くため、
    // .ts.net ホストを許可する。tailnet の中の端末しか到達できないので安全。
    // 特定ホストに絞りたい時は ADMIN_ALLOWED_HOST 環境変数で上書きできる。
    // 注意: `tailscale funnel`（インターネット全体に公開）は絶対に使わないこと。
    allowedHosts: process.env.ADMIN_ALLOWED_HOST
      ? [process.env.ADMIN_ALLOWED_HOST]
      : ['.ts.net', 'localhost', '127.0.0.1'],
  },
});
