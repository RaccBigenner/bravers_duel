import type { DeckList, NamedDeck } from '@bravers/engine';
import { useState } from 'react';
import { Battle } from './pages/Battle';
import { DeckSelect } from './pages/DeckSelect';
import { Gallery } from './pages/Gallery';
import { Home } from './pages/Home';

export interface BattleSetup {
  playerDeck: DeckList;
  playerDeckName: string;
  enemy: NamedDeck;
}

type View =
  | { name: 'home' }
  | { name: 'gallery' }
  | { name: 'deckSelect' }
  | { name: 'battle'; setup: BattleSetup };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });

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
          onStart={(setup) => setView({ name: 'battle', setup })}
          onBack={() => setView({ name: 'home' })}
        />
      );
    case 'battle':
      return (
        <Battle
          setup={view.setup}
          onExit={() => setView({ name: 'home' })}
          onRematch={() => setView({ name: 'battle', setup: view.setup })}
        />
      );
  }
}
