/**
 * カード一覧の表示（3通り）と、一覧まわりの共通ロジック。
 *
 * 「カード」表示はゲーム本体と同じ `CardFrame` をそのまま使う。
 * 管理画面用に作り直すと本物とズレるので、web/ のコンポーネントを直接借りている。
 */
import type { Card } from '@bravers/engine';
import { hasEffectImplementation } from '@bravers/engine';
import { useEffect, useRef, useState } from 'react';
import { CardFrame } from '../../web/src/CardFrame';
import { imageUrl, type MasterCard } from './api';

// ---- 実装状況 --------------------------------------------------------------

export type ImplState = 'ok' | 'missing' | 'orphan' | 'na';

/** カードの効果テキストと engine の実装がそろっているか */
export function implState(card: MasterCard): ImplState {
  const hasImpl = hasEffectImplementation(card.id);
  const hasText = (card.effectText ?? '').trim() !== '';
  if (hasText && !hasImpl) return 'missing'; // 効果文があるのに未実装
  if (!hasText && hasImpl) return 'orphan'; // 実装はあるのに効果文が空
  if (hasText && hasImpl) return 'ok';
  return 'na'; // 効果なしカード
}

export const IMPL_LABEL: Record<ImplState, string> = {
  ok: '実装済み',
  missing: '未実装',
  orphan: '実装孤児',
  na: '効果なし',
};

/**
 * そのカードの属性。**種類ごとに置き場所が違うので、必ず種類で選ぶ**。
 * 全部つなげると、種類を変えた時に残った別種類の項目まで拾ってしまう
 * （キャラなのに条件属性の「斬」が1つ余計に出る不具合が実際に起きた）。
 */
export function cardAttributes(card: MasterCard): string[] {
  switch (card.type) {
    case 'character': return card.attribute ?? [];
    case 'skill': return card.conditionAttribute ?? [];
    case 'equipment': return card.addAttribute ?? [];
    default: return [];
  }
}

/** 一覧に出す代表数値（スキル=基本値 / キャラ=HP） */
export function cardValue(card: MasterCard): number | null {
  if (card.type === 'skill') return card.baseValue ?? 0;
  if (card.type === 'character') return card.hp ?? 0;
  return null;
}

/**
 * CardFrame は「型のそろったカード」を前提にしているので、
 * 作りかけで欠けている項目を埋めてから渡す（欠けたまま渡すと表示が壊れる）。
 */
export function toRenderCard(card: MasterCard): Card {
  const base = {
    id: card.id || '0-A000-C',
    vol: card.vol,
    code: card.code,
    rarity: card.rarity || 'C',
    name: card.name || '（無題）',
    effectText: card.effectText ?? '',
    flavorText: card.flavorText ?? '',
  };
  switch (card.type) {
    case 'character':
      return { ...base, type: 'character', hp: card.hp ?? 0, size: card.size ?? 'normal', attribute: card.attribute ?? [] } as unknown as Card;
    case 'equipment':
      return { ...base, type: 'equipment', addAttribute: card.addAttribute ?? [] } as unknown as Card;
    case 'field':
      return { ...base, type: 'field' } as unknown as Card;
    default:
      return {
        ...base,
        type: 'skill',
        costAp: card.costAp ?? 0,
        conditionAttribute: card.conditionAttribute ?? [],
        baseValue: card.baseValue ?? 0,
        valueType: card.valueType ?? 'attack',
      } as unknown as Card;
  }
}

// ---- 一覧の共通の型 --------------------------------------------------------

export type ViewMode = 'card' | 'list' | 'table';

