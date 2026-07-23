import { useState } from 'react';
import { IMG } from '../cardAssets';
import { RulesModal } from './RulesModal';

export function Home({ onBattle, onGallery }: { onBattle: () => void; onGallery: () => void }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <div className="home-cards">
            <img className="home-card l" src={IMG('1-A003-USR')} alt="[閃光の勇者]クラウディア" />
            <img className="home-card c" src={IMG('back')} alt="" />
            <img className="home-card r" src={IMG('1-A004-USR')} alt="[朽ち往く魔王]トランザード" />
          </div>
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
        <p className="home-note">
          オープンβテスト — ゲームデータは保存されません。デッキはJSONで書き出せます。
          品質向上のため、匿名のプレイ統計とレビューを送信します（個人情報は含みません）。
        </p>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
