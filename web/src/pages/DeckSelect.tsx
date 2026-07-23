import {
  cardById,
  deckProblems,
  sampleArchetypeDecks,
  type CharacterCard,
  type DeckList,
} from '@bravers/engine';
import { useMemo, useState } from 'react';
import type { BattleSetup } from '../App';
import { IMG } from '../cardAssets';
import type { CustomDeck } from './DeckBuilder';

/** 敵に使うスタンダード4デッキ（要件: バランス中位の4種） */
const ENEMY_DECK_NAMES = ['斬の勇者', '闇単アグロ', '氷結コントロール', '聖光の癒し'];

/** メインキャラベースのデッキタイル */
function DeckTile({ name, concept, deck, selected, onClick, extra }: {
  name: string;
  concept: string;
  deck: DeckList;
  selected: boolean;
  onClick: () => void;
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
              />
            );
          })}
        </div>
      </section>

      <button className="big-btn start-btn" onClick={start}>バトル開始</button>
    </div>
  );
}
