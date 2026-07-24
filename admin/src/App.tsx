import {
  ATTRIBUTES,
  CARD_STATUSES,
  CHARACTER_SIZES,
  PACK_TYPES,
  RARITIES,
  SKILL_VALUE_TYPES,
  hasEffectImplementation,
} from '@bravers/engine';
import { useEffect, useMemo, useState } from 'react';
import { deleteCard, fetchMaster, saveCard, saveSet, type Master, type MasterCard, type MasterSet } from './api';
import { isBaseValueGoverned, theoreticalBaseValue } from './balance';

const TYPES = ['character', 'skill', 'equipment', 'field'] as const;

/** カードの実装状況を判定 */
type ImplState = 'ok' | 'missing' | 'orphan' | 'na';
function implState(card: MasterCard): ImplState {
  const hasImpl = hasEffectImplementation(card.id);
  const hasText = (card.effectText ?? '').trim() !== '';
  if (hasText && !hasImpl) return 'missing'; // 効果文があるのに未実装
  if (!hasText && hasImpl) return 'orphan'; // 実装はあるのに効果文が空
  if (hasText && hasImpl) return 'ok';
  return 'na'; // 効果なしカード
}

const IMPL_LABEL: Record<ImplState, string> = {
  ok: '実装済み',
  missing: '未実装',
  orphan: '実装孤児',
  na: '効果なし',
};

