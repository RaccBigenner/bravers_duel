import {
  ALL_CARDS,
  DECK_SIZE,
  MAX_CHARACTERS,
  MAX_COPIES_PER_CARD,
  cardById,
  containsAll,
  deckProblems,
  type Card,
  type CharacterCard,
  type DeckList,
  type SkillCard,
} from '@bravers/engine';
import { useMemo, useState } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';

export interface CustomDeck {
  name: string;
  deck: DeckList;
}

const TYPE_CHIPS = [
  { key: 'skill', label: 'スキル' },
  { key: 'character', label: 'キャラ' },
  { key: 'equipment', label: '装備' },
  { key: 'field', label: 'フィールド' },
] as const;

export function DeckBuilder({ initial, onUse, onBack }: {
  initial: CustomDeck | null;
  onUse: (deck: CustomDeck) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'マイデッキ');
  const [chars, setChars] = useState<string[]>(initial?.deck.characterIds ?? []);
  const [counts, setCounts] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const id of initial?.deck.cardIds ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  });
  const [tab, setTab] = useState<'chars' | 'cards'>(chars.length === 0 ? 'chars' : 'cards');
  const [typeFilter, setTypeFilter] = useState<string | null>('skill');
  const [onlyUsable, setOnlyUsable] = useState(true);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState<Card | null>(null);
  const [copied, setCopied] = useState(false);

  const allChars = useMemo(() => ALL_CARDS.filter((c): c is CharacterCard => c.type === 'character'), []);
  const teamAttrs = useMemo(() => chars.map((id) => (cardById(id) as CharacterCard).attribute), [chars]);

  const slotsUsed = chars.reduce((n, id) => n + ((cardById(id) as CharacterCard).size === 'legendaryLarge' ? 2 : 1), 0);
  const cardIds = useMemo(() => {
    const list: string[] = [];
    counts.forEach((n, id) => {
      for (let i = 0; i < n; i++) list.push(id);
    });
    return list;
  }, [counts]);
  const total = cardIds.length;
  const deck: DeckList = { characterIds: chars, cardIds };
  const problems = deckProblems(deck);

  const typeCounts = useMemo(() => {
    const t = { attack: 0, guard: 0, support: 0, heal: 0, character: 0, equipment: 0, field: 0 };
    for (const id of cardIds) {
      const c = cardById(id);
      if (c.type === 'skill') t[c.valueType]++;
      else t[c.type]++;
    }
    return t;
  }, [cardIds]);

  function toggleChar(c: CharacterCard) {
    if (chars.includes(c.id)) {
      setChars(chars.filter((id) => id !== c.id));
      return;
    }
    const need = c.size === 'legendaryLarge' ? 2 : 1;
    if (slotsUsed + need > MAX_CHARACTERS) return;
    setChars([...chars, c.id]);
  }

  function changeCount(id: string, delta: number) {
    setCounts((prev) => {
      const next = new Map(prev);
      const n = Math.max(0, Math.min(MAX_COPIES_PER_CARD, (next.get(id) ?? 0) + delta));
      if (delta > 0 && total >= DECK_SIZE && n > (prev.get(id) ?? 0)) return prev; // 50枚上限
      if (n === 0) next.delete(id);
      else next.set(id, n);
      return next;
    });
  }

  const usableBySomeone = (card: Card): boolean => {
    if (card.type !== 'skill') return true;
    return teamAttrs.some((attrs) => containsAll(attrs, (card as SkillCard).conditionAttribute));
  };

  const cardPool = useMemo(() => {
    return ALL_CARDS.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false;
      if (onlyUsable && !usableBySomeone(c)) return false;
      if (query && !c.name.includes(query) && !c.effectText.includes(query)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, onlyUsable, query, chars]);

  const json = JSON.stringify({ name, characterIds: chars, cardIds }, null, 1);

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボード不可の環境 */
    }
  }

  function downloadJson() {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name || 'deck'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page narrow builder">
      <header className="page-head">
        <button className="chip" onClick={onBack}>← もどる</button>
        <input className="deck-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
      </header>

      {/* タブ */}
      <div className="filter-row">
        <button className={tab === 'chars' ? 'chip on' : 'chip'} onClick={() => setTab('chars')}>
          キャラクター（枠 {slotsUsed}/{MAX_CHARACTERS}）
        </button>
        <button className={tab === 'cards' ? 'chip on' : 'chip'} onClick={() => setTab('cards')}>
          デッキ（{total}/{DECK_SIZE}枚）
        </button>
      </div>

      {tab === 'chars' && (
        <>
          <p className="builder-hint">戦うキャラクターを選ぼう（大型は2枠）。並び順＝アクターの交代順</p>
          <div className="char-grid">
            {allChars.map((c) => {
              const idx = chars.indexOf(c.id);
              return (
                <div
                  key={c.id}
                  className={`char-pick ${idx >= 0 ? 'on' : ''}`}
                  onClick={() => toggleChar(c)}
                >
                  <CardFrame card={c} width={88} upright />
                  {idx >= 0 && <span className="pick-order">{idx + 1}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'cards' && (
        <>
          <div className="filter-row">
            {TYPE_CHIPS.map((t) => (
              <button
                key={t.key}
                className={typeFilter === t.key ? 'chip on' : 'chip'}
                onClick={() => setTypeFilter(typeFilter === t.key ? null : t.key)}
              >
                {t.label}
              </button>
            ))}
            <button className={onlyUsable ? 'chip on' : 'chip'} onClick={() => setOnlyUsable(!onlyUsable)}>
              使える
            </button>
          </div>
          <div className="filter-row">
            <input className="search" placeholder="名前・効果で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="count">
              攻{typeCounts.attack} 守{typeCounts.guard} 補{typeCounts.support} 回{typeCounts.heal} キ{typeCounts.character} 装{typeCounts.equipment} 場{typeCounts.field}
            </span>
          </div>
          <div className="builder-list">
            {cardPool.map((c) => {
              const n = counts.get(c.id) ?? 0;
              return (
                <div key={c.id} className={`builder-row ${n > 0 ? 'has' : ''}`}>
                  <div className="builder-thumb" onClick={() => setZoom(c)}>
                    <CardFrame card={c} width={46} upright />
                  </div>
                  <div className="builder-info" onClick={() => setZoom(c)}>
                    <b>{c.name}</b>
                    <span>
                      {c.type === 'skill'
                        ? `${(c as SkillCard).valueType.toUpperCase()}・コスト${(c as SkillCard).costAp}・値${(c as SkillCard).baseValue}`
                        : c.type}
                    </span>
                  </div>
                  <div className="builder-count">
                    <button className="chip small" onClick={() => changeCount(c.id, -1)} disabled={n === 0}>−</button>
                    <b className={n > 0 ? 'gold' : ''}>{n}</b>
                    <button className="chip small" onClick={() => changeCount(c.id, 1)} disabled={n >= MAX_COPIES_PER_CARD || total >= DECK_SIZE}>＋</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* フッター: 検証と保存 */}
      <div className="builder-footer">
        {problems.length > 0 ? (
          <p className="error">{problems[0]}</p>
        ) : (
          <p className="ok">✔ ルールOK！このデッキで戦えます</p>
        )}
        <div className="dialog-btns">
          <button className="chip" onClick={copyJson}>{copied ? 'コピーした！' : 'JSONコピー'}</button>
          <button className="chip" onClick={downloadJson}>ファイル保存</button>
          <button
            className="big-btn slim"
            disabled={problems.length > 0}
            onClick={() => onUse({ name: name || 'マイデッキ', deck })}
          >
            このデッキを使う
          </button>
        </div>
      </div>

      {zoom && (
        <div className="overlay preview" onClick={() => setZoom(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={zoom} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            <button className="chip" onClick={() => setZoom(null)}>とじる</button>
          </div>
        </div>
      )}
    </div>
  );
}
