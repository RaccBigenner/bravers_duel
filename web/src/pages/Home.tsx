export function Home({ onBattle, onGallery }: { onBattle: () => void; onGallery: () => void }) {
  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-title afs">BRAVER'S DUEL</h1>
        <p className="home-sub">オープンβテスト</p>
        <button className="big-btn" onClick={onBattle}>バトル（CPU対戦）</button>
        <button className="big-btn secondary" onClick={onGallery}>カード一覧</button>
        <p className="home-note">
          デッキを選んでCPUと対戦できます。デッキ構築はバトル準備画面から。
        </p>
      </div>
    </div>
  );
}
