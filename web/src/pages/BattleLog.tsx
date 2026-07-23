/**
 * シェアされたバトルログのプレビューページ。
 * URLの #log=… から復元した要約を表示する（Xのシェアリンクの飛び先）。
 */
import { cardById, type Card } from '@bravers/engine';
import { useState } from 'react';
import { CardFrame } from '../CardFrame';
import type { SharedLog } from '../shareLog';

const REASON_LABEL: Record<string, string> = {
  wipeout: '全滅',
  deckout: '山札切れ',
  turnLimit: '時間切れ',
};

function safeCard(id: string): Card | null {
  try {
    return cardById(id);
  } catch {
    return null;
  }
}

function CardGrid({ ids, used, onZoom }: { ids?: string[]; used?: [string, number][]; onZoom: (id: string) => void }) {
  const items: [string, number | null][] = used
    ? used.map(([id, n]) => [id, n])
    : (ids ?? []).map((id) => [id, null]);
  const known = items.filter(([id]) => safeCard(id) !== null);
  if (known.length === 0) return <p className="log-empty">（記録なし）</p>;
  return (
    <div className="deck-view-grid">
      {known.map(([id, n], i) => (
        <div key={`${id}${i}`} className="deck-view-card" onClick={() => onZoom(id)}>
          <CardFrame card={safeCard(id)!} width={74} upright />
          {n !== null && n > 1 && <span className="deck-view-count">×{n}</span>}
        </div>
      ))}
    </div>
  );
}

export function BattleLogPage({ log, onHome }: { log: SharedLog; onHome: () => void }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const reason = REASON_LABEL[log.r] ?? log.r;
  const resultText =
    log.w === 'd' ? '引き分け' : log.w === 'p' ? `「${log.pd}」の勝利！` : `「${log.ed}」の勝利！`;

  return (
    <div className="page narrow battle-log-page">
      <header className="log-header">
        <p className="log-tag">#ブレデュエ バトルログ</p>
        <h1 className="log-vs">
          <span className="log-deck">{log.pd}</span>
          <span className="log-vs-mark">VS</span>
          <span className="log-deck">{log.ed}</span>
        </h1>
        <p className="log-result">{resultText}</p>
        <div className="result-stats">
          <span className="stat"><b>{reason}</b><em>決着</em></span>
          <span className="stat"><b>{log.t}</b><em>ターン</em></span>
        </div>
      </header>

      <section className="log-side">
        <h2 className="deck-view-label">「{log.pd}」のチーム</h2>
        <CardGrid ids={log.pc} onZoom={setZoom} />
        <h2 className="deck-view-label">使ったカード</h2>
        <CardGrid used={log.pu} onZoom={setZoom} />
      </section>

      <section className="log-side">
        <h2 className="deck-view-label">「{log.ed}」のチーム</h2>
        <CardGrid ids={log.ec} onZoom={setZoom} />
        <h2 className="deck-view-label">使ったカード</h2>
        <CardGrid used={log.eu} onZoom={setZoom} />
      </section>

      <div className="log-cta">
        <button className="big-btn" onClick={onHome}>自分もあそんでみる</button>
      </div>

      {zoom && (
        <div className="overlay preview" onClick={() => setZoom(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={safeCard(zoom)!} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            <button className="chip" onClick={() => setZoom(null)}>とじる</button>
          </div>
        </div>
      )}
    </div>
  );
}
