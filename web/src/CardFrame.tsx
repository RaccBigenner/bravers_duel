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
  kiraOverlay,
  rarityGradient,
  skillPlate,
  valueTypeLabel,
} from './cardAssets';

interface Props {
  card: Card;
  width?: number;
  /** 大型（横長）カードを90度回転して縦持ちで表示する（手札用） */
  upright?: boolean;
  /**
   * 「今この瞬間に実際に適用される値」。カードに書かれた素の値と違う時だけ、
   * 数字をこの値に差し替えて色を変える。
   * 例: 新たな地平線でコスト-1／ドッソの最大HPがトラッシュ枚数で増える／属性でダメージが伸びる。
   * 素の値のまま出していると、盤面と手札で数字が食い違って嘘になる。
   */
  live?: { hp?: number; cost?: number; value?: number };
}

/** 実効値の色。良くなっていれば水色、悪くなっていれば赤。同じなら白（＝素の表示） */
function liveColor(base: number, live: number | undefined, higherIsBetter: boolean): string {
  if (live === undefined || live === base) return '#fff';
  const better = higherIsBetter ? live > base : live < base;
  return better ? '#8ff0ff' : '#ff9a8f';
}

/**
 * カードは常に固定の基準サイズ（幅340px）で描画し、CSS transform で目的のサイズに拡縮する。
 * こうすると、ブラウザの最小フォントサイズ等の影響を受けず、どのサイズでも同じ見た目になる。
 */
const BASE_WIDTH = 340;

