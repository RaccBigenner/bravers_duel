import {
  cardById,
  deckProblems,
  sampleArchetypeDecks,
  type CharacterCard,
  type DeckList,
} from '@bravers/engine';
import { useMemo, useState } from 'react';
import type { BattleSetup } from '../App';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import type { CustomDeck } from './DeckBuilder';

/** 敵に使うスタンダード4デッキ（要件: バランス中位の4種） */
const ENEMY_DECK_NAMES = ['剣聖の一閃', '魔王の柩', '氷獄の女王', '聖歌隊'];

/** メインキャラベースのデッキタイル */
function DeckTile({ name, concept, deck, selected, onClick, onView, extra }: {
  name: string;
  concept: string;
  deck: DeckList;
  selected: boolean;
  onClick: () => void;
  onView?: () => void;
  extra?: React.ReactNode;
}) {
  const main = deck.characterIds[0] ? (cardById(deck.characterIds[0]) as CharacterCard) : null;
  return (
    <button className={`deck-tile ${selected ? 'on' : ''}`} onClick={onClick}>
      {main && (
        <div className="deck-tile-art" style={{ backgroundImage: `url(${IMG(main.id)})` }} />
      )}
      <div className="deck-tile-info">
        <b>{name}</b>
        <span className="deck-tile-concept">{concept}</span>
        <div className="deck-tile-chars">
          {deck.characterIds.map((id) => {
            const c = cardById(id) as CharacterCard;
            return (
              <span key={id} className="deck-tile-char" title={c.name}>
                <img src={IMG(id)} alt={c.name} />
              </span>
            );
          })}
          <span className="deck-tile-main">{main?.name.replace(/^\[[^\]]*\]/, '')}</span>
        </div>
      </div>
      {onView && (
        <span
          className="chip small deck-view"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          中身
        </span>
      )}
      {extra}
    </button>
  );
}

