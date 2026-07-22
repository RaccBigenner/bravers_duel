/**
 * カード1枚のデザイン（旧プロトタイプ card_widget.dart の移植）。
 * width を渡すとその横幅で描画される（縦横比 300:417）。
 */
import type { Card, CharacterCard, EquipmentCard, FieldCard, Rarity, SkillCard } from '@bravers/engine';
import { CSSProperties } from 'react';
import {
  IMG,
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

  return (
    <div
      className="card-frame"
      style={{
        width: isLandscape ? h : w,
        height: isLandscape ? w : h,
        borderRadius: w * 0.0267,
      }}
    >
      <RarityFrame rarity={card.rarity} w={w}>
        {card.type === 'character' && <CharacterContent card={card} w={w} h={h} landscape={isLandscape} />}
        {card.type === 'skill' && <SkillContent card={card} w={w} h={h} />}
        {card.type === 'equipment' && <EquipmentContent card={card} w={w} />}
        {card.type === 'field' && <FieldContent card={card} w={w} />}
      </RarityFrame>
    </div>
  );
}

function RarityFrame({ rarity, w, children }: { rarity: Rarity; w: number; children: React.ReactNode }) {
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
    </div>
  );
}

/** 白フチ付きテキスト */
function Outlined({ text, size, color = '#000', stroke = '#fff', weight = 700, style }: {
  text: string; size: number; color?: string; stroke?: string; weight?: number; style?: CSSProperties;
}) {
  const s = Math.max(1, size * 0.09);
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: weight,
        color,
        textShadow: `${s}px 0 0 ${stroke}, -${s}px 0 0 ${stroke}, 0 ${s}px 0 ${stroke}, 0 -${s}px 0 ${stroke}, ${s}px ${s}px 0 ${stroke}, -${s}px ${s}px 0 ${stroke}, ${s}px -${s}px 0 ${stroke}, -${s}px -${s}px 0 ${stroke}`,
        lineHeight: 1.1,
        ...style,
      }}
    >
      {text}
    </span>
  );
}

/** 名前用の黒影（高レア画像上の白文字） */
const nameShadow = '1px 1px 3px #000, -1px 1px 3px #000, 1px -1px 3px #000, -1px -1px 3px #000';

function AttributeIcons({ attrs, size, gap }: { attrs: string[]; size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap }}>
      {attrs.map((a, i) => (
        <img key={i} src={IMG(a)} width={size} height={size} style={{ objectFit: 'contain' }} alt={a} />
      ))}
    </div>
  );
}

function DescriptionArea({ effectText, flavorText, w, wide = false }: {
  effectText: string; flavorText: string; w: number; wide?: boolean;
}) {
  return (
    <div
      style={{
        width: wide ? '96%' : '88%',
        height: wide ? w * 0.2134 : w * 0.2667,
        margin: `${w * 0.013}px auto`,
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
        style={{ display: 'block', textAlign: 'right', fontFamily: "'Sawarabi Mincho', serif" }}
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
        <img src={IMG('heart_material')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="HP" />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateY(-${w * 0.016}px)`,
          }}
        >
          <Outlined text={String(card.hp)} size={w * 0.106} />
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

      {/* 中段のスキル画像（USR以外） */}
      {!fullArt && (
        <div
          style={{
            position: 'absolute',
            top: h * 0.153,
            left: w * 0.03,
            right: w * 0.03,
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
          <div style={{ position: 'relative', width: w * 0.134, height: w * 0.134, flexShrink: 0 }}>
            <img src={IMG('diamond_material')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="コスト" />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `translateY(-${w * 0.016}px)`,
              }}
            >
              <Outlined text={String(card.costAp)} size={w * 0.08} />
            </div>
          </div>
          <div>
            <div
              className="afs"
              style={{
                fontSize: w * 0.053,
                fontWeight: 700,
                color: card.rarity !== 'SR' && card.rarity !== 'USR' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.85)',
                textShadow: card.rarity === 'USR' ? nameShadow : undefined,
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
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', height: h * 0.086 }}>
              <img src={skillPlate(card.rarity, 'left')} style={{ height: '100%' }} alt="" />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(-${w * 0.013}px)` }}>
                <span style={{ fontSize: w * 0.075, fontWeight: 700, color: '#000' }}>{valueTypeLabel(card.valueType)}</span>
              </div>
            </div>
            <div style={{ position: 'relative', height: h * 0.086 }}>
              <img src={skillPlate(card.rarity, 'right')} style={{ height: '100%' }} alt="" />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(-${w * 0.013}px)` }}>
                <span style={{ fontSize: w * 0.08, fontWeight: 700, color: '#000' }}>{card.baseValue}</span>
              </div>
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
  const titleImage = card.rarity === 'R' ? IMG('field_title_r') : IMG('field_title_sr');
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
        <div style={{ position: 'relative', width: '90%' }}>
          <img src={titleImage} style={{ width: '100%' }} alt="" />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: w * 0.0534, fontWeight: 700, color: '#000' }}>{card.name}</span>
            <Outlined text="FIELD" size={w * 0.04} />
          </div>
        </div>
        <div style={{ height: w * 0.0267 }} />
        <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} />
      </div>
    </div>
  );
}