export function CardFrame({ card, width = 300, upright = false, live }: Props) {
  const isLandscape = card.type === 'character' && card.size === 'legendaryLarge';
  const scale = width / BASE_WIDTH;
  const w = BASE_WIDTH;
  const h = (w * 417) / 300;
  const rotate = isLandscape && upright; // 横長カードを縦持ちに
  const outerW = isLandscape && !rotate ? h : w;
  const outerH = isLandscape && !rotate ? w : h;
  // printingId "1-A041-SR" → "1-A041 SR"（右下のコレクター表記）
  // oracleId は再録で共有されるため、絵柄・収録番号には使わない。
  const collectorNo = card.printingId.replace(/-([A-Z]+)$/, ' $1');
  const kira = kiraOverlay(card);

  return (
    <div
      className="card-frame"
      style={{
        width: outerW * scale,
        height: outerH * scale,
        borderRadius: w * 0.0267 * scale,
      }}
    >
      <div
        style={{
          width: rotate ? h : outerW,
          height: rotate ? w : outerH,
          // 縦持ち: 左上原点で「右へw*scaleずらしてから90度回転→縮小」で枠にぴったり収める
          transform: rotate
            ? `translate(${w * scale}px, 0) rotate(90deg) scale(${scale})`
            : `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <RarityFrame rarity={card.rarity} w={w} collectorNo={collectorNo}>
          {card.type === 'character' && <CharacterContent card={card} w={w} h={h} landscape={isLandscape} kira={kira} live={live} />}
          {card.type === 'skill' && <SkillContent card={card} w={w} h={h} kira={kira} live={live} />}
          {card.type === 'equipment' && <EquipmentContent card={card} w={w} kira={kira} />}
          {card.type === 'field' && <FieldContent card={card} w={w} kira={kira} />}
        </RarityFrame>
      </div>
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
          // キラの合成をこの中だけで完結させる（外の背景と混ざらないように）
          isolation: 'isolate',
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

// ---- キラ（ホロ）の層 ------------------------------------------------------

/**
 * キラの合成方法と強さ。ここだけ変えれば全カードの見え方が変わる。
 * テクスチャ（`kira_diamond.webp`）自体が淡いので、合成は強め（等倍）で丁度いい。
 * 実機で multiply / overlay / hard-light / soft-light / screen / color-dodge を
 * 6枚に当てて見比べ、面がはっきり出て絵も潰れない hard-light を採用した。
 */
const KIRA_BLEND = 'hard-light';
const KIRA_OPACITY = 1;

/**
 * キラ（ホロ）の層。
 *
 * **必ず「カード絵のすぐ上」に置き、名前・属性・HP・値プレート・説明より下にする**（社長指示）。
 * つまり各コンテンツの中で、絵を描いた直後に差し込む。全面絵のカードはカード全面、
 * 絵が一部だけのカード（SSRスキルの型抜き絵・装備の丸絵）はその絵の形に沿って乗る。
 * 掛けないカードでは `src` が null なので何も描かない。
 */
function KiraLayer({ src, style }: { src?: string | null; style?: CSSProperties }) {
  if (!src) return null;
  return (
    <div
      aria-hidden
      // 画像に書き出す時、この層だけ別扱いで合成するための目印（admin/src/exportCard.tsx）
      data-kira="1"
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        mixBlendMode: KIRA_BLEND,
        opacity: KIRA_OPACITY,
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
}

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

function CharacterContent({ card, w, h, landscape, kira, live }: {
  card: CharacterCard; w: number; h: number; landscape: boolean; kira?: string | null; live?: Props['live'];
}) {
  const fullArt = isFullArt(card.rarity);
  const gradient = rarityGradient(card.rarity);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {fullArt && (
        <img
          src={IMG(card.printingId)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          alt={card.name}
        />
      )}
      {/* 全面絵ならカード全面に。名前・属性・HPはこの後に描かれるので必ず上に来る */}
      {fullArt && <KiraLayer src={kira} />}
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
                position: 'relative',
                width: '100%',
                height: '100%',
                borderRadius: w * 0.008,
                borderTop: `${w * 0.005}px solid rgba(0,0,0,0.4)`,
                borderLeft: `${w * 0.005}px solid rgba(0,0,0,0.4)`,
                backgroundImage: `url(${IMG(card.printingId)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxSizing: 'border-box',
              }}
            >
              {/* 全面絵でないキャラは、絵の窓の中だけに乗せる */}
              <KiraLayer src={kira} style={{ borderRadius: w * 0.008 }} />
            </div>
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
            text={String(live?.hp ?? card.hp)}
            size={w * 0.062}
            color={liveColor(card.hp, live?.hp, true)}
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

/**
 * スキル種別ごとの画像の切り抜きシェイプ。
 * ひと目で「攻撃/防御/補助/回復」が分かるように、輪郭そのものを変える。
 * - attack: 袈裟斬りの軌跡のような斜めのスラッシュバナー（刃こぼれの切り欠き付き）
 * - guard: 上辺が広く、下が中央に収束する盾のシルエット
 * - support: 上辺が大きくアーチを描く、丸みのある窓
 * - heal: 対角が丸く膨らむ、柔らかい花弁（雫）型
 * リム（縁）もタイプ色で塗り分ける。
 */
const SKILL_ART_SHAPES: Record<
  string,
  { clip?: string; radius?: (w: number) => string; rim: string; glow: string }
> = {
  attack: {
    clip: 'polygon(0% 14%, 84% 5%, 88% 0%, 100% 0%, 100% 86%, 16% 95%, 12% 100%, 0% 100%)',
    rim: 'linear-gradient(115deg, #ffd98a, #e0512e 55%, #6e1212)',
    glow: 'rgba(224, 81, 46, 0.45)',
  },
  guard: {
    clip: 'polygon(4% 0%, 96% 0%, 100% 13%, 100% 52%, 82% 78%, 50% 100%, 18% 78%, 0% 52%, 0% 13%)',
    rim: 'linear-gradient(180deg, #d5ecff, #3f7fc4 55%, #122f4d)',
    glow: 'rgba(80, 150, 220, 0.45)',
  },
  support: {
    radius: (w) => `${w * 0.2}px ${w * 0.2}px ${w * 0.032}px ${w * 0.032}px`,
    rim: 'linear-gradient(180deg, #fff0b8, #c9992e 60%, #63470d)',
    glow: 'rgba(212, 175, 55, 0.4)',
  },
  heal: {
    radius: (w) => `${w * 0.26}px ${w * 0.05}px ${w * 0.26}px ${w * 0.05}px`,
    rim: 'linear-gradient(135deg, #e2ffdd, #57b96a 60%, #1c5230)',
    glow: 'rgba(96, 190, 120, 0.45)',
  },
};

/** タイプ別シェイプで切り抜いたスキル画像（リム付き） */
function SkillArt({ card, w, h, kira }: { card: SkillCard; w: number; h: number; kira?: string | null }) {
  const shape = SKILL_ART_SHAPES[card.valueType] ?? SKILL_ART_SHAPES.attack;
  const rimWidth = w * 0.011;
  const radius = shape.radius?.(w);
  const shared: CSSProperties = shape.clip ? { clipPath: shape.clip } : { borderRadius: radius };
  return (
    <div
      style={{
        position: 'absolute',
        top: h * 0.15,
        left: w * 0.008,
        right: w * 0.008,
        height: h * 0.43,
        // 影と発光は silhouette（切り抜き後の形）に沿わせる
        filter: `drop-shadow(0 ${w * 0.006}px ${w * 0.012}px rgba(0,0,0,0.5)) drop-shadow(0 0 ${w * 0.02}px ${shape.glow})`,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: shape.rim, ...shared }}>
        <div
          style={{
            position: 'absolute',
            inset: rimWidth,
            backgroundImage: `url(${IMG(card.printingId)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            ...shared,
          }}
        >
          {/* 切り抜いた絵の形に沿ってキラを乗せる（リムより内側だけ） */}
          <KiraLayer src={kira} style={shared} />
        </div>
      </div>
    </div>
  );
}

function SkillContent({ card, w, h, kira, live }: { card: SkillCard; w: number; h: number; kira?: string | null; live?: Props['live'] }) {
  const fullArt = card.rarity === 'USR';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {fullArt && (
        <img
          src={IMG(card.printingId)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          alt={card.name}
        />
      )}
      {/* 全面絵ならカード全面に。コスト・名前・属性・値プレート・説明はこの後なので必ず上に来る */}
      {fullArt && <KiraLayer src={kira} />}

      {/* 中段のスキル画像（USR以外）。タイプ別のシェイプで切り抜く。キラは絵の形に沿わせる */}
      {!fullArt && <SkillArt card={card} w={w} h={h} kira={kira} />}

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
                text={String(live?.cost ?? card.costAp)}
                size={w * 0.068}
                color={liveColor(card.costAp, live?.cost, false)}
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

        {/* 下段: 値プレート＋説明
            サポートは基本値が必ず0で、数字を出しても意味が無いので種別プレートだけにする */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: w * 0.013 }}>
            <div
              style={{
                height: h * 0.088,
                minWidth: card.valueType === 'support' ? w * 0.82 : w * 0.56,
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
            {card.valueType !== 'support' && (
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
              <span
                style={{
                  fontSize: w * 0.075,
                  fontWeight: 800,
                  // 素の値と違う時だけ色を変える（帯が明るいので濃い色を使う）
                  color:
                    live?.value === undefined || live.value === card.baseValue
                      ? '#1a1205'
                      : live.value > card.baseValue
                        ? '#0a5f7a'
                        : '#8f2a1a',
                  fontFamily: NUM_FONT,
                }}
              >
                {live?.value ?? card.baseValue}
              </span>
            </div>
            )}
          </div>
          <DescriptionArea effectText={card.effectText} flavorText={card.flavorText} w={w} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 装備

function EquipmentContent({ card, w, kira }: { card: EquipmentCard; w: number; kira?: string | null }) {
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
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <img
              src={IMG(card.printingId)}
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
              alt={card.name}
            />
            {/* 装備は丸絵の中だけに乗せる。名前と付与属性はこの外側なので上に来る */}
            <KiraLayer src={kira} style={{ borderRadius: '50%' }} />
          </div>
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

function FieldContent({ card, w, kira }: { card: FieldCard; w: number; kira?: string | null }) {
  const titleImage = fieldTitlePlate(card.rarity);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        src={IMG(card.printingId)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        alt={card.name}
      />
      {/* フィールドは全面絵。タイトル帯と説明はこの後なので上に来る */}
      <KiraLayer src={kira} />
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
