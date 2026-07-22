import { deckProblems, sampleArchetypeDecks, type DeckList } from '@bravers/engine';
import { useMemo, useState } from 'react';
import type { BattleSetup } from '../App';

/** 敵に使うスタンダード4デッキ（要件: バランス中位の4種） */
const ENEMY_DECK_NAMES = ['斬の勇者', '闇単アグロ', '氷結コントロール', '聖光の癒し'];

export function DeckSelect({ onStart, onBack }: {
  onStart: (setup: BattleSetup) => void;
  onBack: () => void;
}) {
  const all = useMemo(() => sampleArchetypeDecks(), []);
  const enemies = all.filter((d) => ENEMY_DECK_NAMES.includes(d.name));

  const [mineIdx, setMineIdx] = useState(0);
  const [enemyIdx, setEnemyIdx] = useState<number | 'random'>('random');
  const [imported, setImported] = useState<{ name: string; deck: DeckList } | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const useImported = imported !== null && mineIdx === -1;

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
      setMineIdx(-1);
      setImportError('');
    } catch {
      setImportError('JSONが読み取れませんでした');
    }
  }

  function start() {
    const enemy = enemyIdx === 'random' ? enemies[Math.floor(Math.random() * enemies.length)] : enemies[enemyIdx];
    const playerDeck = useImported ? imported!.deck : all[mineIdx].deck;
    const playerDeckName = useImported ? imported!.name : all[mineIdx].name;
    onStart({ playerDeck, playerDeckName, enemy });
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <button className="chip" onClick={onBack}>← ホーム</button>
        <h2>バトル準備</h2>
      </header>

      <section>
        <h3>自分のデッキ</h3>
        <div className="deck-list">
          {all.map((d, i) => (
            <button
              key={d.name}
              className={mineIdx === i ? 'deck-item on' : 'deck-item'}
              onClick={() => setMineIdx(i)}
            >
              <b>{d.name}</b>
              <span>{d.concept}</span>
            </button>
          ))}
          {imported && (
            <button
              className={useImported ? 'deck-item on' : 'deck-item'}
              onClick={() => setMineIdx(-1)}
            >
              <b>{imported.name}</b>
              <span>JSONから読み込んだデッキ</span>
            </button>
          )}
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
            className={enemyIdx === 'random' ? 'deck-item on' : 'deck-item'}
            onClick={() => setEnemyIdx('random')}
          >
            <b>ランダム</b>
            <span>4つのスタンダードデッキからおまかせ</span>
          </button>
          {enemies.map((d, i) => (
            <button
              key={d.name}
              className={enemyIdx === i ? 'deck-item on' : 'deck-item'}
              onClick={() => setEnemyIdx(i)}
            >
              <b>{d.name}</b>
              <span>{d.concept}</span>
            </button>
          ))}
        </div>
      </section>

      <button className="big-btn" onClick={start}>バトル開始</button>
    </div>
  );
}
