/**
 * 管理画面 ↔ ローカルサーバー(vite.config.ts の masterApi) の通信。
 * data/ のJSONを fs で直接読み書きする。公開環境には存在しない。
 */
import type { CardStatus, PackType } from '@bravers/engine';

/** 保存形式のカード（type ごとにフィールドが違うので緩めに持つ） */
export interface MasterCard {
  id: string;
  vol: number;
  code: string;
  rarity: string;
  name: string;
  type: 'character' | 'skill' | 'equipment' | 'field';
  effectText: string;
  flavorText: string;
  status?: CardStatus;
  // character
  size?: string;
  hp?: number;
  attribute?: string[];
  // skill
  costAp?: number;
  conditionAttribute?: string[];
  baseValue?: number;
  valueType?: string;
  // equipment
  addAttribute?: string[];
  [k: string]: unknown;
}

export interface MasterSet {
  vol: number;
  themeNo: number;
  themeName: string;
  themeSubtitle: string;
  packType: PackType;
  status: CardStatus;
  releasedAt: string;
  codename?: string;
}

export interface Master {
  sets: MasterSet[];
  cards: MasterCard[];
}

export async function fetchMaster(): Promise<Master> {
  const res = await fetch('/api/master');
  if (!res.ok) throw new Error(`master 取得失敗: ${res.status}`);
  return res.json();
}

export async function saveCard(card: MasterCard): Promise<{ savedTo: string }> {
  const res = await fetch('/api/save-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card }),
  });
  if (!res.ok) throw new Error(`保存失敗: ${(await res.json()).error ?? res.status}`);
  return res.json();
}

export async function deleteCard(id: string, vol: number): Promise<void> {
  const res = await fetch('/api/delete-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, vol }),
  });
  if (!res.ok) throw new Error(`削除失敗: ${res.status}`);
}

export async function saveSet(set: MasterSet): Promise<void> {
  const res = await fetch('/api/save-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set }),
  });
  if (!res.ok) throw new Error(`弾の保存失敗: ${res.status}`);
}

/** 画像ファイルを webp の data URL に変換（クライアント側。長辺を maxSide に収める） */
export async function fileToWebp(file: File, maxSide = 800): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d が使えません');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.9);
}

export async function saveImage(card: Pick<MasterCard, 'id' | 'vol' | 'status'>, dataUrl: string): Promise<{ savedTo: string }> {
  const res = await fetch('/api/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: card.id, vol: card.vol, status: card.status, dataUrl }),
  });
  if (!res.ok) throw new Error(`画像保存失敗: ${(await res.json()).error ?? res.status}`);
  return res.json();
}

export async function gitStatus(): Promise<{ changes: string[] }> {
  const res = await fetch('/api/git-status');
  if (!res.ok) throw new Error(`git status 失敗: ${res.status}`);
  return res.json();
}

export async function gitPush(message: string): Promise<{ pushed: boolean; files?: string[]; note?: string }> {
  const res = await fetch('/api/git-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`push 失敗: ${res.status}`);
  return res.json();
}
