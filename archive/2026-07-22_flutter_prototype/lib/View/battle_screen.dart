import 'dart:async';
import 'dart:math' as math;
import 'package:bravers_duel/Model/turn_state.dart';
import 'package:bravers_duel/Repository/card_data.dart';
import 'package:bravers_duel/Theme/outlined_text.dart';
import 'package:bravers_duel/Theme/sample_maker.dart';
import 'package:bravers_duel/Widget/battle_button.dart';
import 'package:bravers_duel/ViewModel/battle_processor.dart';
import 'package:bravers_duel/Widget/battle_modal.dart';
import 'package:bravers_duel/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:bravers_duel/Model/battle_state.dart';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Model/character_state.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// ズーム設定をまとめたクラス
class ZoomConfig {
  /// 拡大率
  final double ratio;

  /// 縦方向ピボット（-1.0 = 上端, 0 = 中央, +1.0 = 下端）
  final double pivot;
  ZoomConfig({required this.ratio, required this.pivot});
}

/// BattleScreen はバトル全体のレイアウトを管理します。
/// 敵エリアを反転表示し、プレイヤーエリアを通常表示します。
class BattleScreen extends HookConsumerWidget {
  /// 初期のバトル状態を保持します。
  final BattleState initial;
  const BattleScreen({super.key, required this.initial});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // --- ズーム設定 ---
    // null: デフォルトに戻る（scale=1, center）
    final zoomConfig = useState<ZoomConfig?>(null);

    // --- Load card master once ---
    final cardsFuture = useMemoized(loadCardsFromJson, const []);
    final cardsAsync = useFuture(cardsFuture);
    if (cardsAsync.connectionState != ConnectionState.done) {
      return const Center(child: CircularProgressIndicator());
    }
    final cardMaster = cardsAsync.data!;

    // --- 初期 BattleState を一度だけ生成 ---
    final initialState = useMemoized(
      () => BattleState.initial(
        playerId: playerId,
        playerDeckModel: deckSampleMaker(0),
        enemyId: enemyId,
        enemyDeckModel: deckSampleMaker(0),
        cardMaster: cardMaster,
      ),
      [cardMaster],
    );

    final state = ref.watch(battleProcessorProvider(initialState));
    final processor = ref.read(battleProcessorProvider(initialState).notifier);

    // --- 選択されている手札の index など ---
    final selectedHandIndex = useState<int?>(null);
    final selectedChargeHnadIndex = useState<List<int>>([]);

    // --- プレイヤー／敵 の取得 ---
    final me = processor.me();
    final enemy = processor.enemy();

    // --- イベントキューと実行フラグ ---
    final pending = useState<List<BattleEvent>>([]);
    final isProcessing = useState<bool>(false);

    // --- 各種アニメーション用 state ---
    final playingCard = useState<CardModel?>(null);
    final showTurn = useState<TurnState?>(null);
    final isDrawing = useState<bool>(false);
    final drawerId = useState<String?>(null);
    final playTargetId = useState<String?>(null);

    // ① state.events に新着があればキューに追加
    useEffect(() {
      final newEvents = state.events.where((e) {
        final base =
            e.actorId == me.playerId ? me.processedSeq : enemy.processedSeq;
        return e.seq > base;
      }).toList();
      if (newEvents.isNotEmpty) {
        pending.value = [...pending.value, ...newEvents];
      }
      return null;
    }, [state.events.length, me.processedSeq, enemy.processedSeq]);

    // ② pending から一つずつ実行
    useEffect(() {
      // addPostFrameCallback の中で全ロジックを動かす
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (isProcessing.value || pending.value.isEmpty) return;
        isProcessing.value = true;
        final ev = pending.value.first;
        () async {
          await Future.delayed(const Duration(microseconds: 100));

          // すでに再生済みならスキップ
          if (ev.seq <= me.processedSeq) {
            isProcessing.value = false;
            pending.value = [...pending.value]..removeAt(0);
            return;
          }

          try {
            if (ev.type == 'turnEnd') {
              showTurn.value = state.turnState;
              await Future.delayed(const Duration(milliseconds: 1600));
            }

            if (ev.type == 'draw') {
              drawerId.value = ev.actorId;
              for (var i = 0; i < ev.value; i++) {
                isDrawing.value = true;
                await Future.delayed(const Duration(milliseconds: 250));
              }
            }

            if (ev.type == 'playCard') {
              playingCard.value =
                  cardMaster.firstWhere((c) => c.id == ev.targets[0]);
              await Future.delayed(const Duration(milliseconds: 700));
            }

            if (ev.type == 'characterPlayCard') {
              // ズームイン設定をフレーム後に反映
              WidgetsBinding.instance.addPostFrameCallback((_) {
                zoomConfig.value = ZoomConfig(ratio: 1.3, pivot: 0.4);
              });
              playTargetId.value = ev.targets[0];
              await Future.delayed(const Duration(milliseconds: 1000));
              // ズームアウトもフレーム後に反映
              WidgetsBinding.instance.addPostFrameCallback((_) {
                zoomConfig.value = null;
              });
              playTargetId.value = null;
            }

            // イベント実行
            await processor.applyEvent(ev);

            if (ev.type == 'chargeApFromHand') {
              await Future.delayed(const Duration(milliseconds: 500));
            }
          } finally {
            // pending クリア＆次フェーズへ
            pending.value = [...pending.value]..removeAt(0);
            isProcessing.value = false;
          }
        }();
      });

