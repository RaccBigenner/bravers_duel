import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Theme/gradient.dart';
import 'package:bravers_duel/Theme/outlined_text.dart';
import 'package:bravers_duel/Theme/tilt_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:google_fonts/google_fonts.dart';

class CardWidget extends StatelessWidget {
  final CardModel card;

  const CardWidget({
    super.key,
    required this.card,
  });

  @override
  Widget build(BuildContext context) {
    return TiltWidget(
      maxAngle: 45,
      child: CardFrame(card: card),
    );
  }
}

class CardFrame extends HookWidget {
  final CardModel card;
  final double width;
  final bool showBack;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double elevation; // → 影の強さに使います

  const CardFrame({
    super.key,
    required this.card,
    this.width = 300.0,
    this.showBack = false,
    this.onTap,
    this.onLongPress,
    this.elevation = 1.0,
  });

  bool get isLegendaryLarge {
    return card.maybeMap(
      character: (c) => c.size == 'legendaryLarge',
      orElse: () => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final height = width * (417 / 300);

    // コントローラ：400ms
    final controller = useAnimationController(
      duration: const Duration(milliseconds: 400),
    );

    // 傾きアニメーション
    final tiltAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: 0.1), weight: 200),
      TweenSequenceItem(tween: Tween(begin: 0.1, end: -0.1), weight: 300),
      TweenSequenceItem(tween: Tween(begin: -0.1, end: 0.0), weight: 300),
    ]).animate(controller);

    void _playAnimation() => controller.forward(from: 0);

    return AnimatedBuilder(
      animation: tiltAnim,
      builder: (context, child) {
        final matrix = Matrix4.identity()
          ..setEntry(3, 2, 0.001)
          ..rotateY(tiltAnim.value);
        return Transform(
          alignment: Alignment.center,
          transform: matrix,
          child: child,
        );
      },
      child: GestureDetector(
        onTap: () {
          _playAnimation();
          onTap?.call();
        },
        onLongPress: () {
          _playAnimation();
          onLongPress?.call();
        },
        child: Container(
          width: isLegendaryLarge ? height : width,
          height: isLegendaryLarge ? width : height,
          padding: EdgeInsets.all(width * 0.0267),
          decoration: BoxDecoration(
            // ここで影を付ける
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.25),
                blurRadius: elevation * 10, // ぼかし具合
                spreadRadius: elevation / 2, // 影の広がり
                offset: const Offset(0, 2), // 少し下に影を落とす
              ),
            ],
            borderRadius: BorderRadius.circular(8),
          ),
          child: showBack
              ? Image.asset('lib/assets/card_images/back.webp')
              : CardContent(card: card, width: width),
        ),
      ),
    );
  }
}

/// カードの中身部分（typeによって表示内容が変わる）
class CardContent extends StatelessWidget {
  final CardModel card;
  final double width;
  const CardContent({super.key, required this.card, required this.width});

