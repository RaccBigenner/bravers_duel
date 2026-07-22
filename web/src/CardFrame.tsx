/**
 * カード1枚のデザイン（旧プロトタイプ card_widget.dart の移植）。
 * width を渡すとその横幅で描画される（縦横比 300:417）。
 */
import type { Card, CharacterCard, EquipmentCard, FieldCard, Rarity, SkillCard } from '@bravers/engine';
import { CSSProperties } from 'react';
import {
  FLAVOR_FONT,
  IMG,
  IMG_PNG,
  NUM_FONT,
  fieldTitlePlate,
  frameImage,
  innerImage,
  isFullArt,
  rarityGradient,
  skillPlate,
  valueTypeLabel,
} from './cardAssets';

interface Props {
  card: Card;
  width?: number;
}

export function CardFrame({ card, width = 300 }: Props) {
  const isLandscape = card.type === 'character' && card.size === 'legendaryLarge';
  const w = width;
  const h = (w * 417) / 300;
  // "1-A041-SR" → "1-A041 SR"（右下のコレクター表記）
  const collectorNo = card.id.replace(/-([A-Z]+)$/, ' $1');

  return (
    <div
      className="card-frame"
      style={{
        width: isLandscape ? h : w,
        height: isLandscape ? w : h,
        borderRadius: w * 0.0267,
      }}
    >
      <RarityFrame rarity={card.rarity} w={w} collectorNo={collectorNo}>
        {card.type === 'character' && <CharacterContent card={card} w={w} h={h} landscape={isLandscape} />}
        {card.type === 'skill' && <SkillContent card={card} w={w} h={h} />}
        {card.type === 'equipment' && <EquipmentContent card={card} w={w} />}
        {card.type === 'field' && <FieldContent card={card} w={w} />}
      </RarityFrame>
    </div>
  );
}

function RarityFrame({ rarity, w, collectorNo, children }: {
  rarity: Rarity; w: number; collectorNo: string; children: React.ReactNode;
}) {
  const frameSize = w * 0.02667;
  const inner = innerImage(rarity);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        border: `${frameSize / 8}px solid rgba(255,255,255,0.6)`,
        borderRadius: frameSize,
        backgroundImage: `url(${frameImage(rarity)})`,
        backgroundSize: 'cover',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: frameSize,
          borderRadius: frameSize * 0.5,
          backgroundImage: inner ? `url(${inner})` : undefined,
          backgroundSize: 'cover',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      {/* コレクター表記（カード番号・レアリティ） */}
      <span
        style={{
          position: 'absolute',
          right: w * 0.014,
          bottom: w * 0.001,
          fontSize: w * 0.028,
          fontFamily: NUM_FONT,
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: 'rgba(255,255,255,0.9)',
          textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.7)',
          pointerEvents: 'none',
        }}
      >
        {collectorNo}
      </span>
    </div>
  );
}

/** フチ付きテキスト（縁取りを背面レイヤーに描くので、細くてもきれいに出る） */
function Outlined({ text, size, color = '#000', stroke = '#fff', weight = 700, strokeWidth, style }: {
  text: string; size: number; color?: string; stroke?: string; weight?: number; strokeWidth?: number; style?: CSSProperties;
}) {
  const t = strokeWidth ?? Math.max(0.8, size * 0.1);
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.2,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          WebkitTextStroke: `${t}px ${stroke}`,
          color: 'transparent',
        }}
      >
        {text}
      </span>
      <span style={{ position: 'relative', color }}>{text}</span>
    </span>
  );
}

/** 名前用の黒影（高レア画像上の白文字） */
const nameShadow = '1px 1px 3px #000, -1px 1px 3px #000, 1px -1px 3px #000, -1px -1px 3px #000';