      return null;
    }, [pending.value, isProcessing.value]);

    // --- TweenAnimationBuilder で alignment と scale を同時アニメート ---
    final targetScale = zoomConfig.value?.ratio ?? 1.0;
    final targetAlign = zoomConfig.value != null
        ? Alignment(0, zoomConfig.value!.pivot)
        : Alignment.center;

    Widget _buildCardDetailOverlay(
      BuildContext context,
      List<CardModel> hand,
      ValueNotifier<int?> selectedHandIndex,
      BattleProcessor processor,
      PlayerState enemy,
      ValueNotifier<List<int>> selectedChargeHnadIndex,
    ) {
      return Stack(
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: 120.h),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => selectedHandIndex.value = null,
            ),
          ),
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                GestureDetector(
                  onTap: () {}, // 背景にタップを透過させない
                  child: CardFrame(
                    card: hand[selectedHandIndex.value!],
                    width: 300.w,
                  ),
                ),
                ElevatedButton(
                  onPressed: processor
                          .playableHandCardIndexes(isMe: true)
                          .contains(selectedHandIndex.value!)
                      ? (state.turnState.turnActor == me.playerId &&
                              state.turnState.phase == TurnPhase.playCard)
                          ? () {
                              final playCharId = me.characters[0].uuid;
                              List<String> getTargets() => [
                                    enemy.characters
                                        .map((c) => c.uuid)
                                        .toList()[0]
                                  ];
                              processor.playCardCommand(
                                playCharacterId: playCharId,
                                targetCharacterIds: getTargets(),
                                card: hand[selectedHandIndex.value!],
                              );
                              selectedHandIndex.value = null;
                            }
                          : null
                      : null,
                  child: const Text('使用する'),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return Scaffold(
      body: SafeArea(
        child: TweenAnimationBuilder<Alignment>(
          tween: AlignmentTween(
            begin: Alignment.center,
            end: targetAlign,
          ),
          duration: const Duration(milliseconds: 800),
          builder: (context, alignment, child) {
            return TweenAnimationBuilder<double>(
              tween: Tween(begin: 1.0, end: targetScale),
              duration: const Duration(milliseconds: 500),
              builder: (context, scale, _) {
                return Transform.scale(
                  scale: scale,
                  alignment: alignment,
                  child: child,
                );
              },
              child: child,
            );
          },
          // この child が画面全体
          child: Stack(
            children: [
              Padding(
                padding: EdgeInsets.symmetric(horizontal: _C.pad),
                child: Column(
                  children: [
                    // 敵エリア
                    Transform(
                      alignment: Alignment.center,
                      transform: Matrix4.rotationZ(math.pi),
                      child: PlayerArea(
                        name: enemy.playerId,
                        hand: enemy.hand,
                        field: enemy.characters,
                        deck: enemy.deck,
                        trash: enemy.trash,
                        ap: enemy.ap,
                        isEnemy: true,
                        playableCardsIndexes: const [],
                        highlightCharacterId: playTargetId.value,
                      ),
                    ),
                    SizedBox(
                      height: _C.pad * 2,
                      child: Text(
                        '${state.turnState.turnActor}: ${state.turnState.phase}',
                      ),
                    ),
                    // 自分エリア
                    PlayerArea(
                      name: me.playerId,
                      hand: me.hand,
                      field: me.characters,
                      deck: me.deck,
                      trash: me.trash,
                      ap: me.ap,
                      isEnemy: false,
                      playableCardsIndexes:
                          processor.playableHandCardIndexes(isMe: true),
                      onCardTap: (i) => selectedHandIndex.value = i,
                      highlightCharacterId: playTargetId.value,
                    ),
                  ],
                ),
              ),
              // プレイされるカード飛行アニメ
              if (playingCard.value != null)
                PlayedCardFlyAnimation(
                  card: playingCard.value!,
                  onEnd: () => playingCard.value = null,
                ),
              // 手札詳細モーダル
              if (selectedHandIndex.value != null)
                _buildCardDetailOverlay(
                  context,
                  me.hand,
                  selectedHandIndex,
                  processor,
                  enemy,
                  selectedChargeHnadIndex,
                ),
              // ターン切替オーバーレイ
              if (showTurn.value != null)
                TurnEndOverlay(
                  prevCount: showTurn.value!.turnCount - 1,
                  turnCount: showTurn.value!.turnCount,
                  prevIsMe: showTurn.value!.turnActor == playerId,
                  isMe: showTurn.value!.turnActor != playerId,
                  onComplete: () => showTurn.value = null,
                ),
              // ドロー時の光る枠
              if (isDrawing.value)
                DeckGlow(
                  isEnemy: drawerId.value != me.playerId,
                  onComplete: () => isDrawing.value = false,
                ),
            ],
          ),
        ),
      ),
      // FAB 押下時の処理
      floatingActionButton: StylishFAB(
        isMyTurn: state.turnState.turnActor == me.playerId,
        isStartPhase: state.turnState.phase == TurnPhase.startTurn,
        isPlayPhase: state.turnState.phase == TurnPhase.playCard,
        isApChargePhase: state.turnState.phase == TurnPhase.chargeAP,
        startPhaseText: 'スタートフェーズ',
        playPhaseText: 'APチャージへ',
        apChargePhaseText: 'チャージカード選択',
        onPressed: () async {
          if (state.turnState.turnActor != me.playerId ||
              state.turnState.phase != TurnPhase.playCard) return;
          await showDialog(
            context: context,
            barrierColor: Colors.transparent,
            builder: (_) => BattleModal(
              onClose: () {
                selectedChargeHnadIndex.value = [];
                Navigator.of(context).pop();
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'APにチャージ',
                    style: TextStyle(color: Colors.white, fontSize: 18.sp),
                  ),
                  SizedBox(height: 16.w),
                  ValueListenableBuilder<List<int>>(
                    valueListenable: selectedChargeHnadIndex,
                    builder: (ctx, selectedList, _) => Wrap(
                      spacing: 8.w,
                      runSpacing: 8.w,
                      alignment: WrapAlignment.center,
                      children: me.hand.asMap().entries.map((e) {
                        final i = e.key;
                        final card = e.value;
                        final isSel = selectedList.contains(i);
                        return Container(
                          decoration: BoxDecoration(
                            border: isSel
                                ? Border.all(
                                    color: Colors.yellowAccent, width: 3.w)
                                : Border.all(
                                    color: Colors.transparent, width: 3.w),
                            borderRadius: BorderRadius.circular(4.w),
                          ),
                          child: CardFrame(
                            card: card,
                            width: 72.w,
                            onTap: () {
                              final newList = List<int>.from(selectedList);
                              isSel ? newList.remove(i) : newList.add(i);
                              selectedChargeHnadIndex.value = newList;
                            },
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  SizedBox(height: 16.w),
                  BattleButton(
                    text: '確定してターンを終了',
                    type: ButtonType.positive,
                    onPressed: () {
                      final cardIds = selectedChargeHnadIndex.value
                          .map((i) => me.hand[i].id)
                          .toList();
                      processor.chargeApFromHandCommand(cardIds);
                      processor.turnEndCommand();
                      selectedChargeHnadIndex.value = [];
                      selectedHandIndex.value = null;
                      Navigator.of(context).pop();
                    },
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// フェーズに応じてラベルを切り替えられるスタイリッシュFAB
class StylishFAB extends HookWidget {
  /// 自分のターンかどうか
  final bool isMyTurn;

  /// 開始フェーズ中かどうか
  final bool isStartPhase;

  /// プレイフェーズ中かどうか
  final bool isPlayPhase;

  /// APチャージフェーズ中かどうか
  final bool isApChargePhase;

  /// 各フェーズで表示するテキスト
  final String startPhaseText;
  final String playPhaseText;
  final String apChargePhaseText;

  /// ターン外（相手ターン）に表示するテキスト
  final String opponentTurnText;

  /// 押下可能かどうか
  final bool isEnabled;

  /// 押下時コールバック
  final VoidCallback onPressed;

  /// グラデーションを外から差し替え可
  final Gradient? activeGradient;
  final Gradient? disabledGradient;

  const StylishFAB({
    super.key,
    required this.isMyTurn,
    required this.isStartPhase,
    required this.isPlayPhase,
    required this.isApChargePhase,
    required this.startPhaseText,
    required this.playPhaseText,
    required this.apChargePhaseText,
    this.opponentTurnText = '相手のターン',
    this.isEnabled = true,
    required this.onPressed,
    this.activeGradient,
    this.disabledGradient,
  });

  @override
  Widget build(BuildContext context) {
    // 押下アニメーション用
    final pressed = useState(false);
    final scaleAnim = useAnimationController(
      duration: const Duration(milliseconds: 100),
      lowerBound: 0.92,
      upperBound: 1.0,
      initialValue: 1.0,
    );
    useEffect(() {
      if (pressed.value) {
        scaleAnim.reverse();
      } else {
        scaleAnim.forward();
      }
      return null;
    }, [pressed.value]);

    // ラベル決定ロジック
    String label;
    if (!isMyTurn) {
      label = opponentTurnText;
    } else if (isStartPhase) {
      label = startPhaseText;
    } else if (isPlayPhase) {
      label = playPhaseText;
    } else if (isApChargePhase) {
      label = apChargePhaseText;
    } else {
      label = ''; // どれにも当てはまらない場合は空文字
    }

    // グラデーション
    final gActive = activeGradient ??
        LinearGradient(
          colors: isMyTurn
              ? [Colors.greenAccent, Colors.teal]
              : [Colors.grey, Colors.grey.shade600],
        );
    final gDisabled = disabledGradient ??
        LinearGradient(colors: [Colors.grey.shade400, Colors.grey.shade600]);

    return GestureDetector(
      onTapDown: (_) {
        if (isEnabled) pressed.value = true;
      },
      onTapUp: (_) {
        if (isEnabled) {
          pressed.value = false;
          onPressed();
        }
      },
      onTapCancel: () => pressed.value = false,
      child: AnimatedBuilder(
        animation: scaleAnim,
        builder: (_, child) => Transform.scale(
          scale: scaleAnim.value,
          child: child,
        ),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 14.h),
          decoration: BoxDecoration(
            gradient: isEnabled ? gActive : gDisabled,
            borderRadius: BorderRadius.circular(30.w),
            boxShadow: [
              BoxShadow(
                color: Colors.black38,
                blurRadius: isEnabled ? 12.w : 6.w,
                offset: Offset(0, isEnabled ? 6.w : 3.w),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isMyTurn ? Icons.flash_on : Icons.hourglass_empty,
                color: Colors.white,
                size: 24.sp,
              ),
              SizedBox(width: 8.w),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                child: Text(
                  label,
                  key: ValueKey(label),
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18.sp,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// PlayerArea はゴミ箱、キャラクターゾーン、AP/デッキ、手札を表示します。
class PlayerArea extends StatelessWidget {
  /// プレイヤーまたは敵の識別名
  final String name;

  /// 手札のカードリスト
  final List<CardModel> hand;

  /// フィールド上のキャラクターリスト
  final List<CharacterState> field;

  /// 山札のカードリスト
  final List<CardModel> deck;

  /// トラッシュ（捨て札）のカードリスト
  final List<CardModel> trash;

  /// APとしてチャージされたカードリスト
  final List<CardModel> ap;

  /// 敵エリアかどうか
  final bool isEnemy;

  /// 使用可能なカードのIndex
  final List<int> playableCardsIndexes;

  // 追加: カードタップ時のコールバック
  final void Function(int index)? onCardTap;

  final String? highlightCharacterId;

  const PlayerArea(
      {super.key,
      required this.name,
      required this.hand,
      required this.field,
      required this.deck,
      required this.trash,
      required this.ap,
      required this.isEnemy,
      required this.playableCardsIndexes,
      this.onCardTap,
      required this.highlightCharacterId});

  @override
  Widget build(BuildContext context) {
    // 3D傾き角度と縮小率を設定
    final angle = isEnemy ? math.pi / 10 : -math.pi / 10;
    final scale = isEnemy ? 0.92 : 1.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ボードエリア（トラッシュ／キャラクター／AP・デッキ）
        Transform(
          alignment: Alignment.center,
          transform: Matrix4.identity()
            ..setEntry(3, 2, 0.001) // 遠近感
            ..rotateX(angle)
            ..scale(scale),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // トラッシュゾーン
              TrashZone(items: trash),
              SizedBox(width: _C.pad),
              // キャラクターゾーン（中央に広がる）
              Expanded(
                child: CharacterZone(
                  field: field,
                  isEnemy: isEnemy,
                  highlightCharacterId: highlightCharacterId,
                ),
              ),
              SizedBox(width: _C.pad),
              Column(
                children: [
                  // AP／デッキゾーン
                  APZone(ap: ap),
                  SizedBox(height: _C.pad / 2),
                  // デッキゾーン
                  Zone<CardModel>(
                    items: deck,
                    background: Colors.blue.shade400,
                    emptyLabel: 'デッキ',
                    builder: (list) => CardFrame(
                      card: list.last,
                      width: _C.small,
                      showBack: true,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        SizedBox(height: _C.pad),
        // 手札ゾーン
        HandZone(
            hand: hand,
            isEnemy: isEnemy,
            onCardTap: onCardTap, // index を渡します
            playableCardsIndexes: playableCardsIndexes),
      ],
    );
  }
}

/// 汎用ゾーンウィジェット。
/// 項目が空ならテキスト、そうでなければ [builder] で描画します。
class Zone<T> extends StatelessWidget {
  final List<T> items; // ゾーン内のアイテムリスト
  final Color background; // 背景色
  final String emptyLabel; // 空時に表示するラベル
  final Widget Function(List<T>) builder; // 非空時に描画する関数

  const Zone({
    super.key,
    required this.items,
    required this.background,
    required this.emptyLabel,
    required this.builder,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: _C.small,
      height: _C.big,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(_C.pad / 2),
      ),
      child: items.isEmpty
          ? Center(
              child: Text(
                emptyLabel,
                style: TextStyle(
                  fontSize: _C.font,
                  color: background.withOpacity(0.8),
                ),
                textAlign: TextAlign.center,
              ),
            )
          : builder(items),
    );
  }
}

/// スタックカードゾーン（APZone／TrashZone 共通）
/// - items: カードリスト
/// - background: 背景色
/// - badgeColor: バッジ背景色
/// - showCount: バッジに枚数を出すか
class StackedCardZone extends HookWidget {
  final List<CardModel> items;
  final Color background;
  final Color badgeColor;
  final bool showCount;

  const StackedCardZone({
    super.key,
    required this.items,
    required this.background,
    required this.badgeColor,
    this.showCount = true,
  });

  @override
  Widget build(BuildContext context) {
    // 前回のアイテム数
    final prevLen = useRef<int>(items.length);
    final diff = (items.length - prevLen.value).clamp(0, items.length);

    // build 後に更新
    useEffect(() {
      prevLen.value = items.length;
      return null;
    }, [items.length]);

    final visibleCount = items.length < 3 ? items.length : 3;

    return Container(
      width: _C.small,
      height: _C.big,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(4.w),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 後ろから visibleCount 枚を順に重ねる
          for (int j = 0; j < visibleCount; j++)
            Builder(builder: (_) {
              final idx = items.length - visibleCount + j;
              final card = items[idx];
              final isNew = idx >= items.length - diff;
              final delay = Duration(
                milliseconds: (idx - (items.length - diff)) * 200,
              );

              return Stack(
                alignment: Alignment.center,
                children: [
                  // ここで必ずキーを振る！
                  _FlippingCard(
                    key: ValueKey(card.id),
                    card: card,
                    width: _C.small,
                    delay: isNew ? delay : Duration.zero,
                  ),
                  if (isNew)
                    _FloatingPlus(
                      key: ValueKey('plus-${card.id}'),
                      delay: delay,
                      color: badgeColor,
                    ),
                ],
              );
            }),

          // 枚数バッジ
          Positioned(
            bottom: _C.pad / 2,
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.w),
              decoration: BoxDecoration(
                color: badgeColor,
                borderRadius: BorderRadius.circular(8.w),
              ),
              child: Text(
                items.length.toString(),
                style: TextStyle(
                  fontSize: _C.fontSmall,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Y 軸回転で「ペラッ」とめくるアニメーション
class _FlippingCard extends HookWidget {
  final CardModel card;
  final double width;
  final Duration delay;
  const _FlippingCard({
    super.key,
    required this.card,
    required this.width,
    this.delay = Duration.zero,
  });

  @override
  Widget build(BuildContext context) {
    final controller =
        useAnimationController(duration: const Duration(milliseconds: 600));
    final anim = Tween<double>(begin: math.pi / 6, end: 0).animate(
      CurvedAnimation(parent: controller, curve: Curves.easeOutBack),
    );

    useEffect(() {
      var isActive = true; // ウィジェットが生きているかを示すフラグ
      final timer = Timer(delay, () {
        if (isActive) {
          controller.forward();
        }
      });
      return () {
        isActive = false;
        timer.cancel();
      };
    }, [delay]);

    return AnimatedBuilder(
      animation: controller,
      builder: (_, child) {
        if (controller.status == AnimationStatus.dismissed &&
            controller.value == 0.0) {
          return const SizedBox.shrink();
        }
        return Transform(
          alignment: Alignment.center,
          transform: Matrix4.identity()
            ..setEntry(3, 2, 0.001)
            ..rotateY(anim.value),
          child: child,
        );
      },
      child: CardFrame(card: card, width: width),
    );
  }
}

/// 浮かび上がる「＋」マークエフェクト
class _FloatingPlus extends HookWidget {
  final Duration delay;
  final Color color;
  const _FloatingPlus({
    super.key,
    required this.delay,
    this.color = Colors.white,
  });

  @override
  Widget build(BuildContext context) {
    final controller =
        useAnimationController(duration: const Duration(milliseconds: 600));
    final anim = CurvedAnimation(parent: controller, curve: Curves.easeOut);

    useEffect(() {
      var isActive = true;
      final timer = Timer(delay, () {
        if (isActive) {
          controller.forward();
        }
      });
      return () {
        isActive = false;
        timer.cancel();
      };
    }, [delay]);

    return FadeTransition(
      opacity: Tween<double>(begin: 0.0, end: 1.0).animate(anim),
      child: ScaleTransition(
        scale: Tween<double>(begin: 0.5, end: 1.2).animate(anim),
        child: Text(
          '+',
          style: TextStyle(
            fontSize: 24.sp,
            fontWeight: FontWeight.bold,
            color: color,
            shadows: [
              Shadow(
                  color: Colors.black45,
                  blurRadius: 4.sp,
                  offset: Offset(1.sp, 1.sp)),
            ],
          ),
        ),
      ),
    );
  }
}

// トラッシュゾーン
class TrashZone extends StatelessWidget {
  final List<CardModel> items;
  const TrashZone({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return StackedCardZone(
      items: items,
      background: Colors.grey.shade500,
      badgeColor: Colors.black54,
      showCount: true,
    );
  }
}

// APゾーン
class APZone extends HookWidget {
  final List<CardModel> ap;
  final bool isEnemy;
  const APZone({super.key, required this.ap, this.isEnemy = false});

  @override
  Widget build(BuildContext context) {
    return StackedCardZone(
      items: ap,
      background: isEnemy ? Colors.grey.shade700 : Colors.orange.shade300,
      badgeColor: isEnemy ? Colors.redAccent : Colors.blueAccent,
      showCount: true,
    );
  }
}

class HandZone extends HookWidget {
  final List<CardModel> hand;
  final bool isEnemy;
  final List<int> playableCardsIndexes;
  final void Function(int index)? onCardTap;

  const HandZone({
    super.key,
    required this.hand,
    this.isEnemy = false,
    this.playableCardsIndexes = const [],
    this.onCardTap,
  });

  @override
  Widget build(BuildContext context) {
    final count = hand.length;

    // 枚数変化で再アニメーション
    final controller = useAnimationController(
      duration: const Duration(milliseconds: 400),
    );
    final anim = CurvedAnimation(parent: controller, curve: Curves.easeOut);
    useEffect(() {
      controller.forward(from: 0);
      return null;
    }, [count]);

    final w = MediaQuery.of(context).size.width;
    final cardW = _C.handBase * (isEnemy ? 0.5 : 1);

    // 隣接カードの水平間隔（カード幅×0.9）→ 10%重なり
    final spacing = cardW * 0.9;
    // 扇形の最大開き角度（ラジアン）
    const maxAngle = 30 * math.pi / 180;
    final centerIndex = (count - 1) / 2;

    return SizedBox(
      width: w,
      height: isEnemy ? cardW * 1.2 : cardW * 1.4 + _C.handMargin * 2,
      child: (count == 0)
          ? const SizedBox.shrink()
          : AnimatedBuilder(
              animation: anim,
              builder: (_, __) => Stack(
                clipBehavior: Clip.none,
                children: List.generate(count, (i) {
                  // 扇形角度
                  final angle = count == 1
                      ? 0.0
                      : -maxAngle / 2 + (i / (count - 1)) * maxAngle;
                  // 水平オフセット（アニメーション t でスライドイン）
                  final dx = (i - centerIndex) * spacing * anim.value;
                  // 左端起点
                  final left = w / 2 - cardW / 2 + dx;
                  final bottom = _C.handMargin;

                  return Positioned(
                    left: left,
                    bottom: bottom,
                    child: Transform.rotate(
                      angle: angle * anim.value,
                      alignment: Alignment.center,
                      child: Container(
                        decoration: playableCardsIndexes.contains(i)
                            ? BoxDecoration(boxShadow: [
                                BoxShadow(
                                  color: Colors.lightGreenAccent,
                                  blurRadius: 8.sp,
                                  spreadRadius: 1.sp,
                                )
                              ])
                            : null,
                        child: CardFrame(
                          card: hand[i],
                          width: cardW,
                          showBack: isEnemy,
                          onTap: isEnemy ? null : () => onCardTap?.call(i),
                        ),
                      ),
                    ),
                  );
                }),
              ),
            ),
    );
  }
}

/// フィールド上のキャラクターを表示します。1～3枚対応。
class CharacterZone extends StatelessWidget {
  final List<CharacterState> field; // フィールド上のキャラクター
  final bool isEnemy; // 敵ならHPバーを反転表示
  final String? highlightCharacterId; // ←追加

  const CharacterZone(
      {super.key,
      required this.field,
      required this.isEnemy,
      required this.highlightCharacterId});

  @override
  Widget build(BuildContext context) {
    final count = field.length;
    const largeBase = 104.0, normalBase = 60.0;
    final large = largeBase.w;
    final normal = normalBase.w;

    // HPバーをオーバーレイ表示する
    Widget overlayHpBar(CharacterState cs, double width) {
      final maxHp = cs.character.hp;
      final damage = cs.damageCount;
      final hp = (maxHp - damage).clamp(0, maxHp);
      final percent = maxHp > 0 ? hp / maxHp : 0.0;

      Widget bar = SizedBox(
        width: width * 0.66,
        child: Column(
          crossAxisAlignment:
              isEnemy ? CrossAxisAlignment.start : CrossAxisAlignment.end,
          children: [
            // 残HPテキスト
            Container(
              padding: EdgeInsets.symmetric(horizontal: _C.pad, vertical: 2.w),
              decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.8),
                  borderRadius: BorderRadius.circular(10.w)),
              child: Text('$hp',
                  style: TextStyle(
                      fontSize: 18.sp,
                      color: Colors.white,
                      fontWeight: FontWeight.bold)),
            ),
            SizedBox(height: 2.w),
            // HPゲージ
            Stack(children: [
              Container(
                  width: width * 0.4,
                  height: 10.w,
                  decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(5.w))),
              Container(
                  width: width * 0.4 * percent,
                  height: 10.w,
                  decoration: BoxDecoration(
                      color: percent > 0.5
                          ? Colors.green
                          : percent > 0.25
                              ? Colors.orange
                              : Colors.red,
                      borderRadius: BorderRadius.circular(5.w))),
            ]),
          ],
        ),
      );

      if (isEnemy) bar = Transform.rotate(angle: math.pi, child: bar);
      return Positioned(top: -12.w, right: -8.w, child: bar);
    }

    // カードとHPバーを重ねる
    Widget characterCard(CharacterState cs, double width) =>
        Stack(clipBehavior: Clip.none, children: [
          CharacterCardWidget(
            charState: cs, width: width,
            showPlayIndicator: cs.uuid == highlightCharacterId, // ←追加
          ),
          overlayHpBar(cs, width),
        ]);

    // キャラクター数に応じた配置
    if (count == 3) {
      return SizedBox(
          width: 120.w,
          height: 200.h,
          child: Stack(
              alignment: Alignment.center,
              clipBehavior: Clip.none,
              children: [
                Positioned(top: 0, child: characterCard(field[0], large)),
                Positioned(
                    bottom: 0,
                    right: 8.w,
                    child: characterCard(field[1], normal)),
                Positioned(
                    bottom: 0,
                    left: 8.w,
                    child: characterCard(field[2], normal))
              ]));
    }
    if (count == 2) {
      return SizedBox(
          width: 80.w,
          height: 80.w,
          child: Stack(clipBehavior: Clip.none, children: [
            Positioned(
                top: 0,
                left: 80.w / 2 - large / 2,
                child: characterCard(field[0], large)),
            Positioned(
                bottom: 0,
                left: 80.w / 2 - normal / 2,
                child: characterCard(field[1], normal))
          ]));
    }
    if (count == 1) return characterCard(field[0], large);
    return const SizedBox.shrink();
  }
}

class CharacterCardWidget extends HookWidget {
  final CharacterState charState;
  final double width;
  final bool showPlayIndicator;

  const CharacterCardWidget({
    super.key,
    required this.charState,
    required this.width,
    required this.showPlayIndicator,
  });

  @override
  Widget build(BuildContext context) {
    // 1) 前回のダメージ累計を保持
    final lastDamageRef = useRef<int>(charState.damageCount);

    // 2) ポップテキスト表示フラグと値
    final showPop = useState<bool>(false);
    final popAmount = useState<int>(0);
    final isHeal = useState<bool>(false);

    // 3) アニメーションコントローラ
    // ── カード本体（ダメージ点滅用／1秒）
    final cardCtrl =
        useAnimationController(duration: const Duration(seconds: 1));
    final slideAnim = TweenSequence<Offset>([
      TweenSequenceItem(
          tween: Tween(begin: Offset.zero, end: Offset(0, .1)), weight: 500),
      TweenSequenceItem(tween: ConstantTween(Offset(0, .1)), weight: 200),
      TweenSequenceItem(
          tween: Tween(begin: Offset(0, .1), end: Offset.zero), weight: 300),
    ]).animate(cardCtrl);
    final blinkAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1, end: .5), weight: 250),
      TweenSequenceItem(tween: Tween(begin: .5, end: 1), weight: 250),
      TweenSequenceItem(tween: Tween(begin: 1, end: .5), weight: 250),
      TweenSequenceItem(tween: Tween(begin: .5, end: 1), weight: 250),
    ]).animate(cardCtrl);

    // ── ポップテキスト用（2秒）
    final textCtrl =
        useAnimationController(duration: const Duration(seconds: 2));
    final textSlide = Tween<Offset>(
      begin: const Offset(0, .3),
      end: const Offset(0, -.3),
    ).animate(CurvedAnimation(parent: textCtrl, curve: Curves.easeOut));
    final textFade = Tween<double>(begin: 1, end: 0).animate(
      CurvedAnimation(parent: textCtrl, curve: Curves.easeIn),
    );

    // 4) ダメージ/回復検知 & アニメ起動 & lastDamageRef 更新
    useEffect(() {
      final diff = charState.damageCount - lastDamageRef.value;
      if (diff != 0) {
        popAmount.value = diff.abs();
        isHeal.value = diff < 0;
        showPop.value = true;

        // テキストアニメ再生
        textCtrl
          ..reset()
          ..forward();

        // ダメージならカード点滅も
        if (diff > 0) {
          cardCtrl
            ..reset()
            ..forward();
        }

        lastDamageRef.value = charState.damageCount;
      }
      return null;
    }, [charState.damageCount]);

    // 5) テキストアニメ完了で非表示に戻す
    useEffect(() {
      void listener(AnimationStatus status) {
        if (status == AnimationStatus.completed) {
          showPop.value = false;
        }
      }

      textCtrl.addStatusListener(listener);
      return () => textCtrl.removeStatusListener(listener);
    }, []);

    // 6) ポップテキストウィジェットを組み立て
    Widget? popText;
    if (showPop.value) {
      final txt = isHeal.value ? '+${popAmount.value}' : '-${popAmount.value}';
      final color = isHeal.value ? Colors.lightGreenAccent : Colors.redAccent;

      popText = SlideTransition(
        position: textSlide,
        child: FadeTransition(
          opacity: textFade,
          child: OutlinedText(
            text: txt,
            strokeWidth: 4.sp,
            style: TextStyle(
              fontSize: (width * 0.4).sp,
              fontWeight: FontWeight.bold,
              color: color,
              shadows: [
                Shadow(
                    color: Colors.black45,
                    blurRadius: 4.sp,
                    offset: Offset(1.sp, 1.sp))
              ],
            ),
          ),
        ),
      );
    }

    return Stack(
      alignment: Alignment.center,
      children: [
        // キャラ本体に位置＋点滅アニメ適用
        SlideTransition(
          position: slideAnim,
          child: FadeTransition(
            opacity: blinkAnim,
            child: CardFrame(
              card: charState.character,
              width: width,
              showBack: charState.damageCount >= charState.character.hp,
            ),
          ),
        ),

        // プレイ時インジケータ（三角形）
        if (showPlayIndicator)
          _PlayTriangleOverlay(width: width, height: width * 1.4),

        // ポップテキスト
        if (popText != null) popText,
      ],
    );
  }
}

/// キャラプレイ時に三角を上から被せるオーバーレイ
class _PlayTriangleOverlay extends HookWidget {
  final double width;
  final double height;

  const _PlayTriangleOverlay({
    required this.width,
    required this.height,
  });

  @override
  Widget build(BuildContext context) {
    // 2秒かけてフェードアウト
    final controller = useAnimationController(
      duration: const Duration(milliseconds: 4000),
    );
    final fade = CurvedAnimation(parent: controller, curve: Curves.easeOut);

    // mount 時にアニメーション開始
    useEffect(() {
      controller.forward();
      return null;
    }, []);

    return Positioned.fill(
      child: IgnorePointer(
        child: FadeTransition(
          opacity: Tween<double>(begin: 1.0, end: 0.0).animate(fade),
          child: CustomPaint(
            size: Size(width, height),
            painter: _TrianglePainter(
              color: Colors.redAccent.withOpacity(0.6),
            ),
          ),
        ),
      ),
    );
  }
}

/// 三角形を描く CustomPainter
class _TrianglePainter extends CustomPainter {
  final Color color;
  _TrianglePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path()
      ..moveTo(size.width / 2, 0) // 頂点
      ..lineTo(size.width, size.height) // 右下
      ..lineTo(0, size.height) // 左下
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _TrianglePainter old) => old.color != color;
}

/// プレイされたカードを中央で拡大 → 上部へ飛ばすアニメーション
/// プレイされたカードを中央から少し上に移動＆フェードアウトさせるアニメーション
class PlayedCardFlyAnimation extends HookWidget {
  final CardModel card;
  final VoidCallback onEnd;
  const PlayedCardFlyAnimation({
    super.key,
    required this.card,
    required this.onEnd,
  });

  @override
  Widget build(BuildContext context) {
    // アニメーションコントローラ：800ms
    final controller = useAnimationController(
      duration: const Duration(milliseconds: 1600),
    )..forward();

    // 上方向への移動量：0 → -20.sp
    final slideAnim = Tween<double>(
      begin: 0,
      end: -20.sp,
    ).animate(
      CurvedAnimation(parent: controller, curve: Curves.easeOut),
    );

    // フェードアウト：1 → 0
    final fadeAnim = Tween<double>(
      begin: 1.0,
      end: 0.0,
    ).animate(
      CurvedAnimation(parent: controller, curve: Curves.easeIn),
    );

    // アニメ完了で onEnd コール
    useEffect(() {
      void listener(AnimationStatus status) {
        if (status == AnimationStatus.completed) {
          onEnd();
        }
      }

      controller.addStatusListener(listener);
      return () => controller.removeStatusListener(listener);
    }, [controller]);

    // 固定サイズ＆中央配置の計算
    final cardWidth = 300.w;
    final cardHeight = cardWidth * (417 / 300);
    final screenW = MediaQuery.of(context).size.width;
    final startLeft = (screenW - cardWidth) / 2;
    final startTop = (MediaQuery.of(context).size.height - cardHeight) / 2;

    return AnimatedBuilder(
      animation: controller,
      builder: (ctx, child) {
        return Positioned(
          left: startLeft,
          top: startTop + slideAnim.value,
          width: cardWidth,
          height: cardHeight,
          child: Opacity(
            opacity: fadeAnim.value,
            child: child,
          ),
        );
      },
      child: CardFrame(card: card, width: cardWidth),
    );
  }
}

/// 全画面オーバーレイで表示するターン切り替えアニメーション
class TurnEndOverlay extends HookWidget {
  /// 前回のターン番号
  final int prevCount;

  /// 新しいターン番号
  final int turnCount;

  /// 前回のターンが自分か
  final bool prevIsMe;

  /// 次のターンが自分か
  final bool isMe;

  /// 開始遅延
  final Duration delay;

  /// アニメ完了後に呼ばれる
  final VoidCallback onComplete;

  const TurnEndOverlay({
    super.key,
    required this.prevCount,
    required this.turnCount,
    required this.prevIsMe,
    required this.isMe,
    required this.onComplete,
    this.delay = const Duration(milliseconds: 0),
  });

  @override
  Widget build(BuildContext context) {
    // コントローラ
    final controller = useAnimationController(
      duration: const Duration(milliseconds: 2000),
    );
    // 遅延スタート
    useEffect(() {
      Future.delayed(delay, () => controller.forward());
      return;
    }, [delay]);

    // フェード
    final fadeIn = CurvedAnimation(
      parent: controller,
      curve: const Interval(0.0, 0.2, curve: Curves.easeIn),
    );
    final fadeOut = CurvedAnimation(
      parent: controller,
      curve: const Interval(0.8, 1.0, curve: Curves.easeOut),
    );

    // スライド
    final slide = Tween<Offset>(
      begin: const Offset(0, -0.3),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
          parent: controller,
          curve: const Interval(0.0, 0.4, curve: Curves.easeOut)),
    );

    // メインスケール
    final scaleMain = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(
          parent: controller,
          curve: const Interval(0.0, 0.4, curve: Curves.elasticOut)),
    );

    // アイコン回転
    final iconAnim = Tween<double>(
      begin: 0,
      end: math.pi,
    ).animate(
      CurvedAnimation(
          parent: controller,
          curve: const Interval(0.4, 0.7, curve: Curves.easeInOut)),
    );

    // 数字アニメーション
    final countAnim =
        Tween<double>(begin: prevCount.toDouble(), end: turnCount.toDouble())
            .animate(
      CurvedAnimation(
          parent: controller,
          curve: const Interval(0.2, 0.6, curve: Curves.easeInOut)),
    );

    // 完了通知
    useEffect(() {
      void listener(AnimationStatus status) {
        if (status == AnimationStatus.completed) onComplete();
      }

      controller.addStatusListener(listener);
      return () => controller.removeStatusListener(listener);
    }, [controller]);

    return AnimatedBuilder(
      animation: controller,
      builder: (context, child) {
        double opacityValue;
        final t = controller.value;
        if (t < 0.2) {
          opacityValue = fadeIn.value;
        } else if (t < 0.8)
          // ignore: curly_braces_in_flow_control_structures
          opacityValue = 1.0;
        else
          // ignore: curly_braces_in_flow_control_structures
          opacityValue = 1.0 - fadeOut.value;

        return Opacity(
          opacity: opacityValue,
          child: child,
        );
      },
      child: Container(
        color: Colors.black54,
        alignment: Alignment.center,
        child: SlideTransition(
          position: slide,
          child: ScaleTransition(
            scale: scaleMain,
            child: Container(
              padding: EdgeInsets.all(24.w),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: isMe
                      ? [Colors.greenAccent, Colors.lightGreen]
                      : [Colors.redAccent, Colors.deepOrangeAccent],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16.w),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black54,
                    blurRadius: 8.w,
                    offset: Offset(0, 4.w),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // TURNラベル
                  Text(
                    'TURN',
                    style: TextStyle(
                      fontSize: 24.sp,
                      letterSpacing: 4,
                      color: Colors.white70,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  // カウントアップ
                  SizedBox(
                    height: 80.h,
                    child: AnimatedBuilder(
                      animation: countAnim,
                      builder: (ctx, _) {
                        final cnt = countAnim.value.round();
                        return Text(
                          '$cnt',
                          style: TextStyle(
                            fontSize: 64.sp,
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            shadows: [
                              Shadow(
                                color: Colors.black87,
                                blurRadius: 6.sp,
                                offset: Offset(2.sp, 2.sp),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                  SizedBox(height: 16.w),
                  // アイコン回転で direction change
                  RotationTransition(
                    turns: iconAnim.drive(Tween(begin: 0.0, end: 1.0)),
                    child: Icon(
                      isMe ? Icons.flash_on : Icons.shield,
                      color: Colors.white70,
                      size: 36.sp,
                    ),
                  ),
                  SizedBox(height: 8.w),
                  Text(
                    isMe ? '自分の番' : '相手の番',
                    style: TextStyle(
                      fontSize: 28.sp,
                      color: Colors.white70,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// デッキ位置に一度だけ光る枠を表示するエフェクト
/// - isEnemy: 敵側なら true（左側・奥寄り）、自分側なら false（右側・手前寄り）
/// - onComplete: アニメ完了後コールバック
class DeckGlow extends HookWidget {
  final bool isEnemy;
  final VoidCallback onComplete;

  const DeckGlow({
    super.key,
    this.isEnemy = false,
    required this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    // コントローラ：400ms で一度だけアニメーション
    final ctrl = useAnimationController(
      duration: const Duration(milliseconds: 200),
    )..forward();

    // 拡大アニメーション（1.0 → 1.4）
    final scale = Tween<double>(begin: 1.0, end: 1.8).animate(
      CurvedAnimation(parent: ctrl, curve: Curves.easeOut),
    );
    // フェードアニメーション（0.8 → 0.0）
    final opacity = Tween<double>(begin: 0.8, end: 0.0).animate(
      CurvedAnimation(parent: ctrl, curve: Curves.easeIn),
    );

    // 完了通知
    useEffect(() {
      void listener(AnimationStatus s) {
        if (s == AnimationStatus.completed) onComplete();
      }

      ctrl.addStatusListener(listener);
      return () => ctrl.removeStatusListener(listener);
    }, [ctrl]);

    // 自分／敵それぞれの Align 位置を計算
    // Flutter の Alignment は x,y が -1.0〜1.0
    // 自分：右側(x=1), 手前(下)から2/5→ y = 1 - (2/5)*2 = 0.2
    // 敵  ：左側(x=-1), 奥(上) から3/10→ y = -1 + (3/10)*2 = -0.4
    final alignment =
        isEnemy ? const Alignment(-0.9, -0.55) : const Alignment(0.9, 0.2);

    return Align(
      alignment: alignment,
      child: ScaleTransition(
        scale: scale,
        child: FadeTransition(
          opacity: opacity,
          child: Container(
            width: _C.small, // デッキと同じサイズ
            height: _C.big,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(4.w),
              // グローの色は自分なら緑、敵なら赤
              boxShadow: [
                BoxShadow(
                  color: isEnemy
                      ? Colors.redAccent.withOpacity(0.7)
                      : Colors.lightGreenAccent.withOpacity(0.7),
                  blurRadius: 12.w,
                  spreadRadius: 4.w,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// レイアウトやサイズの共通定数
class _C {
  static final pad = 8.w; // 基本パディング
  static final small = 40.w; // スタックカード幅
  static final big = 70.w; // スタックカード高さ
  static final font = 14.sp; // 標準フォントサイズ
  static final fontSmall = 12.sp; // 小フォントサイズ
  static final handBase = 72.w; // 手札カード基本幅
  static final handMargin = 12.w; // 手札左右マージン
}
