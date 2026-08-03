import { cardByPrintingId } from '@bravers/engine';
import { useState, type ReactNode } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import { RulesModal } from './RulesModal';

export function Home({
  onBattle,
  onGallery,
  recovery,
}: {
  onBattle: () => void;
  onGallery: () => void;
  recovery?: ReactNode;
}) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <div className="home-cards">
            <div className="home-card l">
              <CardFrame card={cardByPrintingId('1-A003-USR')} width={82} upright />
            </div>
            <div className="home-card c">
              <img src={IMG('back')} alt="" />
            </div>
            <div className="home-card r">
              <CardFrame card={cardByPrintingId('1-A004-USR')} width={82} upright />
            </div>
          </div>
          <h1 className="home-title-logo">
            <img src={IMG('logo')} alt="BRAVER'S DUEL" />
          </h1>
          <p className="home-tagline">回転式パーティキャラクターカードバトル</p>
        </div>
        {recovery}
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
          プロトタイプ版 — まずはCPU対戦をお試しください。
          対戦結果とデッキはこのブラウザに保存されませんが、デッキはJSONで書き出せます。
        </p>
        <p className="home-retention-notice" role="note">
          <strong>アカウントについて</strong>
          <span>365日間利用がなく、購入・所持カードなどの保護対象がないゲストアカウントは、データ整理の対象になることがあります。</span>
          <span>スターターを受け取る前にLINEまたはGoogleを連携すると、アカウントを保護できます。</span>
        </p>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
