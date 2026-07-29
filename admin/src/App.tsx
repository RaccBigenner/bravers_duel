import {
  ATTRIBUTES,
  CARD_STATUSES,
  CHARACTER_SIZES,
  PACK_TYPES,
  RARITIES,
  SKILL_VALUE_TYPES,
} from '@bravers/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setImageRevisions } from '../../web/src/cardAssets';
import {
  deleteCard,
  fetchMaster,
  fileToWebp,
  publishSet,
  renameImage,
  saveCard,
  saveCards,
  saveImage,
  saveSet,
  stripForType,
  type Master,
  type MasterCard,
  type MasterSet,
} from './api';
import { isBaseValueGoverned, theoreticalBaseValue } from './balance';
import { buildCardPngFile, canShareImage, downloadFile, shareImageFile } from './exportCard';
import { clearLog, getLog, subscribeLog } from './log';
import {
  CardGallery,
  CardRows,
  CardTable,
  IMPL_LABEL,
  cardAttributes,
  cardValue,
  implState,
  toRenderCard,
  type ViewMode,
} from './cardView';
import { CardFrame } from '../../web/src/CardFrame';
import { OrderTab } from './OrderTab';
import { StatsTab } from './StatsTab';

const TYPES = ['character', 'skill', 'equipment', 'field'] as const;
const TYPE_LABEL: Record<string, string> = {
  character: 'キャラ',
  skill: 'スキル',
  equipment: '装備',
  field: 'フィールド',
};

type SortKey = 'id' | 'cost' | 'value' | 'rarity' | 'name' | 'type';
const SORT_LABEL: Record<SortKey, string> = {
  id: '番号',
  cost: 'コスト',
  value: '数値',
  rarity: 'レアリティ',
  name: '名前',
  type: '種類',
};

/** スマホ判定。表示だけでなく「編集を全画面で出す」等の動きも変えるので JS 側でも持つ */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/** 公開前チェックの結果 */
interface Preflight {
  checks: { label: string; ok: boolean; detail: string }[];
  allGreen: boolean;
}

function computePreflight(cards: MasterCard[], images: Record<string, string>): Preflight {
  const noImage = cards.filter((c) => !images[c.id]);
  const badBaseValue = cards.filter((c) => {
    if (c.type !== 'skill' || (c.effectText ?? '').trim() !== '') return false;
    if (!isBaseValueGoverned(c as never)) return false;
    return c.baseValue !== theoreticalBaseValue(c as never);
  });
  const missing = cards.filter((c) => implState(c) === 'missing');
  const dupId = (() => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const c of cards) {
      if (seen.has(c.id)) dups.push(c.id);
      seen.add(c.id);
    }
    return dups;
  })();

  const checks = [
    { label: '画像が揃っている', ok: noImage.length === 0, detail: noImage.map((c) => c.name).join('、') },
    { label: '効果テキストの実装が揃っている', ok: missing.length === 0, detail: missing.map((c) => c.name).join('、') },
    {
      label: '効果なしスキルの基本値が理論値どおり',
      ok: badBaseValue.length === 0,
      detail: badBaseValue.map((c) => `${c.name}(${c.baseValue}→${theoreticalBaseValue(c as never)})`).join('、'),
    },
    { label: 'IDの重複なし', ok: dupId.length === 0, detail: dupId.join('、') },
  ];
  return { checks, allGreen: checks.every((c) => c.ok) };
}