  @override
  Widget build(BuildContext context) {
    final height = width * (417 / 300);
    final innerBorderRadius = width * 0.01;
    final nameAreaPadding = width * 0.013;
    final nameSize = width * 0.053;
    final nameShadowSize = width * 0.004;
    final nameShadowRadius = width * 0.016;
    final textOffset = width * 0.016;
    final frameSize = width * 0.02667;

    return card.when(
      // キャラクターカードの場合の表示
      character: (id, vol, code, rarity, name, effectText, flavorText, size, hp,
          attr) {
        final characterImageWidth = width * 0.8;
        final characterImageHeight = height * 0.5155;
        final characterImageFrameRadius = width * 0.008;
        final characterImageFramePadding = width * 0.016;
        final characterImageFrameShadowSize = width * 0.005;
        final attrivuteSize = width * 0.08;
        final attrivuteSpacing = width * 0.008;
        final heartSize = width * 0.15;
        final hpFontSize = width * 0.106;

        return Stack(
          children: [
            // 共通のレイアウト
            CardRarityFrame(
                rarity: rarity,
                frameSize: frameSize,
                child: Stack(
                  children: [
                    // USRの時のキャラクター表示
                    if (rarity == 'USR' || rarity == 'SSR' || rarity == 'LSR')
                      Positioned.fill(
                        child: ClipRRect(
                          borderRadius:
                              BorderRadius.circular(innerBorderRadius),
                          child: Image.asset(
                            'lib/assets/card_images/$id.webp',
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Align(
                            alignment: Alignment.topLeft,
                            child: Padding(
                              padding: EdgeInsets.only(
                                  top: nameAreaPadding, left: nameAreaPadding),
                              child: Text(
                                name,
                                style: TextStyle(
                                  fontFamily: 'AFS', // ← ここがfamily名と一致していること！
                                  fontSize: nameSize,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                  shadows: (rarity == 'USR' || rarity == 'SSR')
                                      ? [
                                          Shadow(
                                              offset: Offset(nameShadowSize,
                                                  nameShadowSize),
                                              color: Colors.black,
                                              blurRadius: nameShadowRadius),
                                          Shadow(
                                              offset: Offset(-nameShadowSize,
                                                  nameShadowSize),
                                              color: Colors.black,
                                              blurRadius: nameShadowRadius),
                                          Shadow(
                                              offset: Offset(nameShadowSize,
                                                  -nameShadowSize),
                                              color: Colors.black,
                                              blurRadius: nameShadowRadius),
                                          Shadow(
                                              offset: Offset(-nameShadowSize,
                                                  -nameShadowSize),
                                              color: Colors.black,
                                              blurRadius: nameShadowRadius),
                                        ]
                                      : [],
                                ),
                              ),
                            )),
                        // キャラクター画像
                        (rarity != 'LSR' && rarity != 'USR' && rarity != 'SSR')
                            ? Container(
                                width: characterImageWidth,
                                height: characterImageHeight,
                                padding: EdgeInsets.all(
                                    characterImageFramePadding), // 画像の周囲に4pxの余白
                                decoration: BoxDecoration(
                                  gradient: getCardGradient(rarity),
                                  borderRadius: BorderRadius.circular(
                                      characterImageFrameRadius),
                                ),
                                child: Container(
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(
                                        characterImageFrameRadius),
                                    border: Border(
                                        top: BorderSide(
                                            color:
                                                Colors.black.withOpacity(0.4),
                                            width:
                                                characterImageFrameShadowSize),
                                        left: BorderSide(
                                            color:
                                                Colors.black.withOpacity(0.4),
                                            width:
                                                characterImageFrameShadowSize)),
                                    image: DecorationImage(
                                      image: AssetImage(
                                          'lib/assets/card_images/$id.webp'),
                                      fit: BoxFit.cover, // 🔥 背景にしっかり敷き詰め
                                      alignment: Alignment.center, // 🎯 中心基準で表示
                                    ),
                                  ),
                                ),
                              )
                            : SizedBox(
                                width: characterImageWidth,
                                height: size == "normal"
                                    ? characterImageHeight
                                    : characterImageHeight * 0.5,
                              ),
                        // 属性アイコン（横並び）
                        SizedBox(
                          height: attrivuteSize,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: attr.map((a) {
                              return Container(
                                padding: EdgeInsets.symmetric(
                                    horizontal: attrivuteSpacing),
                                child: Image.asset(
                                  'lib/assets/card_images/$a.webp',
                                  width: attrivuteSize,
                                  height: attrivuteSize,
                                  fit: BoxFit.contain,
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                        // 説明エリア
                        CardDescriptionArea(
                          effectText: effectText,
                          flavorText: flavorText,
                          size: size,
                          cardWidth: width,
                        ),
                      ],
                    ),
                    // キャラクターHP
                    Align(
                        alignment: Alignment.topRight,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            Image.asset(
                              'lib/assets/card_images/heart_material.webp',
                              width: heartSize,
                              height: heartSize,
                              fit: BoxFit.contain,
                            ),
                            Transform.translate(
                              offset: Offset(0, -textOffset), // ← Y軸方向に4px上へ
                              child: OutlinedText(
                                  text: hp.toString(),
                                  style: GoogleFonts.murecho(
                                    fontSize: hpFontSize,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.black,
                                  ),
                                  strokeWidth: width * 0.012),
                            ),
                          ],
                        ))
                  ],
                )),
          ],
        );
      },

      // スキルカードの場合の表示
      skill: (id, vol, code, rarity, name, effectText, flavorText, costAp,
          condAttr, baseValue, valueType) {
        final diamondSize = width * 0.134;
        final attrivuteSize = width * 0.066;
        final costFontSize = width * 0.08;
        final attrivuteSpacing = width * 0.008;
        final skillImageHeight = height * 0.422;
        final valueImageHeight = height * 0.086;
        final valueFontSize = width * 0.08;
        final skillImagePadding = width * 0.03;
        final skillImageSpacing = height * 0.153;

        String leftValueImageKey() {
          switch (rarity) {
            case 'C':
              return 'skill_value_left_normal';
            case 'R':
              return 'skill_value_left_silver';
            default:
              return 'skill_value_left_gold';
          }
        }

        String rightValueImageKey() {
          switch (rarity) {
            case 'C':
              return 'skill_value_right_normal';
            case 'R':
              return 'skill_value_right_silver';
            default:
              return 'skill_value_right_gold';
          }
        }

        String valueTypeText() {
          switch (valueType) {
            case 'attack':
              return 'ATTACK';
            case 'guard':
              return 'GUARD';
            default:
              return 'SUPPORT';
          }
        }

        return Stack(
          children: [
            CardRarityFrame(
                rarity: rarity,
                frameSize: frameSize,
                child: Stack(
                  children: [
                    if (rarity == 'USR')
                      Positioned.fill(
                        child: ClipRRect(
                          borderRadius:
                              BorderRadius.circular(innerBorderRadius),
                          child: Image.asset(
                            'lib/assets/card_images/$id.webp',
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Padding(
                            padding: EdgeInsets.only(
                                top: nameAreaPadding, left: nameAreaPadding),
                            child: Row(
                              children: [
                                Stack(
                                  alignment: Alignment.center,
                                  children: [
                                    Image.asset(
                                      'lib/assets/card_images/diamond_material.webp',
                                      height: diamondSize,
                                      fit: BoxFit.cover,
                                    ),
                                    Transform.translate(
                                      offset: Offset(
                                          0, -textOffset), // ← Y軸方向に4px上へ
                                      child: OutlinedText(
                                          text: costAp.toString(),
                                          style: GoogleFonts.murecho(
                                            fontSize: costFontSize,
                                            fontWeight: FontWeight.bold,
                                            color: Colors.black,
                                          ),
                                          strokeWidth: width * 0.012),
                                    )
                                  ],
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(name,
                                        style: TextStyle(
                                          fontFamily:
                                              'AFS', // ← ここがfamily名と一致していること！
                                          fontSize: nameSize,
                                          fontWeight: FontWeight.bold,
                                          color: (rarity != 'SR' &&
                                                  rarity != 'USR')
                                              ? Colors.black.withOpacity(0.8)
                                              : Colors.white.withOpacity(0.8),
                                          shadows: (rarity == 'USR')
                                              ? [
                                                  Shadow(
                                                      offset: Offset(
                                                          nameShadowSize,
                                                          nameShadowSize),
                                                      color: Colors.black,
                                                      blurRadius:
                                                          nameShadowRadius),
                                                  Shadow(
                                                      offset: Offset(
                                                          -nameShadowSize,
                                                          nameShadowSize),
                                                      color: Colors.black,
                                                      blurRadius:
                                                          nameShadowRadius),
                                                  Shadow(
                                                      offset: Offset(
                                                          nameShadowSize,
                                                          -nameShadowSize),
                                                      color: Colors.black,
                                                      blurRadius:
                                                          nameShadowRadius),
                                                  Shadow(
                                                      offset: Offset(
                                                          -nameShadowSize,
                                                          -nameShadowSize),
                                                      color: Colors.black,
                                                      blurRadius:
                                                          nameShadowRadius),
                                                ]
                                              : [],
                                        )),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.start,
                                      children: condAttr.map((a) {
                                        return Padding(
                                          padding: EdgeInsets.symmetric(
                                              horizontal: attrivuteSpacing),
                                          child: Image.asset(
                                            'lib/assets/card_images/$a.webp',
                                            width: attrivuteSize,
                                            height: attrivuteSize,
                                            fit: BoxFit.contain,
                                          ),
                                        );
                                      }).toList(),
                                    ),
                                  ],
                                )
                              ],
                            )),
                        SizedBox(
                          height: skillImageHeight,
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Stack(
                              alignment: Alignment.center,
                              children: [
                                Image.asset(
                                  'lib/assets/card_images/${leftValueImageKey()}.webp',
                                  height: valueImageHeight,
                                  fit: BoxFit.cover,
                                ),
                                Transform.translate(
                                    offset:
                                        Offset(0, -textOffset), // ← Y軸方向に4px上へ
                                    child: Text(
                                      valueTypeText(),
                                      style: GoogleFonts.murecho(
                                        fontSize: valueFontSize,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.black,
                                      ),
                                    ))
                              ],
                            ),
                            Stack(
                              alignment: Alignment.center,
                              children: [
                                Image.asset(
                                  'lib/assets/card_images/${rightValueImageKey()}.webp',
                                  height: valueImageHeight,
                                  fit: BoxFit.cover,
                                ),
                                Transform.translate(
                                    offset:
                                        Offset(0, -textOffset), // ← Y軸方向に4px上へ
                                    child: Text(
                                      baseValue.toString(),
                                      style: GoogleFonts.murecho(
                                        fontSize: valueFontSize,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.black,
                                      ),
                                    ))
                              ],
                            ),
                          ],
                        ),
                        CardDescriptionArea(
                          effectText: effectText,
                          flavorText: flavorText,
                          cardWidth: width,
                        ),
                      ],
                    ),
                  ],
                )),
            if (rarity != 'USR')
              Column(
                children: [
                  SizedBox(
                    height: skillImageSpacing,
                  ),
                  Container(
                    height: skillImageHeight,
                    margin: EdgeInsets.symmetric(horizontal: skillImagePadding),
                    decoration: BoxDecoration(
                      image: DecorationImage(
                        image: AssetImage('lib/assets/card_images/$id.webp'),
                        fit: BoxFit.cover, // 🔥 背景にしっかり敷き詰め
                        alignment: Alignment.center, // 🎯 中心基準で表示
                      ),
                    ),
                  ),
                ],
              )
          ],
        );
      },

      // 装備カードの場合の表示
      equipment:
          (id, vol, code, rarity, name, effectText, flavorText, addAttr) {
        final equipmentImageAreaSize = width * 0.8;
        final equipmentFrameSize = width * 0.0266;
        final equipmentNameSize = width * 0.08;
        final eqipmentInformationFontSize = width * 0.04;
        return CardRarityFrame(
          rarity: rarity,
          frameSize: frameSize,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const SizedBox(),
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                      height: equipmentImageAreaSize,
                      width: equipmentImageAreaSize,
                      decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(
                              equipmentImageAreaSize * 0.5),
                          gradient: getCardGradient(rarity)),
                      child: Padding(
                        padding: EdgeInsets.all(equipmentFrameSize), // 周囲に8pの余白
                        child: ClipOval(
                          child: Image.asset(
                            'lib/assets/card_images/$id.webp', // ← 画像パス
                            fit: BoxFit.cover, // 中央から丸く敷き詰め
                            width: double.infinity,
                            height: double.infinity,
                          ),
                        ),
                      )),
                  Align(
                    alignment: Alignment.topCenter,
                    child: Text(
                      name,
                      style: TextStyle(
                        fontFamily: 'AFS', // ← ここがfamily名と一致していること！
                        fontSize: equipmentNameSize,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        shadows: [
                          Shadow(
                              offset: Offset(nameShadowSize, nameShadowSize),
                              color: Colors.black,
                              blurRadius: nameShadowRadius),
                          Shadow(
                              offset: Offset(-nameShadowSize, nameShadowSize),
                              color: Colors.black,
                              blurRadius: nameShadowRadius),
                          Shadow(
                              offset: Offset(nameShadowSize, -nameShadowSize),
                              color: Colors.black,
                              blurRadius: nameShadowRadius),
                          Shadow(
                              offset: Offset(-nameShadowSize, -nameShadowSize),
                              color: Colors.black,
                              blurRadius: nameShadowRadius),
                        ],
                      ),
                    ),
                  )
                ],
              ),
              OutlinedText(
                text: '自生存キャラクターにひとつだけ装備可能',
                style: GoogleFonts.murecho(
                  fontSize: eqipmentInformationFontSize,
                  fontWeight: FontWeight.bold,
                  color: Colors.grey,
                ),
                strokeColor: Colors.black,
                strokeWidth: width * 0.004,
              ),
              CardDescriptionArea(
                effectText: effectText,
                flavorText: flavorText,
                cardWidth: width,
              )
            ],
          ),
        );
      },

      // フィールドカードの場合の表示
      field: (id, vol, code, rarity, name, effectText, flavorText) {
        final fieldNameFontSize = width * 0.0534;
        final fieldFontSize = width * 0.04;
        final sizedBoxSize = width * 0.0267;
        return Stack(
          children: [
            CardRarityFrame(
                rarity: rarity,
                frameSize: frameSize,
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(innerBorderRadius),
                        child: Image.asset(
                          'lib/assets/card_images/$id.webp',
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Stack(
                          alignment: Alignment.center,
                          children: [
                            Image.asset(
                              rarity == 'R'
                                  ? 'lib/assets/card_images/field_title_r.webp'
                                  : 'lib/assets/card_images/field_title_sr.webp',
                              fit: BoxFit.cover,
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Text(
                                  name,
                                  style: GoogleFonts.murecho(
                                    fontSize: fieldNameFontSize,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.black,
                                  ),
                                ),
                                OutlinedText(
                                    text: 'FIELD',
                                    style: GoogleFonts.murecho(
                                      fontSize: fieldFontSize,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.black,
                                    ),
                                    strokeWidth: width * 0.004),
                              ],
                            )
                          ],
                        ),
                        SizedBox(
                          height: sizedBoxSize,
                        ),
                        CardDescriptionArea(
                          effectText: effectText,
                          flavorText: flavorText,
                          cardWidth: width,
                        ),
                      ],
                    ),
                  ],
                ))
          ],
        );
      },
    );
  }
}

