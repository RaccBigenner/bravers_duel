import { cardById } from '@bravers/engine';
import { useState } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import { RulesModal } from './RulesModal';

export function Home({ onBattle, onGallery }: { onBattle: () => void; onGallery: () => void }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <div className="home-cards">
            <div className="home-card l">
              <CardFrame card={cardById('1-A003-USR')} width={82} upright />
            </div>
            <div className="home-card c">
              <img src={IMG('back')} alt="" />
            </div>
            <div className="home-card r">
              <CardFrame card={cardById('1-A004-USR')} width={82} upright />
            </div>
          </div>
          <h1 className="home-title-logo">
            <img src={IMG('logo')} alt="BRAVER'S DUEL" />
          </h1>
          <p className="home-tagline">回転式パーティキャラクターカードバトル</p>
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
