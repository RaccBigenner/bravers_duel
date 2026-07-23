import { useState } from 'react';
import { RulesModal } from './RulesModal';

export function Home({ onBattle, onGallery }: { onBattle: () => void; onGallery: () => void }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <span className="home-emblem">⚔</span>
          <h1 className="home-title afs">BRAVER'S DUEL</h1>
          <p className="home-tagline">3人のブレイバーで挑む、回転式カードバトル</p>
        </div>
        <div className="home-menu">
          <button className="big-btn primary" onClick={onBattle}>
            <span className="btn-icon">⚔️</span>バトル
            <span className="btn-note">CPUと対戦</span>
          </button>
          <button className="big-btn secondary" onClick={() => setShowRules(true)}>
            <span className="btn-icon">📖</span>あそびかた
          </button>
          <button className="big-btn secondary" onClick={onGallery}>
            <span className="btn-icon">🃏</span>カード一覧
          </button>
        </div>
        <p className="home-note">オープンβテスト — データは保存されません。デッキはJSONで書き出せます。</p>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