/// レアリティに応じた縁取り・カラーなどを分離
class CardRarityFrame extends StatelessWidget {
  final String rarity;
  final Widget child;
  final double padding;
  final double frameSize;

  const CardRarityFrame(
      {super.key,
      required this.rarity,
      required this.child,
      this.padding = 0,
      required this.frameSize});

  BoxDecoration? get rarityDecoration {
    String? decorationId() {
      switch (rarity) {
        case 'C':
          return 'inner_background_grey';
        case 'UC':
          return 'inner_background_darkgrey';
        case 'R':
          return 'inner_background_red';
        case 'SR':
          return 'inner_background_emerald';
        default:
          return null;
      }
    }

    return decorationId() != null
        ? BoxDecoration(
            image: DecorationImage(
              image:
                  AssetImage('lib/assets/card_images/${decorationId()}.webp'),
              fit: BoxFit.cover,
            ),
            borderRadius: BorderRadius.circular(frameSize * 0.5),
          )
        : null;
  }

  @override
  Widget build(BuildContext context) {
    final border =
        Border.all(color: Colors.white.withOpacity(0.6), width: frameSize / 8);
    final borderRadius = BorderRadius.circular(frameSize);

    String backgroundImageKey() {
      switch (rarity) {
        case 'LSR':
          return 'background_frame_diamond';
        case 'USR':
          return 'background_frame_wave';
        case 'SSR':
          return 'background_frame_black';
        case 'SR':
          return 'background_frame_gold';
        case 'R':
          return 'background_frame_metal';
        case 'UC':
          return 'background_frame_ripple';
        default:
          return 'background_frame_ripple';
      }
    }

    return Container(
      decoration: BoxDecoration(
        border: border,
        borderRadius: borderRadius,
      ),
      child: Stack(
        children: [
          // 背景画像（下）
          ClipRRect(
            borderRadius: borderRadius,
            child: Image.asset(
              'lib/assets/card_images/${backgroundImageKey()}.webp',
              fit: BoxFit.cover,
              width: double.infinity,
              height: double.infinity,
            ),
          ),
          // 中身（上）
          Container(
            padding: EdgeInsets.all(padding),
            margin: EdgeInsets.all(frameSize),
            decoration: rarityDecoration,
            child: child,
          ),
        ],
      ),
    );
  }
}

