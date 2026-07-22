import {
  cardById,
  isCharAlive,
  maxHpOf,
  skillEffectOf,
  type BattleAction,
  type BattleState,
  type Card,
} from '@bravers/engine';
import { useMemo, useState } from 'react';
import type { BattleSetup } from '../App';
import { CardFrame } from '../CardFrame';
import { IMG, IMG_PNG } from '../cardAssets';
import { useBattle, type DamagePop, type Reveal } from '../battle/useBattle';
import '../battle.css';

const PLAYER = 0 as const;
const ENEMY = 1 as const;

type Targeting =
  | null
  | { kind: 'enemy'; handIndex: number } // 対象を選んで攻撃
  | { kind: 'allyHeal'; handIndex: number } // 回復対象
  | { kind: 'allyEquip'; handIndex: number }; // 装備対象

export function Battle({ setup, onExit, onRematch }: {
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const { state, pops, reveal, perform, myActions, isMyTurn } = useBattle(setup.playerDeck, setup.enemy.deck);
  const [selectedHand, setSelectedHand] = useState<number | null>(null);
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const me = state.players[PLAYER];
  const foe = state.players[ENEMY];
  const finished = state.phase === 'finished';
  const guardPhase = state.phase === 'guard' && isMyTurn; // 自分が割り込む側

  // 手札ごとの「できること」
  const handPlayable = useMemo(() => {
    const map = new Map<number, BattleAction[]>();
    for (const a of myActions) {
      if ('handIndex' in a) {
        const list = map.get(a.handIndex) ?? [];
        list.push(a);
        map.set(a.handIndex, list);
      }
    }
    return map;
  }, [myActions]);

  function act(action: BattleAction) {
    setSelectedHand(null);
    setTargeting(null);
    try {
      perform(action);
    } catch (e) {
      console.warn(e);
    }
  }

  /** 手札カードの「使う」ボタン */
  function playSelected() {
    if (selectedHand === null) return;
    const id = me.hand[selectedHand];
    const card = cardById(id);
    if (card.type === 'skill') {
      const eff = skillEffectOf(card.id);
      if (card.valueType === 'heal') {
        setTargeting({ kind: 'allyHeal', handIndex: selectedHand });
        return;
      }
      if (card.valueType === 'attack' && eff?.targeting === 'choose') {
        setTargeting({ kind: 'enemy', handIndex: selectedHand });
        return;
      }
      act({ type: 'playSkill', handIndex: selectedHand });
    } else if (card.type === 'character') {
      act({ type: 'playCharacter', handIndex: selectedHand });
    } else if (card.type === 'equipment') {
      setTargeting({ kind: 'allyEquip', handIndex: selectedHand });
    } else if (card.type === 'field') {
      act({ type: 'playField', handIndex: selectedHand });
    }
  }

  function tapChar(side: 0 | 1, index: number) {
    if (!targeting) return;
    if (targeting.kind === 'enemy' && side === ENEMY && isCharAlive(state, ENEMY, index)) {
      act({ type: 'playSkill', handIndex: targeting.handIndex, targetIndex: index });
    }
    if (targeting.kind === 'allyHeal' && side === PLAYER && isCharAlive(state, PLAYER, index)) {
      act({ type: 'playSkill', handIndex: targeting.handIndex, healTargetIndex: index });
    }
    if (targeting.kind === 'allyEquip' && side === PLAYER && isCharAlive(state, PLAYER, index)) {
      act({ type: 'playEquipment', handIndex: targeting.handIndex, targetIndex: index });
    }
  }

  function tapHand(i: number) {
    if (finished || !isMyTurn) return;
    if (state.phase === 'charge') {
      act({ type: 'charge', handIndex: i });
      return;
    }
    setTargeting(null);
    setSelectedHand(selectedHand === i ? null : i);
  }

  const fieldCard = state.field ? cardById(state.field.cardId) : null;
  const lastLogs = state.log.slice(-2);

  return (
    <div className="battle-root">
      {/* 相手情報バー */}
      <div className="info-bar">
        <span className="deck-name">{setup.enemy.name}</span>
        <span className="turn-label">ターン{state.turn}・{isMyTurn ? 'あなた' : '相手'}</span>
        <button className="chip small" onClick={() => setConfirmExit(true)}>投了</button>
      </div>

      {/* 相手の手札（裏向きの扇） */}
      <div className="enemy-hand">
        {foe.hand.map((_, i) => (
          <img key={i} src={IMG('back')} className="hand-back" style={{ marginLeft: i === 0 ? 0 : -26 }} />
        ))}
      </div>

      {/* 相手の資源ゾーン */}
      <ZoneRow side={ENEMY} p={foe} />

      {/* 相手キャラクター */}
      <CharRow side={ENEMY} state={state} pops={pops} targeting={targeting} onTap={tapChar} />

      {/* 中央: フィールド + ログ */}
      <div className="center-strip">
        <div className="field-slot">
          {fieldCard ? (
            <CardFrame card={fieldCard} width={56} />
          ) : (
            <div className="field-empty">FIELD</div>
          )}
        </div>
        <div className="log-box">
          {lastLogs.map((l, i) => <div key={i} className="log-line">{l}</div>)}
        </div>
      </div>

      {/* 自分キャラクター */}
      <CharRow side={PLAYER} state={state} pops={pops} targeting={targeting} onTap={tapChar} />

      {/* 自分の資源ゾーン */}
      <ZoneRow side={PLAYER} p={me} />

      {/* 自分の手札 */}
      <div className="my-hand">
        {me.hand.map((id, i) => {
          const card = cardById(id);
          const playable = isMyTurn && state.phase === 'play' && handPlayable.has(i);
          const chargeable = isMyTurn && state.phase === 'charge';
          return (
            <div
              key={`${id}-${i}`}
              className={[
                'hand-card',
                selectedHand === i ? 'raised' : '',
                playable || chargeable ? 'playable' : '',
              ].join(' ')}
              style={{ marginLeft: i === 0 ? 0 : -34, zIndex: selectedHand === i ? 50 : i }}
              onClick={() => tapHand(i)}
            >
              <CardFrame card={card} width={92} />
            </div>
          );
        })}
      </div>

      {/* アクションバー */}
      <div className="action-bar">
        {targeting ? (
          <>
            <span className="hint">
              {targeting.kind === 'enemy' ? '攻撃する相手を選んでください' : '対象の味方を選んでください'}
            </span>
            <button className="chip" onClick={() => setTargeting(null)}>やめる</button>
          </>
        ) : guardPhase ? (
          <span className="hint danger">相手の攻撃！ ガードで割り込めます</span>
        ) : !isMyTurn || finished ? (
          <span className="hint">{finished ? 'バトル終了' : '相手のターン…'}</span>
        ) : state.phase === 'play' ? (
          <>
            {selectedHand !== null && handPlayable.has(selectedHand) && (
              <button className="big-btn slim" onClick={playSelected}>このカードを使う</button>
            )}
            <button className="chip" onClick={() => act({ type: 'endPlay' })}>チャージへ →</button>
          </>
        ) : (
          <>
            <span className="hint">手札をタップでAPチャージ</span>
            <button className="big-btn slim" onClick={() => act({ type: 'endTurn' })}>ターンエンド</button>
          </>
        )}
      </div>

      {/* ガード割り込みシート */}
      {guardPhase && state.pendingAttack && (
        <div className="guard-sheet">
          <p className="guard-title">
            「{state.pendingAttack.skillName}」 が来る！（ダメージ {state.pendingAttack.value}）
          </p>
          <div className="guard-options">
            {myActions.filter((a) => a.type === 'playGuard').map((a) => {
              const hi = (a as { handIndex: number }).handIndex;
              return (
                <div key={hi} className="hand-card playable" onClick={() => act(a)}>
                  <CardFrame card={cardById(me.hand[hi])} width={92} />
                </div>
              );
            })}
          </div>
          <button className="big-btn slim" onClick={() => act({ type: 'pass' })}>そのまま受ける</button>
        </div>
      )}

      {/* カード公開演出 */}
      {reveal && <RevealOverlay reveal={reveal} />}

      {/* 投了確認 */}
      {confirmExit && (
        <div className="overlay">
          <div className="dialog">
            <p>バトルをやめてホームに戻りますか？</p>
            <div className="dialog-btns">
              <button className="chip" onClick={() => setConfirmExit(false)}>続ける</button>
              <button className="big-btn slim" onClick={onExit}>投了する</button>
            </div>
          </div>
        </div>
      )}

      {/* リザルト */}
      {finished && <ResultOverlay state={state} setup={setup} onExit={onExit} onRematch={onRematch} />}
    </div>
  );
}

// ---------------------------------------------------------------- 部品

/** 資源ゾーン（山札・トラッシュ・AP） */
function ZoneRow({ side, p }: { side: 0 | 1; p: BattleState['players'][number] }) {
  return (
    <div className={`zone-row ${side === ENEMY ? 'enemy' : ''}`}>
      <div className="pile">
        <img src={IMG('back')} className="pile-card" />
        <span className="pile-count">{p.deck.length}</span>
        <span className="pile-label">山札</span>
      </div>
      <div className="pile ap">
        <img src={IMG('back')} className="pile-card sideways" />
        <span className="pile-count gold">{p.ap.length}</span>
        <span className="pile-label">AP</span>
      </div>
      <div className="pile trash">
        {p.trash.length > 0 ? (
          <div className="pile-card trash-top" style={{ backgroundImage: `url(${IMG(p.trash[p.trash.length - 1])})` }} />
        ) : (
          <div className="pile-card empty" />
        )}
        <span className="pile-count">{p.trash.length}</span>
        <span className="pile-label">トラッシュ</span>
      </div>
    </div>
  );
}

/** キャラクターの列 */
function CharRow({ side, state, pops, targeting, onTap }: {
  side: 0 | 1;
  state: BattleState;
  pops: DamagePop[];
  targeting: Targeting;
  onTap: (side: 0 | 1, index: number) => void;
}) {
  const p = state.players[side];
  const selectable =
    (targeting?.kind === 'enemy' && side === ENEMY) ||
    ((targeting?.kind === 'allyHeal' || targeting?.kind === 'allyEquip') && side === PLAYER);

  return (
    <div className={`char-row ${side === ENEMY ? 'enemy' : ''}`}>
      {p.characters.map((c, i) => {
        const alive = isCharAlive(state, side, i);
        const isActor = p.actorIndex === i && alive;
        const hp = Math.max(0, maxHpOf(state, side, i) - c.damage);
        const myPops = pops.filter((d) => d.side === side && d.charIndex === i);
        return (
          <div
            key={c.cardId + i}
            className={[
              'char-slot',
              isActor ? 'actor' : '',
              !alive ? 'ko' : '',
              selectable && alive ? 'selectable' : '',
            ].join(' ')}
            onClick={() => onTap(side, i)}
          >
            <CardFrame card={cardById(c.cardId)} width={92} />
            {!alive && <img src={IMG('back')} className="ko-back" />}
            {alive && (
              <span className="hp-chip">
                <img src={IMG_PNG('heart_material')} />
                <b>{hp}</b>
              </span>
            )}
            {c.equipmentCardId && <span className="equip-dot" title="装備あり">⚙</span>}
            {isActor && <span className="actor-label">ACTOR</span>}
            {myPops.map((d) => (
              <span key={d.key} className={d.amount > 0 ? 'pop dmg' : 'pop heal'}>
                {d.amount > 0 ? `-${d.amount}` : `+${-d.amount}`}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** プレイしたカードを中央で見せる演出 */
function RevealOverlay({ reveal }: { reveal: Reveal }) {
  return (
    <div className={`reveal ${reveal.side === ENEMY ? 'from-top' : 'from-bottom'}`}>
      <CardFrame card={reveal.card} width={210} />
      {reveal.label && <div className="reveal-label">{reveal.label}</div>}
    </div>
  );
}

function ResultOverlay({ state, setup, onExit, onRematch }: {
  state: BattleState;
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const won = state.winner === PLAYER;
  const reason = state.endReason === 'wipeout' ? '全滅' : state.endReason === 'deckout' ? '山札切れ' : '時間切れ';
  const text = won
    ? `BRAVER'S DUEL β: 「${setup.playerDeckName}」で「${setup.enemy.name}」に勝利！（${reason}・${state.turn}ターン）`
    : `BRAVER'S DUEL β: 「${setup.enemy.name}」に敗北…リベンジ求む（${state.turn}ターン）`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://raccbigenner.github.io/bravers_duel/')}`;

  return (
    <div className="overlay">
      <div className="dialog result">
        <h2 className={won ? 'win' : 'lose'}>{won ? 'WIN!' : 'LOSE...'}</h2>
        <p>{reason}で{won ? '勝利' : '敗北'}（ターン{state.turn}）</p>
        <a className="big-btn slim share" href={shareUrl} target="_blank" rel="noreferrer">
          Xで結果をシェア
        </a>
        <div className="dialog-btns">
          <button className="chip" onClick={onExit}>ホームへ</button>
          <button className="big-btn slim" onClick={onRematch}>もう一回</button>
        </div>
      </div>
    </div>
  );
}