export function DeckSelect({ onStart, onBack, custom, onBuild }: {
  onStart: (setup: BattleSetup) => void;
  onBack: () => void;
  custom: CustomDeck | null;
  onBuild: () => void;
}) {
  const all = useMemo(() => sampleArchetypeDecks(), []);
  const enemies = all.filter((d) => ENEMY_DECK_NAMES.includes(d.name));

  const [mineIdx, setMineIdx] = useState<number | 'custom'>(custom ? 'custom' : 0);
  const [enemyIdx, setEnemyIdx] = useState<number | 'random'>('random');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [imported, setImported] = useState<CustomDeck | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewDeck, setViewDeck] = useState<{ name: string; deck: DeckList } | null>(null);
  const [zoomCard, setZoomCard] = useState<string | null>(null);

  const customEntry = imported ?? custom;

  function tryImport(text: string) {
    try {
      const json = JSON.parse(text);
      const deck: DeckList = { characterIds: json.characterIds ?? [], cardIds: json.cardIds ?? [] };
      const problems = deckProblems(deck);
      if (problems.length > 0) {
        setImportError(`デッキがルールに合いません: ${problems.join(' / ')}`);
        return;
      }
      setImported({ name: json.name || '読み込んだデッキ', deck });
      setMineIdx('custom');
      setImportError('');
    } catch {
      setImportError('JSONが読み取れませんでした');
    }
  }

  function start() {
    const enemy = enemyIdx === 'random' ? enemies[Math.floor(Math.random() * enemies.length)] : enemies[enemyIdx];
    const playerDeck = mineIdx === 'custom' && customEntry ? customEntry.deck : all[mineIdx === 'custom' ? 0 : mineIdx].deck;
    const playerDeckName = mineIdx === 'custom' && customEntry ? customEntry.name : all[mineIdx === 'custom' ? 0 : mineIdx].name;
    onStart({ playerDeck, playerDeckName, enemy });
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <button className="chip" onClick={onBack}>← ホーム</button>
        <h2>バトル準備</h2>
      </header>

      <section>
        <div className="section-head">
          <h3>自分のデッキ</h3>
          <button className="chip" onClick={onBuild}>デッキを作る</button>
        </div>
        <div className="deck-list">
          {customEntry && (
            <>
              <DeckTile
                name={customEntry.name}
                concept="自分で組んだカスタムデッキ"
                deck={customEntry.deck}
                selected={mineIdx === 'custom'}
                onClick={() => setMineIdx('custom')}
                onView={() => setViewDeck(customEntry)}
              />
              {/* 確定済みデッキもいつでも書き出し・編集できる */}
              <div className="custom-deck-actions">
                <button
                  className="chip"
                  onClick={async () => {
                    const json = JSON.stringify(
                      { name: customEntry.name, characterIds: customEntry.deck.characterIds, cardIds: customEntry.deck.cardIds },
                      null,
                      1,
                    );
                    try {
                      await navigator.clipboard.writeText(json);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    } catch {
                      /* クリップボード不可の環境 */
                    }
                  }}
                >
                  {copied ? 'コピーした！' : 'JSONコピー'}
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    const json = JSON.stringify(
                      { name: customEntry.name, characterIds: customEntry.deck.characterIds, cardIds: customEntry.deck.cardIds },
                      null,
                      1,
                    );
                    const blob = new Blob([json], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${customEntry.name || 'deck'}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  ファイル保存
                </button>
                <button className="chip" onClick={onBuild}>編集</button>
              </div>
            </>
          )}
          {all.map((d, i) => (
            <DeckTile
              key={d.name}
              name={d.name}
              concept={d.concept}
              deck={d.deck}
              selected={mineIdx === i}
              onClick={() => setMineIdx(i)}
              onView={() => setViewDeck(d)}
            />
          ))}
        </div>
        <details className="import-box">
          <summary>デッキJSONを読み込む</summary>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{"name":"マイデッキ","characterIds":[...],"cardIds":[...]}'
            rows={4}
          />
          <button className="chip" onClick={() => tryImport(importText)}>読み込む</button>
          {importError && <p className="error">{importError}</p>}
        </details>
      </section>

      <section>
        <h3>相手のデッキ</h3>
        <div className="deck-list">
          <button
            className={`deck-tile random ${enemyIdx === 'random' ? 'on' : ''}`}
            onClick={() => setEnemyIdx('random')}
          >
            <div className="deck-tile-art random-art">？</div>
            <div className="deck-tile-info">
              <b>ランダム</b>
              <span className="deck-tile-concept">4つのスタンダードデッキからおまかせ</span>
            </div>
          </button>
          {enemies.map((d) => {
            const i = enemies.indexOf(d);
            return (
              <DeckTile
                key={d.name}
                name={d.name}
                concept={d.concept}
                deck={d.deck}
                selected={enemyIdx === i}
                onClick={() => setEnemyIdx(i)}
                onView={() => setViewDeck(d)}
              />
            );
          })}
        </div>
      </section>

      <button className="big-btn start-btn" onClick={start}>バトル開始</button>

      {/* デッキの中身閲覧 */}
      {viewDeck && (
        <div className="overlay" onClick={() => setViewDeck(null)}>
          <div className="dialog deck-view-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{viewDeck.name}</h3>
            <div className="deck-view-scroll">
              <p className="deck-view-label">キャラクター</p>
              <div className="deck-view-grid">
                {viewDeck.deck.characterIds.map((id, i) => (
                  <div key={`c${i}`} className="deck-view-card" onClick={() => setZoomCard(id)}>
                    <CardFrame card={cardById(id)} width={74} upright />
                  </div>
                ))}
              </div>
              <p className="deck-view-label">デッキ（{viewDeck.deck.cardIds.length}枚）</p>
              <div className="deck-view-grid">
                {[...new Map(viewDeck.deck.cardIds.map((id) => [id, viewDeck.deck.cardIds.filter((x) => x === id).length])).entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([id, n]) => (
                    <div key={id} className="deck-view-card" onClick={() => setZoomCard(id)}>
                      <CardFrame card={cardById(id)} width={74} upright />
                      <span className="deck-view-count">×{n}</span>
                    </div>
                  ))}
              </div>
            </div>
            <button className="chip" onClick={() => setViewDeck(null)}>とじる</button>
          </div>
        </div>
      )}

      {/* カード拡大 */}
      {zoomCard && (
        <div className="overlay preview" onClick={() => setZoomCard(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={cardById(zoomCard)} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            <button className="chip" onClick={() => setZoomCard(null)}>とじる</button>
          </div>
        </div>
      )}
    </div>
  );
}
