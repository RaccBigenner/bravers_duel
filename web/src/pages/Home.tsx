import { useState } from 'react';
import { IMG } from '../cardAssets';
import { RulesModal } from './RulesModal';

export function Home({ onBattle, onGallery }: { onBattle: () => void; onGallery: () => void }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <img className="home-emblem" src={IMG('icon_sword')} alt="" />
          <h1 className="home-title afs">BRAVER'S DUEL</h1>
          <p className="home-tagline">3人のブレイバーで挑む、回転式カードバトル</p>
        </div>
        <div className="home-menu">
          <button className="big-btn primary" onClick={onBattle}>
            バトル
            <span className="btn-note">CPUと対戦</span>
          </button>
          <button className="big-btn secondary" onClick={() => setShowRules(true)}>
            あそびかた
          </button>
          <button className="big-btn secondary" onClick={onGallery}>
            カード一覧
          </button>
        </div>
        <p className="home-note">オープンβテスト — データは保存されません。デッキはJSONで書き出せます。</p>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