export function App() {
  const [master, setMaster] = useState<Master | null>(null);
  const [error, setError] = useState('');
  const [vol, setVol] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [onlyUnimpl, setOnlyUnimpl] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  async function reload() {
    try {
      setMaster(await fetchMaster());
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }

  const sets = master?.sets ?? [];
  const currentSet = sets.find((s) => s.vol === vol);
  const volCards = useMemo(() => (master?.cards ?? []).filter((c) => c.vol === vol), [master, vol]);

  const filtered = useMemo(() => {
    return volCards.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false;
      if (rarityFilter && c.rarity !== rarityFilter) return false;
      if (onlyUnimpl && implState(c) !== 'missing') return false;
      if (query && !c.name.includes(query) && !c.id.includes(query) && !(c.effectText ?? '').includes(query)) return false;
      return true;
    });
  }, [volCards, typeFilter, rarityFilter, onlyUnimpl, query]);

  const selected = volCards.find((c) => c.id === selectedId) ?? null;

  // 実装状況の集計
  const audit = useMemo(() => {
    const withText = volCards.filter((c) => (c.effectText ?? '').trim() !== '');
    const missing = withText.filter((c) => implState(c) === 'missing');
    const orphan = volCards.filter((c) => implState(c) === 'orphan');
    return { total: volCards.length, withText: withText.length, missing, orphan };
  }, [volCards]);

  async function onSaveCard(card: MasterCard) {
    try {
      const res = await saveCard(card);
      await reload();
      setSelectedId(card.id);
      flash(`保存しました → ${res.savedTo}`);
    } catch (e) {
      flash(String(e));
    }
  }

  async function onAddCard() {
    if (!currentSet) return flash('先に弾を作成してください');
    // 弾内の次の連番 code（A001, A002, ...）
    const used = volCards
      .map((c) => /^A(\d+)$/.exec(c.code)?.[1])
      .filter(Boolean)
      .map((n) => parseInt(n!, 10));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    const code = `A${String(next).padStart(3, '0')}`;
    const rarity = 'C';
    const draft: MasterCard = {
      id: `${vol}-${code}-${rarity}`,
      vol,
      code,
      rarity,
      name: '（新規カード）',
      type: 'skill',
      effectText: '',
      flavorText: '',
      status: currentSet.status === 'released' ? 'draft' : undefined,
      costAp: 1,
      conditionAttribute: ['斬'],
      baseValue: 3,
      valueType: 'attack',
    };
    await onSaveCard(draft);
  }

  if (error) return <div className="admin-error">読み込みエラー: {error}<br />ローカルサーバー（npm run admin）で開いていますか？</div>;
  if (!master) return <div className="admin-loading">読み込み中…</div>;

  return (
    <div className="admin">
      <header className="admin-head">
        <div className="admin-brand">
          BRAVER'S DUEL <span className="admin-tag">カードマスター管理（非公開・ローカル専用）</span>
        </div>
        {toast && <div className="admin-toast">{toast}</div>}
      </header>

      {/* 弾タブ */}
      <div className="set-tabs">
        {sets.map((s) => (
          <button key={s.vol} className={`set-tab ${s.vol === vol ? 'on' : ''}`} onClick={() => { setVol(s.vol); setSelectedId(null); }}>
            <b>第{s.vol}弾</b>
            <span>{s.codename || s.themeName || '(無題)'}</span>
            <em className={`set-status ${s.status}`}>{s.status === 'released' ? '公開中' : '制作中'}</em>
          </button>
        ))}
        <button className="set-tab new" onClick={() => { const v = Math.max(0, ...sets.map((s) => s.vol)) + 1; setVol(v); setSelectedId(null); }}>
          ＋ 新しい弾
        </button>
      </div>

      <div className="admin-body">
        <aside className="admin-side">
          <SetEditor
            vol={vol}
            set={currentSet}
            onSave={async (s) => { await saveSet(s); await reload(); flash('弾を保存しました'); }}
          />
          <AuditPanel audit={audit} onPick={(id) => setSelectedId(id)} />
          <PreflightPanel vol={vol} set={currentSet} cards={volCards} />
        </aside>

        <main className="admin-main">
          <div className="filter-bar">
            <input className="a-search" placeholder="名前・ID・効果で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全種類</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
              <option value="">全レア</option>
              {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className={`a-chip ${onlyUnimpl ? 'on' : ''}`}>
              <input type="checkbox" checked={onlyUnimpl} onChange={(e) => setOnlyUnimpl(e.target.checked)} /> 未実装のみ
            </label>
            <span className="a-count">{filtered.length} / {volCards.length}枚</span>
            <button className="a-add" onClick={onAddCard}>＋ カード追加</button>
          </div>

          <div className="card-grid">
            {filtered.map((c) => {
              const st = implState(c);
              return (
                <button key={c.id} className={`card-cell ${c.id === selectedId ? 'sel' : ''}`} onClick={() => setSelectedId(c.id)}>
                  <img src={`/card_images/${c.id}.webp`} alt={c.name} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                  <span className="cc-name">{c.name}</span>
                  <span className="cc-meta">{c.rarity}・{c.type}</span>
                  {(st === 'missing' || st === 'orphan') && <span className={`cc-badge ${st}`}>{IMPL_LABEL[st]}</span>}
                  {c.status === 'draft' && <span className="cc-badge draft">draft</span>}
                </button>
              );
            })}
            {filtered.length === 0 && <p className="empty">この弾にはまだカードがありません。「＋ カード追加」で作成できます。</p>}
          </div>
        </main>

        <aside className="admin-editor">
          {selected ? (
            <CardEditor
              key={selected.id}
              card={selected}
              onSave={onSaveCard}
              onDelete={async () => { await deleteCard(selected.id, selected.vol); await reload(); setSelectedId(null); flash('削除しました'); }}
            />
          ) : (
            <p className="editor-hint">カードを選ぶと、ここで編集できます。</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------- 弾（セット）エディタ ----------
function SetEditor({ vol, set, onSave }: { vol: number; set?: MasterSet; onSave: (s: MasterSet) => void }) {
  const [draft, setDraft] = useState<MasterSet>(
    set ?? { vol, themeNo: vol, themeName: '', themeSubtitle: '', packType: 'DX', status: 'draft', releasedAt: '', codename: '' },
  );
  useEffect(() => {
    setDraft(set ?? { vol, themeNo: vol, themeName: '', themeSubtitle: '', packType: 'DX', status: 'draft', releasedAt: '', codename: '' });
  }, [set, vol]);

  const up = (patch: Partial<MasterSet>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <section className="panel set-editor">
      <h3>第{vol}弾のメタ情報</h3>
      <label>弾数<input type="number" value={draft.vol} onChange={(e) => up({ vol: +e.target.value })} /></label>
      <label>テーマNo.<input type="number" value={draft.themeNo} onChange={(e) => up({ themeNo: +e.target.value })} /></label>
      <label>テーマ名<input value={draft.themeName} onChange={(e) => up({ themeName: e.target.value })} placeholder="聖戦残火" /></label>
      <label>サブタイトル<input value={draft.themeSubtitle} onChange={(e) => up({ themeSubtitle: e.target.value })} placeholder="禍いの足音" /></label>
      <label>パックタイプ
        <select value={draft.packType} onChange={(e) => up({ packType: e.target.value as MasterSet['packType'] })}>
          {PACK_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>コードネーム（制作中の仮名）<input value={draft.codename ?? ''} onChange={(e) => up({ codename: e.target.value })} placeholder="公開前のテーマ名漏れ防止" /></label>
      <label>公開日<input value={draft.releasedAt} onChange={(e) => up({ releasedAt: e.target.value })} placeholder="2026-07-01" /></label>
      <label className="status-row">状態
        <select value={draft.status} onChange={(e) => up({ status: e.target.value as MasterSet['status'] })}>
          {CARD_STATUSES.map((s) => <option key={s} value={s}>{s === 'released' ? 'released（公開）' : 'draft（制作中）'}</option>)}
        </select>
      </label>
      {draft.status === 'released' && (
        <p className="warn">⚠ released にすると、この弾のカードが公開ビルドに載ります。公開前チェックが全て緑か確認してください。</p>
      )}
      <button className="a-primary" onClick={() => onSave(draft)}>弾を保存</button>
    </section>
  );
}

// ---------- 実装状況パネル ----------
function AuditPanel({ audit, onPick }: { audit: { total: number; withText: number; missing: MasterCard[]; orphan: MasterCard[] }; onPick: (id: string) => void }) {
  return (
    <section className="panel">
      <h3>効果の実装状況</h3>
      <p className="audit-line">効果ありカード <b>{audit.withText}</b> / 全 {audit.total} 枚</p>
      <p className={`audit-line ${audit.missing.length ? 'bad' : 'good'}`}>未実装 <b>{audit.missing.length}</b> 枚</p>
      {audit.missing.length > 0 && (
        <ul className="audit-list">
          {audit.missing.map((c) => <li key={c.id}><button onClick={() => onPick(c.id)}>{c.name}</button></li>)}
        </ul>
      )}
      {audit.orphan.length > 0 && (
        <p className="audit-line warn">実装孤児（効果文が空）{audit.orphan.length} 枚: {audit.orphan.map((c) => c.name).join(', ')}</p>
      )}
    </section>
  );
}

// ---------- 公開前チェック ----------
function PreflightPanel({ vol, set, cards }: { vol: number; set?: MasterSet; cards: MasterCard[] }) {
  const [imgOk, setImgOk] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // 画像の有無を1枚ずつ確認
    let alive = true;
    Promise.all(
      cards.map(
        (c) =>
          new Promise<[string, boolean]>((res) => {
            const img = new Image();
            img.onload = () => res([c.id, true]);
            img.onerror = () => res([c.id, false]);
            img.src = `/card_images/${c.id}.webp`;
          }),
      ),
    ).then((pairs) => {
      if (alive) setImgOk(Object.fromEntries(pairs));
    });
    return () => { alive = false; };
  }, [cards]);

  const noImage = cards.filter((c) => imgOk[c.id] === false);
  const badBaseValue = cards.filter((c) => {
    if (c.type !== 'skill' || (c.effectText ?? '').trim() !== '') return false;
    if (!isBaseValueGoverned(c as any)) return false;
    return c.baseValue !== theoreticalBaseValue(c as any);
  });
  const dupId = (() => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const c of cards) { if (seen.has(c.id)) dups.push(c.id); seen.add(c.id); }
    return dups;
  })();

  const checks = [
    { label: '画像が揃っている', ok: noImage.length === 0, detail: noImage.map((c) => c.name).join(', ') },
    { label: '効果なしスキルの基本値が理論値どおり', ok: badBaseValue.length === 0, detail: badBaseValue.map((c) => `${c.name}(${c.baseValue}→${theoreticalBaseValue(c as any)})`).join(', ') },
    { label: 'IDの重複なし', ok: dupId.length === 0, detail: dupId.join(', ') },
  ];
  const allGreen = checks.every((c) => c.ok);

  return (
    <section className="panel">
      <h3>公開前チェック</h3>
      {checks.map((c) => (
        <p key={c.label} className={`audit-line ${c.ok ? 'good' : 'bad'}`}>
          {c.ok ? '✓' : '✗'} {c.label}
          {!c.ok && c.detail && <span className="detail"> — {c.detail}</span>}
        </p>
      ))}
      <p className={`preflight-verdict ${allGreen ? 'good' : 'bad'}`}>
        {allGreen ? 'この弾は公開できます' : '未解決の項目があります'}
      </p>
      {set?.status === 'draft' && allGreen && (
        <p className="hint-small">弾のメタ情報で状態を released にし、カードを data/cards.json へ移すとゲームに反映されます。</p>
      )}
    </section>
  );
}

// ---------- カードエディタ ----------
function CardEditor({ card, onSave, onDelete }: { card: MasterCard; onSave: (c: MasterCard) => void; onDelete: () => void }) {
  const [d, setD] = useState<MasterCard>(card);
  const up = (patch: Partial<MasterCard>) => setD((prev) => ({ ...prev, ...patch }));

  // id は vol-code-rarity から自動生成
  useEffect(() => {
    up({ id: `${d.vol}-${d.code}-${d.rarity}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.vol, d.code, d.rarity]);

  const theo = d.type === 'skill' ? theoreticalBaseValue(d as any) : null;
  const st = implState(d);

  function toggleAttr(field: 'attribute' | 'conditionAttribute' | 'addAttribute', a: string) {
    const cur = (d[field] as string[]) ?? [];
    up({ [field]: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] } as Partial<MasterCard>);
  }

  return (
    <div className="card-editor">
      <div className="editor-preview">
        <img src={`/card_images/${d.id}.webp`} alt="" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.15')} />
        <span className={`impl-badge ${st}`}>{IMPL_LABEL[st]}</span>
      </div>

      <div className="editor-fields">
        <div className="row3">
          <label>弾<input type="number" value={d.vol} onChange={(e) => up({ vol: +e.target.value })} /></label>
          <label>コード<input value={d.code} onChange={(e) => up({ code: e.target.value })} /></label>
          <label>レア
            <select value={d.rarity} onChange={(e) => up({ rarity: e.target.value })}>
              {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <p className="id-line">ID: <code>{d.id}</code></p>

        <label>名前<input value={d.name} onChange={(e) => up({ name: e.target.value })} /></label>
        <label>種類
          <select value={d.type} onChange={(e) => up({ type: e.target.value as MasterCard['type'] })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        {d.type === 'character' && (
          <>
            <div className="row2">
              <label>HP<input type="number" value={d.hp ?? 0} onChange={(e) => up({ hp: +e.target.value })} /></label>
              <label>サイズ
                <select value={d.size ?? 'normal'} onChange={(e) => up({ size: e.target.value })}>
                  {CHARACTER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <AttrPicker label="属性" selected={d.attribute ?? []} onToggle={(a) => toggleAttr('attribute', a)} />
          </>
        )}

        {d.type === 'skill' && (
          <>
            <div className="row3">
              <label>コストAP<input type="number" value={d.costAp ?? 0} onChange={(e) => up({ costAp: +e.target.value })} /></label>
              <label>種別
                <select value={d.valueType ?? 'attack'} onChange={(e) => up({ valueType: e.target.value })}>
                  {SKILL_VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>基本値<input type="number" value={d.baseValue ?? 0} onChange={(e) => up({ baseValue: +e.target.value })} /></label>
            </div>
            {theo !== null && (d.effectText ?? '').trim() === '' && (
              <p className={`theo ${d.baseValue === theo ? 'good' : 'bad'}`}>
                効果なしスキルの理論値: <b>{theo}</b>
                {d.baseValue !== theo && <button className="apply-theo" onClick={() => up({ baseValue: theo })}>理論値を適用</button>}
              </p>
            )}
            <AttrPicker label="条件属性" selected={d.conditionAttribute ?? []} onToggle={(a) => toggleAttr('conditionAttribute', a)} />
          </>
        )}

        {d.type === 'equipment' && (
          <AttrPicker label="付与属性" selected={d.addAttribute ?? []} onToggle={(a) => toggleAttr('addAttribute', a)} />
        )}

        <label>効果テキスト<textarea rows={3} value={d.effectText} onChange={(e) => up({ effectText: e.target.value })} /></label>
        <label>フレーバー<textarea rows={2} value={d.flavorText} onChange={(e) => up({ flavorText: e.target.value })} /></label>

        <label className="status-row">カード個別の状態
          <select value={d.status ?? ''} onChange={(e) => up({ status: (e.target.value || undefined) as MasterCard['status'] })}>
            <option value="">（弾に従う）</option>
            <option value="draft">draft（このカードだけ隠す）</option>
            <option value="released">released</option>
          </select>
        </label>

        {st === 'missing' && (
          <p className="warn">このカードは効果テキストがありますが、engine/src/effects/ に実装がありません（id: {d.id}）。</p>
        )}

        <div className="editor-actions">
          <button className="a-primary" onClick={() => onSave(d)}>保存</button>
          <button className="a-danger" onClick={() => { if (confirm(`${d.name} を削除しますか？`)) onDelete(); }}>削除</button>
        </div>
      </div>
    </div>
  );
}

function AttrPicker({ label, selected, onToggle }: { label: string; selected: string[]; onToggle: (a: string) => void }) {
  return (
    <div className="attr-picker">
      <span className="attr-label">{label}</span>
      <div className="attr-chips">
        {ATTRIBUTES.map((a) => (
          <button key={a} className={`attr-chip ${selected.includes(a) ? 'on' : ''}`} onClick={() => onToggle(a)}>{a}</button>
        ))}
      </div>
    </div>
  );
}
