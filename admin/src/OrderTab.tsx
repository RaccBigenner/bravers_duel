/**
 * 制作中の弾の「並び」タブ。
 *
 * できること:
 * - ドラッグ&ドロップ（スマホでは ▲▼ ボタン）で順番を入れ替える
 * - 第1弾と同じ考え方で自動並べ替え
 * - 今の並びのとおりに A001 から採番し直す（公開するまでは何度でもやり直せる）
 *
 * 並びは保存を押すまでこの画面の中だけの変更。誤操作でいきなり
 * 100枚のIDが変わると取り返しがつかないので、必ず一手挟む。
 */
import { useMemo, useState } from 'react';
import type { MasterCard, MasterSet } from './api';
import { autoSort, inCurrentOrder, renumber, withOrder } from './order';

interface Props {
  cards: MasterCard[];
  set: MasterSet;
  images: Record<string, string>;
  saving: boolean;
  /** 公開済みの弾。サーバーが403で拒否するので、画面の側でも触らせない */
  released: boolean;
  onSaveOrder: (cards: MasterCard[]) => Promise<void>;
  onConfirmCodes: (cards: MasterCard[], renames: { from: string; to: string }[]) => Promise<void>;
}

const TYPE_LABEL: Record<string, string> = {
  character: 'キャラ',
  skill: 'スキル',
  equipment: '装備',
  field: 'フィールド',
};

export function OrderTab({ cards, set, images, saving, released, onSaveOrder, onConfirmCodes }: Props) {
  const initial = useMemo(() => inCurrentOrder(cards), [cards]);
  const [list, setList] = useState<MasterCard[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // 外側のカードが増減したら（別タブで追加・削除した等）作り直す
  const signature = initial.map((c) => c.id).join(',');
  const [seenSignature, setSeenSignature] = useState(signature);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setList(initial);
  }

  const locked = released;
  const dirty = list.some((c, i) => initial[i]?.id !== c.id);
  /** 保存が押せない理由。押せないのに理由が出ないと「壊れている」と見える */
  const saveBlockedBecause = locked ? '' : saving ? '保存中です。' : !dirty ? 'まだ並べ替えていません。' : '';

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setList(next);
  }

  const preview = useMemo(() => renumber(withOrder(list), set.vol), [list, set.vol]);

  return (
    <div className="order-tab">
      <div className="order-actions">
        <button type="button" disabled={locked || saving} onClick={() => setList(autoSort(list))}>
          第1弾と同じ並びに自動整列
        </button>
        <button type="button" disabled={locked || saving || !dirty} onClick={() => setList(initial)}>
          元に戻す
        </button>
        <button
          type="button"
          className="primary"
          disabled={locked || saving || !dirty}
          onClick={() => void onSaveOrder(withOrder(list))}
        >
          並びを保存（{list.length}枚）
        </button>
      </div>

      <div className="order-note">
        {locked ? (
          <p className="locked">
            第{set.vol}弾は<b>公開済み</b>です。並び替えも採番もできません。
          </p>
        ) : (
          <p>
            並べ替えは<b>「並びを保存」を押すまで反映されません</b>。
            番号（A001…）は下の「採番を確定」を押した時に振り直します。
            {saveBlockedBecause && <><br /><span className="blocked">{saveBlockedBecause}行を動かすと保存できるようになります。</span></>}
          </p>
        )}
      </div>

      <ol className="order-list">
        {list.map((c, i) => {
          const nextCode = preview.cards[i]?.code ?? c.code;
          const willChange = !locked && nextCode !== c.code;
          return (
            <li
              key={c.id}
              className={[
                'order-row',
                dragIndex === i ? 'dragging' : '',
                overIndex === i && dragIndex !== null && dragIndex !== i ? 'over' : '',
              ].join(' ')}
              draggable={!locked && !saving}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <span className="order-no">{i + 1}</span>
              <span className="order-handle" aria-hidden>
                ⠿
              </span>
              {images[c.id] ? (
                <img className="order-thumb" src={`/card_images/${c.id}.webp?v=${images[c.id]}`} alt="" />
              ) : (
                <span className="order-thumb none">画像なし</span>
              )}
              <span className="order-name">
                <b>{c.name || '(無題)'}</b>
                <small>
                  {TYPE_LABEL[c.type] ?? c.type}・{c.rarity}
                  {c.type === 'skill' ? `・コスト${c.costAp ?? 0}` : ''}
                </small>
              </span>
              <span className={`order-code ${willChange ? 'change' : ''}`}>
                {c.code}
                {willChange && <> → {nextCode}</>}
              </span>
              {/* スマホはドラッグが効かないので、必ずボタンでも動かせるようにする */}
              <span className="order-move">
                <button type="button" disabled={locked || saving || i === 0} onClick={() => move(i, i - 1)} aria-label="上へ">
                  ▲
                </button>
                <button
                  type="button"
                  disabled={locked || saving || i === list.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label="下へ"
                >
                  ▼
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      {!locked && (
        <div className="order-confirm">
          <h3>採番を確定する</h3>
          <p>
            今の並びのとおりに <code>A001</code> から番号を振り直します。
            番号が変わるカードは <b>{preview.changed}枚</b>、
            画像も同じ数だけ引っ越します。
            <br />
            カードを足すたびに何度でもやり直せます。<b>弾を公開すると、それ以降は変更できなくなります。</b>
          </p>
          <button
            type="button"
            className="danger"
            disabled={saving || dirty || preview.changed === 0}
            onClick={() => {
              const ok = window.confirm(`${preview.changed}枚の番号と画像を振り直します。実行しますか？`);
              if (ok) void onConfirmCodes(preview.cards, preview.renames);
            }}
          >
            採番を確定（{preview.changed}枚を変更）
          </button>
          {dirty && <p className="warn">先に「並びを保存」してください。</p>}
          {!dirty && preview.changed === 0 && <p className="warn">今の並びと番号は既に一致しています。</p>}
        </div>
      )}
    </div>
  );
}