function AttributeIcons({ attrs, size, gap }: { attrs: string[]; size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap }}>
      {attrs.map((a, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, rgba(90,90,100,0.9), rgba(20,20,26,0.9))',
            boxShadow: '0 1px 2px rgba(0,0,0,0.5), inset 0 0 2px rgba(255,255,255,0.35)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <img src={IMG(a)} width={size * 0.98} height={size * 0.98} style={{ objectFit: 'contain', display: 'block' }} alt={a} />
        </span>
      ))}
    </div>
  );
}

function DescriptionArea({ effectText, flavorText, w, wide = false }: {
  effectText: string; flavorText: string; w: number; wide?: boolean;
}) {
  const inset = w * 0.02; // 左右・下の余白を同じにする
  return (
    <div
      style={{
        width: `calc(100% - ${inset * 2}px)`,
        height: wide ? w * 0.2134 : w * 0.2667,
        margin: `0 ${inset}px ${inset}px`,
        padding: w * 0.013,
        background: 'rgba(255,255,255,0.25)',
        borderRadius: w * 0.008,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <Outlined text={effectText} size={w * 0.038} style={{ display: 'block', textAlign: 'left' }} />
      <Outlined
        text={flavorText}
        size={w * 0.03}
        style={{ display: 'block', textAlign: 'right', fontFamily: FLAVOR_FONT }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- キャラクター

function CharacterContent({ card, w, h, landscape }: { card: CharacterCard; w: number; h: number; landscape: boolean }) {
  const fullArt = isFullArt(card.rarity);
  const gradient = rarityGradient(card.rarity);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {fullArt && (
        <img
          src={IMG(card.id)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          alt={card.name}
        />
      )}
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ alignSelf: 'flex-start', padding: w * 0.013 }}>
          <span
            className="afs"
            style={{
              fontSize: w * 0.053,
              fontWeight: 700,
              color: '#fff',
              textShadow: fullArt ? nameShadow : '1px 1px 2px rgba(0,0,0,0.7)',
            }}
          >
            {card.name}
          </span>
        </div>

        {!fullArt ? (
          <div
            style={{
              width: '80%',
              height: h * 0.5155,
              padding: w * 0.016,
              background: gradient ?? 'transparent',
              borderRadius: w * 0.008,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: w * 0.008,
                borderTop: `${w * 0.005}px solid rgba(0,0,0,0.4)`,
                borderLeft: `${w * 0.005}px solid rgba(0,0,0,0.4)`,
                backgroundImage: `url(${IMG(card.id)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxSizing: 'border-box',
              }}
            />
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <AttributeIcons attrs={card.attribute} size={w * 0.08} gap={w * 0.016} />
        <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} wide={landscape} />
      </div>

      {/* HP（右上のハート） */}
      <div style={{ position: 'absolute', top: 0, right: 0, width: w * 0.15, height: w * 0.15 }}>
        <img src={IMG_PNG('heart_material')} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} alt="HP" />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Outlined
            text={String(card.hp)}
            size={w * 0.062}
            color="#fff"
            stroke="rgba(0,0,0,0.85)"
            weight={800}
            style={{ fontFamily: NUM_FONT }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- スキル

function SkillContent({ card, w, h }: { card: SkillCard; w: number; h: number }) {
  const fullArt = card.rarity === 'USR';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {fullArt && (
        <img
          src={IMG(card.id)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          alt={card.name}
        />
      )}

      {/* 中段のスキル画像（USR以外）。枠内の横いっぱいに広げる */}
      {!fullArt && (
        <div
          style={{
            position: 'absolute',
            top: h * 0.153,
            left: 0,
            right: 0,
            height: h * 0.422,
            backgroundImage: `url(${IMG(card.id)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* 上段: コスト＋名前＋条件属性 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', padding: w * 0.013, gap: w * 0.013 }}>
          <div style={{ position: 'relative', width: w * 0.165, height: w * 0.165, flexShrink: 0 }}>
            <img src={IMG_PNG('diamond_material')} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} alt="コスト" />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Outlined
                text={String(card.costAp)}
                size={w * 0.068}
                color="#fff"
                stroke="rgba(0,0,0,0.85)"
                weight={800}
                style={{ fontFamily: NUM_FONT }}
              />
            </div>
          </div>
          <div>
            <div
              className="afs"
              style={{
                fontSize: w * 0.053,
                fontWeight: 700,
                color: card.rarity === 'C' || card.rarity === 'R' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
                textShadow:
                  card.rarity === 'USR' ? nameShadow : card.rarity === 'C' || card.rarity === 'R' ? undefined : '1px 1px 2px rgba(0,0,0,0.8)',
              }}
            >
              {card.name}
            </div>
            <div style={{ display: 'flex', gap: w * 0.008, marginTop: w * 0.006 }}>
              {card.conditionAttribute.map((a, i) => (
                <img key={i} src={IMG(a)} width={w * 0.066} height={w * 0.066} style={{ objectFit: 'contain' }} alt={a} />
              ))}
            </div>
          </div>
        </div>

        {/* 下段: 値プレート＋説明 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: w * 0.013 }}>
            <div
              style={{
                height: h * 0.088,
                minWidth: w * 0.56,
                backgroundImage: `url(${skillPlate(card.rarity)})`,
                backgroundSize: '100% 100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: `0 ${w * 0.04}px`,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: w * 0.06, fontWeight: 800, color: '#1a1205', fontFamily: NUM_FONT, letterSpacing: '0.08em' }}>
                {valueTypeLabel(card.valueType)}
              </span>
            </div>
            <div
              style={{
                height: h * 0.088,
                minWidth: w * 0.24,
                backgroundImage: `url(${skillPlate(card.rarity)})`,
                backgroundSize: '100% 100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: `0 ${w * 0.03}px`,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: w * 0.075, fontWeight: 800, color: '#1a1205', fontFamily: NUM_FONT }}>
                {card.baseValue}
              </span>
            </div>
          </div>
          <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 装備

function EquipmentContent({ card, w }: { card: EquipmentCard; w: number }) {
  const gradient = rarityGradient(card.rarity);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: w * 0.03,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'relative', width: w * 0.8, height: w * 0.8 }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: gradient ?? 'rgba(255,255,255,0.4)',
            padding: w * 0.0266,
            boxSizing: 'border-box',
          }}
        >
          <img
            src={IMG(card.id)}
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
            alt={card.name}
          />
        </div>
        <div style={{ position: 'absolute', top: -w * 0.01, width: '100%', textAlign: 'center' }}>
          <span className="afs" style={{ fontSize: w * 0.08, fontWeight: 700, color: '#fff', textShadow: nameShadow }}>
            {card.name}
          </span>
        </div>
        {/* 追加属性 */}
        <div style={{ position: 'absolute', bottom: -w * 0.02, width: '100%' }}>
          <AttributeIcons attrs={card.addAttribute} size={w * 0.08} gap={w * 0.016} />
        </div>
      </div>
      <Outlined
        text="自生存キャラクターにひとつだけ装備可能"
        size={w * 0.04}
        color="#888"
        stroke="#000"
      />
      <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} />
    </div>
  );
}

// ---------------------------------------------------------------- フィールド

function FieldContent({ card, w }: { card: FieldCard; w: number }) {
  const titleImage = fieldTitlePlate(card.rarity);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        src={IMG(card.id)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        alt={card.name}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: '88%',
            height: w * 0.19,
            backgroundImage: `url(${titleImage})`,
            backgroundSize: '100% 100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))',
          }}
        >
          <span className="afs" style={{ fontSize: w * 0.044, fontWeight: 700, color: '#1a1205' }}>{card.name}</span>
          <span style={{ fontSize: w * 0.024, fontWeight: 800, color: 'rgba(26,18,5,0.75)', fontFamily: NUM_FONT, letterSpacing: '0.28em', marginTop: w * 0.004 }}>FIELD</span>
        </div>
        <div style={{ height: w * 0.0267 }} />
        <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} />
      </div>
    </div>
  );
}