// カードの説明エリア
class CardDescriptionArea extends StatelessWidget {
  final String effectText;
  final String flavorText;
  final String size; // "normal" などのサイズ判定に使用
  final double cardWidth;

  const CardDescriptionArea(
      {super.key,
      required this.effectText,
      required this.flavorText,
      this.size = 'normal',
      required this.cardWidth});

  @override
  Widget build(BuildContext context) {
    final margin = cardWidth * 0.013;
    final fontSize = cardWidth * 0.038;
    final textOutline = cardWidth * 0.004;
    final fravorFontSize = cardWidth * 0.03;
    final letterSpacing = cardWidth * 0.0053;
    return Container(
      width: size == "normal" ? cardWidth * 0.88 : cardWidth / 0.75,
      height: size == "normal" ? cardWidth * 0.2667 : cardWidth * 0.2134,
      margin: EdgeInsets.all(margin),
      color: Colors.white.withOpacity(0.2),
      padding: EdgeInsets.all(margin),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedText(
            text: effectText,
            style: GoogleFonts.murecho(
              letterSpacing: -letterSpacing,
              fontSize: fontSize,
              fontWeight: FontWeight.bold,
              color: Colors.black,
            ),
            strokeWidth: textOutline,
          ),
          Align(
            alignment: Alignment.bottomRight,
            child: OutlinedText(
              text: flavorText,
              style: GoogleFonts.sawarabiMincho(
                letterSpacing: -letterSpacing,
                fontSize: fravorFontSize,
                fontWeight: FontWeight.bold,
                color: Colors.black,
              ),
              strokeColor: Colors.white,
              strokeWidth: textOutline,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
