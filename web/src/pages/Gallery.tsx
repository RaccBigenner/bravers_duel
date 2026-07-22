import { ALL_CARDS, ATTRIBUTES, RARITIES, type Card } from '@bravers/engine';
import { useMemo, useState } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';

const TYPES = [
  { key: 'character', label: 'キャラクター' },
  { key: 'skill', label: 'スキル' },
  { key: 'equipment', label: '装備' },
  { key: 'field', label: 'フィールド' },
] as const;

const VALUE_TYPES = [
  { key: 'attack', label: 'ATTACK' },
  { key: 'guard', label: 'GUARD' },
  { key: 'support', label: 'SUPPORT' },
  { key: 'heal', label: 'HEAL' },
] as const;

type SortKey = 'code' | 'cost' | 'value' | 'hp' | 'rarity';

function cardAttrs(card: Card): string[] {
  switch (card.type) {
    case 'character': return card.attribute;
    case 'skill': return card.conditionAttribute;
    case 'equipment': return card.addAttribute;
    default: return [];
  }
}

function sortValue(card: Card, key: SortKey): number | string {
  switch (key) {
    case 'code': return card.code;
    case 'rarity': return RARITIES.indexOf(card.rarity);
    case 'cost': return card.type === 'skill' ? card.costAp : -1;
    case 'value': return card.type === 'skill' ? card.baseValue : -1;
    case 'hp': return card.type === 'character' ? card.hp : -1;
  }
}

export function Gallery({ onBack }: { onBack?: () => void }) {
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [rarities, setRarities] = useState<Set<string>>(new Set());
  const [attrs, setAttrs] = useState<Set<string>>(new Set());
  const [valueTypes, setValueTypes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDesc, setSortDesc] = useState(false);
  const [cardWidth, setCardWidth] = useState(220);

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    update(next);
  };

  const cards = useMemo(() => {
    let list = ALL_CARDS.filter((c) => {
      if (types.size > 0 && !types.has(c.type)) return false;
      if (rarities.size > 0 && !rarities.has(c.rarity)) return false;
      if (attrs.size > 0 && !cardAttrs(c).some((a) => attrs.has(a))) return false;
      if (valueTypes.size > 0 && (c.type !== 'skill' || !valueTypes.has(c.valueType))) return false;
      if (query !== '' && !c.name.includes(query) && !c.effectText.includes(query) && !c.id.includes(query)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = va < vb ? -1 : va > vb ? 1 : a.code < b.code ? -1 : 1;
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [types, rarities, attrs, valueTypes, query, sortKey, sortDesc]);

  return (
    <div className="page">
      <header className="toolbar">
        <h1>
          {onBack && (
            <button className="chip" onClick={onBack} style={{ marginRight: 10 }}>
              ← ホーム
            </button>
          )}
          BRAVER'S DUEL カード一覧
        </h1>

        <div className="filter-row">
          <span className="filter-label">種類</span>
          {TYPES.map((t) => (
            <button
              key={t.key}
              className={types.has(t.key) ? 'chip on' : 'chip'}
              onClick={() => toggle(types, setTypes, t.key)}
            >
              {t.label}
            </button>
          ))}
          <span className="filter-label">スキル</span>
          {VALUE_TYPES.map((v) => (
            <button
              key={v.key}
              className={valueTypes.has(v.key) ? 'chip on' : 'chip'}
              onClick={() => toggle(valueTypes, setValueTypes, v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="filter-row">
          <span className="filter-label">レアリティ</span>
          {RARITIES.map((r) => (
            <button
              key={r}
              className={rarities.has(r) ? 'chip on' : 'chip'}
              onClick={() => toggle(rarities, setRarities, r)}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="filter-row">
          <span className="filter-label">属性</span>
          {ATTRIBUTES.map((a) => (
            <button
              key={a}
              className={attrs.has(a) ? 'attr-chip on' : 'attr-chip'}
              onClick={() => toggle(attrs, setAttrs, a)}
              title={a}
            >
              <img src={IMG(a)} width={22} height={22} alt={a} />
            </button>
          ))}
        </div>

        <div className="filter-row">
          <input
            className="search"
            placeholder="名前・効果・ID で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="filter-label">並び順</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="code">カード番号</option>
            <option value="rarity">レアリティ</option>
            <option value="cost">コストAP</option>
            <option value="value">基本値</option>
            <option value="hp">HP</option>
          </select>
          <button className="chip" onClick={() => setSortDesc(!sortDesc)}>
            {sortDesc ? '↓ 大きい順' : '↑ 小さい順'}
          </button>
          <span className="filter-label">サイズ</span>
          <input
            type="range"
            min={140}
            max={340}
            value={cardWidth}
            onChange={(e) => setCardWidth(Number(e.target.value))}
          />
          <span className="count">{cards.length} / {ALL_CARDS.length} 枚</span>
        </div>
      </header>

      <main className="gallery">
        {cards.map((card) => (
          <div key={card.id} className="cell">
            <CardFrame card={card} width={cardWidth} />
            <div className="cell-caption">{card.id}</div>
          </div>
        ))}
      </main>
    </div>
  );
}