export function App() {
  const [master, setMaster] = useState<Master | null>(null);
  const [error, setError] = useState('');
  const [vol, setVol] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 新規カードは保存するまで data に入れない「下書き」。ここにある間は編集フォームに出るが未保存
  const [draftCard, setDraftCard] = useState<MasterCard | null>(null);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  /** 保存中に利用者が「← 一覧へ」を押したか。押していたら保存後に開き直さない */
  const userClosedRef = useRef(false);

  const narrow = useIsNarrow();
  const [tab, setTab] = useState<'cards' | 'order' | 'stats' | 'set' | 'check'>('cards');
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('bd-admin-view') as ViewMode) || 'card',
  );
  useEffect(() => localStorage.setItem('bd-admin-view', view), [view]);

  // 絞り込み・並び替え
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [attrFilter, setAttrFilter] = useState('');
  const [costFilter, setCostFilter] = useState('');
  const [flags, setFlags] = useState({ unimpl: false, noImage: false, draft: false, hasEffect: false });
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortAsc, setSortAsc] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);

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

  // カードデザイン側の画像URLにも版番号を渡す（変わった時だけ取り直させる）
  useEffect(() => {
    if (master) setImageRevisions(master.images);
  }, [master]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  }

  const sets = master?.sets ?? [];
  const images = master?.images ?? {};
  const currentSet = sets.find((s) => s.vol === vol);
  /**
   * 公開済みの弾は読み取り専用。ここは「押せないようにして事故を防ぐ」ための表示上の制限で、
   * 本当の防壁はサーバ側（functions/_github.ts の assertVolEditable と、
   * ローカルの vite.config.ts の volLockError）。画面だけで守ると、
   * 古いタブが開きっぱなしの時などに素通りする。
   */
  const locked = currentSet?.status === 'released';
  const volCards = useMemo(() => (master?.cards ?? []).filter((c) => c.vol === vol), [master, vol]);

  const filtered = useMemo(() => {
    const list = volCards.filter((c) => {
      if (typeFilter && c.type !== typeFilter) return false;
      if (rarityFilter && c.rarity !== rarityFilter) return false;
      if (attrFilter && !cardAttributes(c).includes(attrFilter)) return false;
      if (costFilter && String(c.costAp ?? '') !== costFilter) return false;
      if (flags.unimpl && implState(c) !== 'missing') return false;
      if (flags.noImage && images[c.id]) return false;
      if (flags.draft && c.status !== 'draft') return false;
      if (flags.hasEffect && (c.effectText ?? '').trim() === '') return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${c.name}\n${c.id}\n${c.effectText ?? ''}\n${c.flavorText ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortAsc ? 1 : -1;
    const rank = (c: MasterCard) => RARITIES.indexOf(c.rarity as (typeof RARITIES)[number]);
    return list.sort((a, b) => {
      switch (sortKey) {
        case 'cost':
          return ((a.costAp ?? -1) - (b.costAp ?? -1)) * dir || a.id.localeCompare(b.id);
        case 'value':
          return ((cardValue(a) ?? -1) - (cardValue(b) ?? -1)) * dir || a.id.localeCompare(b.id);
        case 'rarity':
          return (rank(a) - rank(b)) * dir || a.id.localeCompare(b.id);
        case 'name':
          return a.name.localeCompare(b.name, 'ja') * dir;
        case 'type':
          return (TYPES.indexOf(a.type) - TYPES.indexOf(b.type)) * dir || a.id.localeCompare(b.id);
        default:
          return a.id.localeCompare(b.id) * dir;
      }
    });
  }, [volCards, typeFilter, rarityFilter, attrFilter, costFilter, flags, query, sortKey, sortAsc, images]);

  // 下書きがあればそれを優先して編集フォームに出す（未保存の新規カード）
  const selected = draftCard ?? volCards.find((c) => c.id === selectedId) ?? null;
  const preflight = useMemo(() => computePreflight(volCards, images), [volCards, images]);

  const costOptions = useMemo(
    () => [...new Set(volCards.map((c) => c.costAp).filter((v): v is number => typeof v === 'number'))].sort((a, b) => a - b),
    [volCards],
  );

  const activeFilters =
    (typeFilter ? 1 : 0) + (rarityFilter ? 1 : 0) + (attrFilter ? 1 : 0) + (costFilter ? 1 : 0) +
    Object.values(flags).filter(Boolean).length;

  function clearFilters() {
    setTypeFilter('');
    setRarityFilter('');
    setAttrFilter('');
    setCostFilter('');
    setFlags({ unimpl: false, noImage: false, draft: false, hasEffect: false });
  }

  // スマホでは編集を全画面シートで出す。背面がスクロールしないように固定する
  const sheetOpen = narrow && !!selected;
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  function closeEditor() {
    userClosedRef.current = true;
    setDraftCard(null);
    setSelectedId(null);
  }

  /**
   * 手元のカード一覧を保存内容で置き換える。
   * 保存のたびに GitHub から全件読み直すと、①数秒待たされる ②GitHub は書いた直後の
   * 読み取りが少し古いままなので、保存したのに古い内容が返ってくる ことがある。
   * 保存が成功したなら中身は分かっているので、手元を直接更新する。
   */
  function applyCardLocally(saved: MasterCard, removeId?: string) {
    setMaster((m) => {
      if (!m) return m;
      const cards = m.cards.filter((c) => c.id !== saved.id && c.id !== removeId);
      return { ...m, cards: [...cards, saved] };
    });
  }

  async function onSaveCard(card: MasterCard, originalId?: string) {
    userClosedRef.current = false;
    setSaving(true);
    try {
      // 編集で id（弾/コード/レア）が変わったら、古いレコードを消してから保存
      // （これをしないと元の id のカードが「空カード」として残る）
      if (originalId && originalId !== card.id) {
        await deleteCard(originalId, card.vol);
      }
      const res = await saveCard(card);
      // id は「弾-コード-レアリティ」なので、レアリティを変えると id が変わる。
      // 画像のファイル名は id そのものなので、一緒に引っ越さないと絵が迷子になる
      // （実際に第2弾で8枚が「画像なし」になっていた）。
      if (originalId && originalId !== card.id) {
        await renameImage(card.vol, originalId, card.id).catch((e) => flash(`画像の引っ越しに失敗: ${e}`));
      }
      applyCardLocally(stripForType(card), originalId);
      setDraftCard(null); // 下書きを確定
      // 保存を待っている間に「← 一覧へ」を押していたら、勝手に開き直さない
      if (!userClosedRef.current) setSelectedId(card.id);
      flash(`保存しました → ${res.savedTo}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setSaving(false);
    }
  }

  function onAddCard() {
    if (!currentSet) return flash('先に弾を作成してください');
    if (locked) return flash(`第${vol}弾は公開済みのため、カードを追加できません`);
    // 弾内の次の連番 code（A001, A002, ...）。下書き中や既存カードと被らないように
    const used = volCards
      .map((c) => /^A(\d+)$/.exec(c.code)?.[1])
      .filter(Boolean)
      .map((n) => parseInt(n!, 10));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    const code = `A${String(next).padStart(3, '0')}`;
    const rarity = 'C';
    // 保存はしない。下書きとして編集フォームに出し、「保存」を押して初めて data に入る
    setDraftCard({
      id: `${vol}-${code}-${rarity}`,
      vol,
      code,
      rarity,
      name: '',
      type: 'skill',
      effectText: '',
      flavorText: '',
      costAp: 1,
      conditionAttribute: ['斬'],
      baseValue: 3,
      valueType: 'attack',
    });
    setSelectedId(null);
  }

  if (error) {
    return (
      <div className="admin-error">
        読み込みエラー: {error}
        <br />
        しばらく待ってから画面を開き直してください。直らない場合は GitHub トークンの期限切れかもしれません。
      </div>
    );
  }
  if (!master) return <div className="admin-loading">読み込み中…</div>;

  const listProps = { cards: filtered, images, selectedId, onSelect: (id: string) => { setDraftCard(null); setSelectedId(id); } };

  const cardsPane = (
    <main className="admin-main">
      <div className="filter-bar">
        <input
          className="a-search"
          placeholder="名前・ID・効果で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className={`a-btn ${activeFilters ? 'on' : ''}`} onClick={() => setFilterOpen((v) => !v)}>
          絞り込み{activeFilters ? ` ${activeFilters}` : ''}
        </button>
        <div className="view-switch">
          <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>カード</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>リスト</button>
          {!narrow && <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>表</button>}
        </div>
        <button
          className="a-add"
          onClick={onAddCard}
          disabled={locked}
          title={locked ? '公開済みの弾にはカードを追加できません' : ''}
        >
          ＋ 追加
        </button>
      </div>

      {filterOpen && (
        <div className="filter-panel">
          <div className="fp-row">
            <label>種類
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">すべて</option>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label>レア
              <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
                <option value="">すべて</option>
                {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>コスト
              <select value={costFilter} onChange={(e) => setCostFilter(e.target.value)}>
                <option value="">すべて</option>
                {costOptions.map((c) => <option key={c} value={String(c)}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="fp-attrs">
            <button className={`attr-chip ${attrFilter === '' ? 'on' : ''}`} onClick={() => setAttrFilter('')}>属性なし指定</button>
            {ATTRIBUTES.map((a) => (
              <button key={a} className={`attr-chip ${attrFilter === a ? 'on' : ''}`} onClick={() => setAttrFilter(attrFilter === a ? '' : a)}>
                {a}
              </button>
            ))}
          </div>
          <div className="fp-flags">
            {([
              ['unimpl', '未実装のみ'],
              ['noImage', '画像なしのみ'],
              ['draft', '制作中のみ'],
              ['hasEffect', '効果ありのみ'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className={`a-chip ${flags[key] ? 'on' : ''}`}
                onClick={() => setFlags((f) => ({ ...f, [key]: !f[key] }))}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="fp-row">
            <label>並び替え
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            </label>
            <button className="a-btn" onClick={() => setSortAsc((v) => !v)}>{sortAsc ? '昇順 ↑' : '降順 ↓'}</button>
            <button className="a-btn" onClick={clearFilters} disabled={!activeFilters}>絞り込みを解除</button>
          </div>
        </div>
      )}

      <div className="result-line">
        <span className="a-count">{filtered.length} / {volCards.length}枚</span>
        <span className="sort-note">{SORT_LABEL[sortKey]}{sortAsc ? '順' : '逆順'}</span>
        {activeFilters > 0 && <button className="clear-link" onClick={clearFilters}>絞り込み解除</button>}
      </div>

      {filtered.length === 0 ? (
        <p className="empty">
          {volCards.length === 0
            ? 'この弾にはまだカードがありません。「＋ 追加」で作成できます。'
            : '条件に合うカードがありません。'}
        </p>
      ) : view === 'card' ? (
        <CardGallery {...listProps} />
      ) : view === 'list' ? (
        <CardRows {...listProps} />
      ) : (
        <CardTable {...listProps} />
      )}
    </main>
  );

  /** 並びの一括保存。カードは全部まとめて1回で書く */
  async function onSaveOrder(ordered: MasterCard[]) {
    setSaving(true);
    try {
      const r = await saveCards(vol, ordered);
      setMaster((m) => (m ? { ...m, cards: [...m.cards.filter((c) => c.vol !== vol), ...ordered] } : m));
      flash(`並びを保存しました（${r.saved}枚 → ${r.savedTo}）`);
    } catch (e) {
      flash(String(e));
    } finally {
      setSaving(false);
    }
  }

  /**
   * 採番。カードのIDと画像を同時に動かす。
   * 公開するまでは何度でもやり直せる（公開後はサーバ側が変更を拒否する）。
   */
  async function onConfirmCodes(renumbered: MasterCard[], renames: { from: string; to: string }[]) {
    if (!currentSet) return;
    setSaving(true);
    try {
      const r = await saveCards(vol, renumbered, renames);
      setMaster((m) => (m ? { ...m, cards: [...m.cards.filter((c) => c.vol !== vol), ...renumbered] } : m));
      setSelectedId(null);
      // 画像の版番号（?v=）は GitHub 側の sha なので、引っ越し後は読み直さないと合わない
      await reload();
      flash(`採番を確定しました（${r.saved}枚・画像${r.movedImages}枚を移動）`);
    } catch (e) {
      flash(String(e));
    } finally {
      setSaving(false);
    }
  }

  const orderPane = currentSet ? (
    <main className="admin-main">
      <OrderTab
        cards={volCards}
        set={currentSet}
        images={images}
        saving={saving}
        released={locked}
        onSaveOrder={onSaveOrder}
        onConfirmCodes={onConfirmCodes}
      />
    </main>
  ) : (
    <main className="admin-main"><p className="empty">先に弾を作成してください。</p></main>
  );

  const statsPane = (
    <main className="admin-main">
      <StatsTab cards={volCards} images={images} />
    </main>
  );

  const orphanVols = master.orphanVols ?? [];

  const setPane = (
    <>
      {orphanVols.includes(vol) && (
        <p className="warn">
          ⚠ 第{vol}弾は「カードはあるのに弾の情報が無い」状態です。
          テーマ名などを入れて「弾を保存」を押すと直ります（カードは消えていません）。
        </p>
      )}
    <SetEditor
      vol={vol}
      set={currentSet}
      locked={locked}
      onSave={async (s) => {
        await saveSet(s);
        // カードと同じ理由で手元を直接更新する（GitHub の読み直しは待たない）
        setMaster((m) => (m ? { ...m, sets: [...m.sets.filter((x) => x.vol !== s.vol), s].sort((a, b) => a.vol - b.vol) } : m));
        flash('弾を保存しました');
      }}
    />
    </>
  );

  const checkPane = (
    <>
      <AuditPanel
        cards={volCards}
        onPick={(id) => { setDraftCard(null); setSelectedId(id); if (narrow) setTab('cards'); }}
      />
      <PreflightPanel preflight={preflight} />
      <PublishPanel
        set={currentSet}
        preflight={preflight}
        onPublish={async () => {
          const r = await publishSet(vol);
          await reload();
          flash(`第${vol}弾を公開しました（${r.moved}枚）`);
        }}
        onFlash={flash}
      />
      <LogPanel />
    </>
  );

  const editorPane = selected ? (
    <CardEditor
      key={draftCard ? 'draft' : selected.id}
      card={selected}
      isDraft={!!draftCard}
      locked={locked}
      saving={saving}
      imageRev={images[selected.id]}
      onSave={onSaveCard}
      onCancel={closeEditor}
      onDelete={async () => {
        const { id, vol } = selected;
        await deleteCard(id, vol);
        setMaster((m) => (m ? { ...m, cards: m.cards.filter((c) => c.id !== id) } : m));
        closeEditor();
        flash('削除しました');
      }}
      onImageSaved={reload}
    />
  ) : (
    <p className="editor-hint">カードを選ぶと、ここで編集できます。「＋ 追加」で新規作成できます。</p>
  );

  return (
    <div className={`admin ${narrow ? 'narrow' : ''}`}>
      <header className="admin-head">
        <div className="admin-brand">
          BRAVER'S DUEL <span className="admin-tag">カードマスター管理</span>
        </div>
        {toast && <div className="admin-toast">{toast}</div>}
      </header>

      {/* 弾タブ */}
      <div className="set-tabs">
        {sets.map((s) => (
          <button
            key={s.vol}
            className={`set-tab ${s.vol === vol ? 'on' : ''}`}
            onClick={() => { setVol(s.vol); closeEditor(); }}
          >
            <b>第{s.vol}弾</b>
            <span>{s.codename || s.themeName || '(無題)'}</span>
            {orphanVols.includes(s.vol) ? (
              <em className="set-status orphan">要設定</em>
            ) : (
              <em className={`set-status ${s.status}`}>{s.status === 'released' ? '公開中' : '制作中'}</em>
            )}
          </button>
        ))}
        <button
          className="set-tab new"
          onClick={() => { setVol(Math.max(0, ...sets.map((s) => s.vol)) + 1); closeEditor(); if (narrow) setTab('set'); }}
        >
          ＋ 新しい弾
        </button>
      </div>

      {narrow ? (
        <>
          <div className="pane">
            {tab === 'cards' && cardsPane}
            {tab === 'order' && orderPane}
            {tab === 'stats' && statsPane}
            {tab === 'set' && <aside className="admin-side">{setPane}</aside>}
            {tab === 'check' && <aside className="admin-side">{checkPane}</aside>}
          </div>

          <nav className="tabbar">
            <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>カード</button>
            <button className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>並び</button>
            <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>集計</button>
            <button className={tab === 'set' ? 'on' : ''} onClick={() => setTab('set')}>弾の設定</button>
            <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>
              {/* 5タブになったので、いちばん長いこれだけ短くする */}
              公開{preflight.allGreen ? '' : ' •'}
            </button>
          </nav>

          {sheetOpen && (
            <div className="sheet-backdrop" onClick={closeEditor}>
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-head">
                  <button className="a-btn" onClick={closeEditor}>← 一覧へ</button>
                  <span className="sheet-title">{selected?.name || '新しいカード'}</span>
                </div>
                <div className="sheet-body">{editorPane}</div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="admin-body">
          <aside className="admin-side">
            {setPane}
            {checkPane}
          </aside>
          <div className="admin-center">
            {/* PCでも中央だけを切り替える。編集フォームは右に出したままにしたいので、
                画面ごと差し替えるのではなくここだけタブにする */}
            <nav className="center-tabs">
              <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>カード</button>
              <button className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>並び</button>
              <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>集計</button>
            </nav>
            {tab === 'order' ? orderPane : tab === 'stats' ? statsPane : cardsPane}
          </div>
          <aside className="admin-editor">{editorPane}</aside>
        </div>
      )}
    </div>
  );
}

// ---------- 弾（セット）エディタ ----------
function SetEditor({ vol, set, locked, onSave }: {
  vol: number;
  set?: MasterSet;
  locked: boolean;
  onSave: (s: MasterSet) => void;
}) {
  const blank = (): MasterSet => ({
    vol, themeNo: vol, themeName: '', themeSubtitle: '', packType: 'DX', status: 'draft', releasedAt: '', codename: '',
  });
  const [draft, setDraft] = useState<MasterSet>(set ?? blank());
  useEffect(() => {
    setDraft(set ?? blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, vol]);

  const up = (patch: Partial<MasterSet>) => setDraft((d) => ({ ...d, ...patch }));

  // 公開済みの弾は中身を見せるだけにする。編集できると、公開後の弾に
  // 手を入れて公開データを壊す事故が起きる（実際に起きた）
  if (locked && set) {
    return (
      <section className="panel set-editor">
        <h3>第{vol}弾のメタ情報</h3>
        <p className="audit-line good">この弾は公開済みです。管理画面からは変更できません。</p>
        <dl className="set-readonly">
          <dt>テーマ名</dt><dd>{set.themeName || '(未設定)'}</dd>
          <dt>サブタイトル</dt><dd>{set.themeSubtitle || '(未設定)'}</dd>
          <dt>テーマNo.</dt><dd>{set.themeNo ?? '-'}</dd>
          <dt>パックタイプ</dt><dd>{set.packType || '-'}</dd>
          <dt>公開日</dt><dd>{set.releasedAt || '-'}</dd>
        </dl>
        <p className="hint-small">
          直す必要がある場合は、リポジトリを直接編集して push してください
          （テストと CI が通ることを必ず確認してください）。
        </p>
      </section>
    );
  }

  return (
    <section className="panel set-editor">
      <h3>第{vol}弾のメタ情報</h3>
      <div className="row2">
        <label>弾数<input type="number" inputMode="numeric" value={draft.vol} onChange={(e) => up({ vol: +e.target.value })} /></label>
        <label>テーマNo.<input type="number" inputMode="numeric" value={draft.themeNo} onChange={(e) => up({ themeNo: +e.target.value })} /></label>
      </div>
      <label>テーマ名<input value={draft.themeName} onChange={(e) => up({ themeName: e.target.value })} placeholder="聖戦残火" /></label>
      <label>サブタイトル<input value={draft.themeSubtitle} onChange={(e) => up({ themeSubtitle: e.target.value })} placeholder="禍いの足音" /></label>
      <div className="row2">
        <label>パックタイプ
          <select value={draft.packType} onChange={(e) => up({ packType: e.target.value as MasterSet['packType'] })}>
            {PACK_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>公開日<input value={draft.releasedAt} onChange={(e) => up({ releasedAt: e.target.value })} placeholder="2026-07-01" /></label>
      </div>
      <label>コードネーム（制作中の仮名）<input value={draft.codename ?? ''} onChange={(e) => up({ codename: e.target.value })} placeholder="公開前のテーマ名漏れ防止" /></label>
      <label className="status-row">状態
        <select value={draft.status} onChange={(e) => up({ status: e.target.value as MasterSet['status'] })}>
          {CARD_STATUSES.map((s) => <option key={s} value={s}>{s === 'released' ? 'released（公開）' : 'draft（制作中）'}</option>)}
        </select>
      </label>
      {draft.status === 'released' && (
        <p className="warn">⚠ released にすると、この弾のカードが公開ビルドに載ります。公開前チェックが全て緑か確認してください。</p>
      )}
      <button className="a-primary" onClick={() => onSave(draft)}>弾を保存</button>
      <p className="hint-small">保存を押すと、その場で GitHub に記録されます（PCは関係ありません）。</p>
    </section>
  );
}

// ---------- 実装状況パネル ----------
function AuditPanel({ cards, onPick }: { cards: MasterCard[]; onPick: (id: string) => void }) {
  const withText = cards.filter((c) => (c.effectText ?? '').trim() !== '');
  const missing = withText.filter((c) => implState(c) === 'missing');
  const orphan = cards.filter((c) => implState(c) === 'orphan');
  return (
    <section className="panel">
      <h3>効果の実装状況</h3>
      <p className="audit-line">効果ありカード <b>{withText.length}</b> / 全 {cards.length} 枚</p>
      <p className={`audit-line ${missing.length ? 'bad' : 'good'}`}>未実装 <b>{missing.length}</b> 枚</p>
      {missing.length > 0 && (
        <ul className="audit-list">
          {missing.map((c) => <li key={c.id}><button onClick={() => onPick(c.id)}>{c.name}</button></li>)}
        </ul>
      )}
      {orphan.length > 0 && (
        <p className="audit-line warn">実装孤児（効果文が空）{orphan.length} 枚: {orphan.map((c) => c.name).join('、')}</p>
      )}
    </section>
  );
}

// ---------- 公開前チェック ----------
function PreflightPanel({ preflight }: { preflight: Preflight }) {
  return (
    <section className="panel">
      <h3>公開前チェック</h3>
      {preflight.checks.map((c) => (
        <p key={c.label} className={`audit-line ${c.ok ? 'good' : 'bad'}`}>
          {c.ok ? '✓' : '✗'} {c.label}
          {!c.ok && c.detail && <span className="detail"> — {c.detail}</span>}
        </p>
      ))}
      <p className={`preflight-verdict ${preflight.allGreen ? 'good' : 'bad'}`}>
        {preflight.allGreen ? 'この弾は公開できます' : '未解決の項目があります'}
      </p>
    </section>
  );
}

// ---------- 弾の公開 ----------
function PublishPanel({ set, preflight, onPublish, onFlash }: {
  set?: MasterSet;
  preflight: Preflight;
  onPublish: () => Promise<void>;
  onFlash: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!set) {
    return (
      <section className="panel">
        <h3>弾を公開</h3>
        <p className="hint-small">先に「弾の設定」で弾を保存してください。</p>
      </section>
    );
  }

  if (set.status === 'released') {
    return (
      <section className="panel">
        <h3>弾を公開</h3>
        <p className="audit-line good">第{set.vol}弾は公開済みです。</p>
        <p className="hint-small">
          公開済みの弾は、管理画面からは変更できません（カード・画像・弾の設定のすべて）。
          直す必要がある場合はリポジトリを直接編集して push してください。
        </p>
      </section>
    );
  }

  async function publish() {
    if (!confirm(`第${set!.vol}弾を公開します。\nカードと画像が公開リポジトリへ移り、数分後にゲームに出ます。\nよろしいですか？`)) return;
    setBusy(true);
    try {
      await onPublish();
    } catch (e) {
      onFlash(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>弾を公開</h3>
      <p className="hint-small">
        制作中のカードと画像を公開側へ移し、ゲームに出るようにします。公開前チェックが全部緑になると押せます。
      </p>
      <button className="a-primary" disabled={busy || !preflight.allGreen} onClick={publish}>
        {busy ? '公開中…' : `第${set.vol}弾を公開する`}
      </button>
      {!preflight.allGreen && <p className="hint-small">※ 公開前チェックに未解決の項目があります。</p>}
    </section>
  );
}

// ---------- カードエディタ ----------
function CardEditor({ card, isDraft, locked, saving, imageRev, onSave, onCancel, onDelete, onImageSaved }: {
  card: MasterCard;
  isDraft: boolean;
  /** 公開済みの弾のカード。閲覧と画像の書き出しだけできる */
  locked: boolean;
  saving: boolean;
  imageRev?: string;
  onSave: (c: MasterCard, originalId?: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onImageSaved: () => void;
}) {
  const [d, setD] = useState<MasterCard>(card);
  // 編集開始時の id。保存時にこれと変わっていたら古いレコードを消す（key で再マウントされるので固定）
  const originalId = card.id;
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 書き出し済みで、まだ保存していないカード画像（スマホは押し直しで共有シートを開く） */
  const [pngFile, setPngFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = (patch: Partial<MasterCard>) => setD((prev) => ({ ...prev, ...patch }));

  // id は vol-code-rarity から自動生成
  useEffect(() => {
    up({ id: `${d.vol}-${d.code}-${d.rarity}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.vol, d.code, d.rarity]);

  const theo = d.type === 'skill' ? theoreticalBaseValue(d as never) : null;
  const st = implState(d);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const webp = await fileToWebp(file);
      await saveImage(d, webp);
      onImageSaved(); // 一覧とプレビューの画像を新しい版番号で取り直させる
    } catch (err) {
      alert(
        `画像の保存に失敗しました\n\n${err instanceof Error ? err.message : String(err)}\n\n` +
          '下の「動作ログ」に途中経過が残っています。「見る」→「コピー」で送ってください。',
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="card-editor">
      {/* 編集中の内容をそのままカードの見た目で確認できる */}
      <div className="editor-preview">
        <CardFrame card={toRenderCard(d)} width={200} upright />
        <span className={`impl-badge ${st}`}>{IMPL_LABEL[st]}</span>
      </div>

      {locked && (
        <p className="audit-line good">
          この弾は公開済みです。内容の変更はできません（カード画像の書き出しはできます）。
        </p>
      )}

      <div className="img-upload">
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
        <button
          className="a-btn wide"
          disabled={uploading || locked}
          title={locked ? '公開済みの弾の画像は差し替えられません' : ''}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? '変換・保存中…' : '画像を選ぶ / 撮影'}
        </button>
        <button
          className="a-btn wide"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            setPngFile(null);
            try {
              const file = await buildCardPngFile(d);
              if (canShareImage(file)) {
                // スマホ: 画像ができたことを伝え、改めて押してもらう。
                // 共有シートは「ボタンを押した直後」でないと開けないため、ここでは開かない
                setPngFile(file);
              } else {
                downloadFile(file); // PC はそのままダウンロード
              }
            } catch (e) {
              alert(`カード画像の書き出しに失敗しました\n\n${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? '書き出し中…' : 'カード画像を作る（透過PNG）'}
        </button>

        {pngFile && (
          <div className="png-ready">
            <p className="hint-small">
              画像ができました。「写真に保存」を押して、出てきたメニューから
              <b>「画像を保存」</b>を選ぶと写真アプリに入ります。
            </p>
            <button
              className="a-primary"
              onClick={async () => {
                const ok = await shareImageFile(pngFile);
                if (!ok) {
                  downloadFile(pngFile); // 共有シートが開けない端末はファイル保存に逃がす
                  alert('共有メニューを開けなかったので、ファイルとして保存しました。');
                }
                setPngFile(null);
              }}
            >
              写真に保存
            </button>
            <button className="a-btn wide" onClick={() => { downloadFile(pngFile); setPngFile(null); }}>
              ファイルとして保存
            </button>
          </div>
        )}
        {!imageRev && <p className="hint-small">このカードにはまだ画像がありません。</p>}
        <LogPanel compact />
      </div>

      <div className="editor-fields">
        <div className="row3">
          <label>弾<input type="number" inputMode="numeric" value={d.vol} onChange={(e) => up({ vol: +e.target.value })} /></label>
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
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        {d.type === 'character' && (
          <>
            <div className="row2">
              <label>HP<input type="number" inputMode="numeric" value={d.hp ?? 0} onChange={(e) => up({ hp: +e.target.value })} /></label>
              <label>サイズ
                <select value={d.size ?? 'normal'} onChange={(e) => up({ size: e.target.value })}>
                  {CHARACTER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <AttrPicker label="属性" selected={d.attribute ?? []} onChange={(arr) => up({ attribute: arr })} />
          </>
        )}

        {d.type === 'skill' && (
          <>
            <div className="row3">
              <label>コストAP<input type="number" inputMode="numeric" value={d.costAp ?? 0} onChange={(e) => up({ costAp: +e.target.value })} /></label>
              <label>種別
                <select value={d.valueType ?? 'attack'} onChange={(e) => up({ valueType: e.target.value })}>
                  {SKILL_VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>基本値<input type="number" inputMode="numeric" value={d.baseValue ?? 0} onChange={(e) => up({ baseValue: +e.target.value })} /></label>
            </div>
            {theo !== null && (d.effectText ?? '').trim() === '' && (
              <p className={`theo ${d.baseValue === theo ? 'good' : 'bad'}`}>
                効果なしスキルの理論値: <b>{theo}</b>
                {d.baseValue !== theo && <button className="apply-theo" onClick={() => up({ baseValue: theo })}>理論値を適用</button>}
              </p>
            )}
            <AttrPicker label="条件属性" selected={d.conditionAttribute ?? []} onChange={(arr) => up({ conditionAttribute: arr })} />
          </>
        )}

        {d.type === 'equipment' && (
          <AttrPicker label="付与属性" selected={d.addAttribute ?? []} onChange={(arr) => up({ addAttribute: arr })} />
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
      </div>

      <div className="editor-actions">
        <button
          className="a-primary"
          disabled={saving || locked || d.name.trim() === ''}
          title={locked ? '公開済みの弾は変更できません' : d.name.trim() === '' ? '名前を入れてください' : ''}
          onClick={() => onSave(d, originalId)}
        >
          {saving ? '保存中…' : isDraft ? 'この内容で作成' : '保存'}
        </button>
        {isDraft ? (
          <button className="a-danger" onClick={onCancel}>やめる</button>
        ) : (
          <button
            className="a-danger"
            disabled={locked}
            title={locked ? '公開済みの弾は変更できません' : ''}
            onClick={() => { if (confirm(`${d.name} を削除しますか？`)) onDelete(); }}
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 画面内ログの表示。
 * スマホは開発者ツールが使えないので、失敗した時の途中経過をここで読んで貼れるようにする。
 */
function LogPanel({ compact }: { compact?: boolean }) {
  const [lines, setLines] = useState<string[]>(() => getLog());
  const [open, setOpen] = useState(!compact);
  const [copied, setCopied] = useState('');
  useEffect(() => subscribeLog(() => setLines([...getLog()])), []);

  async function copy() {
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('コピーしました');
    } catch {
      setCopied('コピーできませんでした（長押しで選択してください）');
    }
    window.setTimeout(() => setCopied(''), 2600);
  }

  return (
    <section className={compact ? 'log-inline' : 'panel'}>
      <div className="log-head">
        <h3>動作ログ（{lines.length}行）</h3>
        <button className="a-btn" onClick={() => setOpen((v) => !v)}>{open ? '隠す' : '見る'}</button>
      </div>
      {open && (
        <>
          <pre className="log-body">{lines.length ? lines.join('\n') : 'まだ記録がありません。'}</pre>
          <div className="log-actions">
            <button className="a-btn" onClick={copy} disabled={!lines.length}>コピー</button>
            <button className="a-btn" onClick={() => { clearLog(); setLines([]); }} disabled={!lines.length}>消す</button>
          </div>
          {copied && <p className="hint-small">{copied}</p>}
          <p className="hint-small">画像アップロードなどが失敗した時は、ここをコピーして送ってください。</p>
        </>
      )}
    </section>
  );
}

function AttrPicker({ label, selected, onChange }: { label: string; selected: string[]; onChange: (next: string[]) => void }) {
  // 同じ属性を複数つけられる（例: トランザードの闇×5、突×2 のスキル）。
  // 下の属性ボタンで1つ追加、上の選択中チップの × で1つ削除。
  return (
    <div className="attr-picker">
      <span className="attr-label">{label}（同じ属性を何個でも付けられます）</span>
      <div className="attr-current">
        {selected.length === 0 ? (
          <span className="attr-none">なし</span>
        ) : (
          selected.map((a, i) => (
            <button
              key={i}
              className="attr-chip on"
              title="押すと1つ外す"
              onClick={() => onChange(selected.filter((_, j) => j !== i))}
            >
              {a} ×
            </button>
          ))
        )}
      </div>
      <div className="attr-add">
        {ATTRIBUTES.map((a) => (
          <button key={a} className="attr-chip add" title="押すと1つ足す" onClick={() => onChange([...selected, a])}>
            ＋{a}
          </button>
        ))}
      </div>
    </div>
  );
}
