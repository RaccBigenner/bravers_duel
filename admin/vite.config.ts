import react from '@vitejs/plugin-react';
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
  server: { fs: { allow: [REPO] } },
});
