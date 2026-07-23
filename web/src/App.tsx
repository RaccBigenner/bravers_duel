import type { DeckList, NamedDeck } from '@bravers/engine';
import { useEffect, useState } from 'react';
import { logEvent } from './telemetry';
import { decodeSharedLog, type SharedLog } from './shareLog';
import { Battle } from './pages/Battle';
import { BattleLogPage } from './pages/BattleLog';
import { DeckBuilder, type CustomDeck } from './pages/DeckBuilder';
import { DeckSelect } from './pages/DeckSelect';
import { Gallery } from './pages/Gallery';
import { Home } from './pages/Home';

export interface BattleSetup {
  playerDeck: DeckList;
  playerDeckName: string;
  /** ログ用: プリセット / 自作 / JSON読み込み */
  playerDeckKind: 'preset' | 'custom' | 'imported';
  enemy: NamedDeck;
  /** ログ用: 敵をランダムで選んだか */
  enemyRandom: boolean;
}

type View =
  | { name: 'home' }
  | { name: 'gallery' }
  | { name: 'deckSelect' }
  | { name: 'builder' }
  | { name: 'battle'; setup: BattleSetup; nonce: number }
  | { name: 'sharedLog'; log: SharedLog };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [customDeck, setCustomDeck] = useState<CustomDeck | null>(null);

  // 公開βのログ: 全ページのアクセスを記録（どこから来たかも）
  useEffect(() => {
    logEvent('page_view', {
      page: view.name,
      ...(view.name === 'sharedLog' ? { sharedLog: `${view.log.pd} vs ${view.log.ed}` } : {}),
      ...(document.referrer ? { referrer: document.referrer } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.name]);

  // シェアされたバトルログURL（#log=…）で開かれたらプレビューを表示
  // （開いた時 + 開いたままURLを貼られた時の両方）
  useEffect(() => {
    const check = () => {
      const token = location.hash.startsWith('#log=') ? location.hash.slice(5) : null;
      if (!token) return;
      void decodeSharedLog(token).then((log) => {
        if (log) setView({ name: 'sharedLog', log });
      });
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  switch (view.name) {
    case 'home':
      return (
        <Home
          onBattle={() => setView({ name: 'deckSelect' })}
          onGallery={() => setView({ name: 'gallery' })}
        />
      );
    case 'gallery':
      return <Gallery onBack={() => setView({ name: 'home' })} />;
    case 'deckSelect':
      return (
        <DeckSelect
          onStart={(setup) => setView({ name: 'battle', setup, nonce: 1 })}
          onBack={() => setView({ name: 'home' })}
          custom={customDeck}
          onBuild={() => setView({ name: 'builder' })}
        />
      );
    case 'builder':
      return (
        <DeckBuilder
          initial={customDeck}
          onUse={(deck) => {
            setCustomDeck(deck);
            logEvent('custom_deck', {
              deckName: deck.name,
              characterIds: deck.deck.characterIds,
              cardIds: deck.deck.cardIds,
            });
            setView({ name: 'deckSelect' });
          }}
          onBack={() => setView({ name: 'deckSelect' })}
        />
      );
    case 'sharedLog':
      return (
        <BattleLogPage
          log={view.log}
          onHome={() => {
            // ログURLのハッシュを消してからホームへ（リロードでログに戻らないように）
            history.replaceState(null, '', location.pathname + location.search);
            setView({ name: 'home' });
          }}
        />
      );
    case 'battle':
      return (
        <Battle
          // key を変えて完全に作り直す（同じ setup の「もう一回」でも新しいバトルになる）
          key={view.nonce}
          setup={view.setup}
          onExit={() => setView({ name: 'home' })}
          onRematch={() => setView({ name: 'battle', setup: view.setup, nonce: view.nonce + 1 })}
        />
      );
  }
}