export interface ListProps {
  cards: MasterCard[];
  images: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** カードの状態バッジ（未実装・制作中・画像なし） */
function Badges({ card, hasImage }: { card: MasterCard; hasImage: boolean }) {
  const st = implState(card);
  return (
    <>
      {(st === 'missing' || st === 'orphan') && <span className={`cc-badge ${st}`}>{IMPL_LABEL[st]}</span>}
      {card.status === 'draft' && <span className="cc-badge draft">制作中</span>}
      {!hasImage && <span className="cc-badge noimg">画像なし</span>}
    </>
  );
}

// ---- カード表示（ゲームと同じデザイン） ------------------------------------

/** 実際の列幅を測って CardFrame に渡す（CardFrame は px 指定が要るため） */
function useGridMetrics(ref: React.RefObject<HTMLElement>, min: number, gap: number) {
  const [metrics, setMetrics] = useState({ cols: 2, width: min });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const total = el.clientWidth;
      if (!total) return;
      const cols = Math.max(1, Math.floor((total + gap) / (min + gap)));
      setMetrics({ cols, width: Math.floor((total - gap * (cols - 1)) / cols) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min, gap]);
  return metrics;
}

export function CardGallery({ cards, images, selectedId, onSelect }: ListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const gap = 10;
  const min = 158;
  // 幅は「縦向きカードが1行に何枚入るか」で決める。
  // 大型（横長）カードはそのぶん横に広くなり、ゲームのカード一覧と同じ並びになる。
  const { width } = useGridMetrics(ref, min, gap);

  return (
    <div ref={ref} className="card-gallery" style={{ gap }}>
      {cards.map((c) => {
        const landscape = c.type === 'character' && c.size === 'legendaryLarge';
        const long = Math.round((width * 417) / 300);
        return (
          <button
            key={c.id}
            className={`gallery-cell ${c.id === selectedId ? 'sel' : ''}`}
            onClick={() => onSelect(c.id)}
            // 画面外のカードは描画を省く（144枚ぶんのカードデザインを一度に描くと重い）
            style={{ containIntrinsicSize: landscape ? `${long}px ${width}px` : `${width}px ${long}px` }}
          >
            <CardFrame card={toRenderCard(c)} width={width} />
            {/* バッジは左下にまとめて縦積み（下から 未実装 → 制作中 → 画像なし） */}
            <span className="cell-badges">
              <Badges card={c} hasImage={!!images[c.id]} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- リスト表示（情報を詰めて並べる） --------------------------------------

export function CardRows({ cards, images, selectedId, onSelect }: ListProps) {
  return (
    <div className="card-rows">
      {cards.map((c) => {
        const attrs = cardAttributes(c);
        const value = cardValue(c);
        return (
          <button
            key={c.id}
            className={`card-row ${c.id === selectedId ? 'sel' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <img
              className="row-thumb"
              src={imageUrl(c.id, images[c.id])}
              alt=""
              loading="lazy"
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
            />
            <div className="row-main">
              <div className="row-title">
                <span className="row-name">{c.name || '（無題）'}</span>
                <span className={`row-rarity r-${c.rarity}`}>{c.rarity}</span>
                <span className="row-type">{TYPE_LABEL[c.type] ?? c.type}</span>
              </div>
              <div className="row-stats">
                <span className="row-id">{c.id}</span>
                {c.type === 'skill' && <span className="stat cost">AP{c.costAp ?? 0}</span>}
                {value !== null && (
                  <span className="stat val">{c.type === 'character' ? 'HP' : VALUE_LABEL[c.valueType ?? 'attack']} {value}</span>
                )}
                {attrs.length > 0 && <span className="row-attrs">{attrs.join('・')}</span>}
              </div>
              {(c.effectText ?? '').trim() !== '' && <p className="row-effect">{c.effectText}</p>}
            </div>
            <div className="row-badges">
              <Badges card={c} hasImage={!!images[c.id]} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  character: 'キャラ',
  skill: 'スキル',
  equipment: '装備',
  field: 'フィールド',
};

const VALUE_LABEL: Record<string, string> = {
  attack: '攻',
  guard: '防',
  heal: '回',
  support: '補',
};

// ---- 表表示（PC向け・全項目を並べて見比べる） ------------------------------

export function CardTable({ cards, images, selectedId, onSelect }: ListProps) {
  return (
    <div className="card-table-wrap">
      <table className="card-table">
        <thead>
          <tr>
            <th>絵</th><th>ID</th><th>名前</th><th>レア</th><th>種類</th>
            <th>AP</th><th>値</th><th>属性</th><th>効果</th><th>状態</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr
              key={c.id}
              className={c.id === selectedId ? 'sel' : ''}
              onClick={() => onSelect(c.id)}
            >
              <td>
                <img
                  className="cell-thumb"
                  src={imageUrl(c.id, images[c.id])}
                  alt=""
                  loading="lazy"
                  onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
                />
              </td>
              <td className="mono">{c.id}</td>
              <td>{c.name || '（無題）'}</td>
              <td className={`r-${c.rarity}`}>{c.rarity}</td>
              <td>{TYPE_LABEL[c.type] ?? c.type}</td>
              <td className="num">{c.type === 'skill' ? (c.costAp ?? 0) : ''}</td>
              <td className="num">{cardValue(c) ?? ''}</td>
              <td className="attrs">{cardAttributes(c).join('・')}</td>
              <td className="effect">{c.effectText}</td>
              <td className="badges"><Badges card={c} hasImage={!!images[c.id]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
