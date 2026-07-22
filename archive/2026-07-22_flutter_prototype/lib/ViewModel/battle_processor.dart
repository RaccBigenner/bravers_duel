import 'dart:math';

import 'package:bravers_duel/Model/battle_state.dart';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Model/turn_state.dart';
import 'package:bravers_duel/Repository/card_data.dart';
import 'package:bravers_duel/main.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// BattleProcessor は BattleState を管理・公開するだけの最小実装です。
/// UI 側は ref.watch(battleProcessorProvider) で状態を取得し、
/// state.events の更新を検知してアニメ処理などを行います。
class BattleProcessor extends StateNotifier<BattleState> {
  BattleProcessor(super.initial);

  // ここをFirebaseにする
  Future<void> updateState(BattleState newState) async {
    state = newState;
  }

  bool hostIsMe() {
    return state.host.playerId == playerId;
  }

  PlayerState me() {
    return hostIsMe() ? state.host : state.guest;
  }

  PlayerState enemy() {
    return hostIsMe() ? state.guest : state.host;
  }

  /// BattleEvent を追加
  Future<void> addEvent(BattleEvent event) async {
    final nextSeq = state.events.isEmpty ? 1 : state.events.last.seq + 1;
    final newEvent = event.copyWith(seq: nextSeq);
    await updateState(state.copyWith(events: [...state.events, newEvent]));
  }

  Future<void> applyEvent(BattleEvent event) async {
    print('実行: ${event.toString()}');
    // イベントを処理済みにするため processedSeq を event.seq に更新
    final isHostActor = state.host.playerId == event.actorId;

    if (event.actorId == me().playerId) {
      switch (event.type) {
        case 'draw':
          await drawMyCards(count: event.value, isMe: true);
        case 'chargeApFromHand':
          await chargeCardToAp(cardIds: event.targets, isMe: true);
        case 'turnEnd':
          await changeTurn();
        case 'processPhase':
          await processPhase();
        case 'playCard':
          await playCard(isMe: true, cardId: event.targets[0]);
        case 'damageToEnemy':
          await damageToEnemy(
              targetIds: event.targets,
              damageValue: event.value,
              eventActor: event.actorId);

        case 'healCharacter':
          await healMyCharacter(
              targetIds: event.targets,
              healValue: event.value,
              eventActor: event.actorId);
        default:
      }
    }

    print("敵かどうかの判定：${enemy().playerId}：${event.actorId == enemy().playerId}");

    if (event.actorId == enemy().playerId && true) {
      print('// 相手がAIの場合');
      // 相手がAIの場合
      switch (event.type) {
        case 'draw':
          await drawMyCards(count: event.value, isMe: false);
        case 'chargeApFromHand':
          await chargeCardToAp(cardIds: event.targets, isMe: false);
        case 'turnEnd':
          await changeTurn();
        case 'processPhase':
          await processPhase();
          await autoPlayCard(isMe: false);
          await autoChargeAp(isMe: false);
          await turnEndCommand();
        case 'damageToEnemy':
          await damageToEnemy(
              targetIds: event.targets,
              damageValue: event.value,
              eventActor: event.actorId);

        case 'healCharacter':
          await healMyCharacter(
              targetIds: event.targets,
              healValue: event.value,
              eventActor: event.actorId);

        default:
      }
    }

    if (isHostActor) {
      // host の processedSeq を更新
      await updateState(
        state.copyWith(host: state.host.copyWith(processedSeq: event.seq)),
      );
    } else {
      // guest の processedSeq を更新
      await updateState(
        state.copyWith(guest: state.guest.copyWith(processedSeq: event.seq)),
      );
    }

    // enemyががオートの場合
    if (true) {
      // host の processedSeq を更新
      await updateState(
        isHostActor
            ? state.copyWith(
                guest: state.guest.copyWith(processedSeq: event.seq))
            : state.copyWith(
                host: state.host.copyWith(processedSeq: event.seq)),
      );
    }
  }

  List<String> characterAttribute(CharacterCard card) {
    return card.attribute;
  }

  Future<void> playCardCommand(
      {required String playCharacterId,
      required List<String> targetCharacterIds,
      required CardModel card,
      bool isMe = true}) async {
    final player = isMe ? me() : enemy();

    await addEvent(BattleEvent(
        seq: 0,
        actorId: player.playerId,
        type: 'playCard',
        targets: [card.id],
        value: 0));

    card.when<Future<void>>(
      // キャラクターカードの場合の表示
      character: (id, vol, code, rarity, name, effectText, flavorText, size, hp,
          attr) async {
        await addEvent(BattleEvent(
            seq: 0,
            actorId: player.playerId,
            type: 'healCharacter',
            targets: [playCharacterId],
            value: 3));
      },

      // スキルカードの場合の表示
      skill: (id, vol, code, rarity, name, effectText, flavorText, costAp,
          condAttr, baseValue, valueType) async {
        switch (valueType) {
          case 'attack':
            await addEvent(BattleEvent(
                seq: 0,
                actorId: player.playerId,
                type: 'characterPlayCard',
                targets: [playCharacterId],
                value: 0));

            int damage() {
              return baseValue;
            }

            await addEvent(BattleEvent(
                seq: 0,
                actorId: player.playerId,
                type: 'damageToEnemy',
                targets: targetCharacterIds,
                value: damage()));

          default:
        }
      },

      // 装備カードの場合の表示
      equipment: (id, vol, code, rarity, name, effectText, flavorText,
          addAttr) async {},
      // フィールドカードの場合の表示
      field: (id, vol, code, rarity, name, effectText, flavorText) async {},
    );
  }

  /// 条件リスト `condition` が基底リスト `base` の多重集合サブセットかを判定します。
  /// - `condition` に同じ文字列が複数ある場合、その回数以上 `base` にも含まれている必要があります。
  bool isMuchAttribute(List<String> base, List<String> condition) {
    // base の各要素の出現回数を数える
    final Map<String, int> baseCounts = {};
    for (final s in base) {
      baseCounts[s] = (baseCounts[s] ?? 0) + 1;
    }

    // condition の各要素の出現回数を数えつつ、base 側と比較
    final Map<String, int> condCounts = {};
    for (final s in condition) {
      // condition 側のカウントを増やす
      condCounts[s] = (condCounts[s] ?? 0) + 1;
      // base 側のカウントが十分かチェック
      if ((baseCounts[s] ?? 0) < condCounts[s]!) {
        return false;
      }
    }

    // すべての要素が条件を満たす
    return true;
  }

  bool isPlayableCard(CardModel card) {
    return card.maybeWhen(
        skill: (id, vol, code, rarity, name, effectText, flavorText, costAp,
            condAttr, baseValue, valueType) {
          if (me().ap.length >= costAp &&
              isMuchAttribute(
                  me().characters[0].character.attribute, condAttr)) {
            return true;
          } else {
            return false;
          }
        },
        character: (id, vol, code, rarity, name, effectText, flavorText, size,
            hp, attribute) {
          if (me().characters.map((c) => c.character.id).contains(id)) {
            return true;
          } else {
            return false;
          }
        },
        orElse: () => false);
  }

  List<int> playableHandCardIndexes({required bool isMe}) {
    final hand = isMe ? me().hand : enemy().hand;
    List<int> indexes = [];

    for (var i = 0; i < hand.length; i++) {
      if (isPlayableCard(hand[i])) indexes.add(i);
    }

    return indexes;
  }

  Future<void> chargeApFromHandCommand(List<String> cardIds) async {
    final isMe = state.turnState.turnActor == me().playerId;
    final player = isMe ? me() : enemy();
    final chargeEvent = BattleEvent(
        seq: 0,
        actorId: player.playerId,
        type: 'chargeApFromHand',
        targets: cardIds,
        value: 0);

    await addEvent(chargeEvent);
  }

  Future<void> chargeCardToAp(
      {required bool isMe, required List<String> cardIds}) async {
    // 1) まずは現在の hand / ap をローカル変数にコピー
    final newHand = List<CardModel>.from(isMe
        ? hostIsMe()
            ? state.host.hand
            : state.guest.hand
        : hostIsMe()
            ? state.guest.hand
            : state.host.hand);
    final newAp = List<CardModel>.from(isMe
        ? hostIsMe()
            ? state.host.ap
            : state.guest.ap
        : hostIsMe()
            ? state.guest.ap
            : state.host.ap);

    // 2) チャージしたい cardId を順番に処理
    for (final cardId in cardIds) {
      // hand の中で最初にマッチする要素のインデックスを探す
      final idx = newHand.indexWhere((c) => c.id == cardId);
      if (idx == -1) continue; // 見つからなければスキップ

      // removeAt すると、その位置の要素だけが取り除かれる
      final card = newHand.removeAt(idx);
      // 取り出したカードを AP リストに追加
      newAp.add(card);
    }

    // 3) state を一度だけ更新
    await updateState(isMe
        ? hostIsMe()
            ? state.copyWith(
                host: state.host.copyWith(
                  hand: newHand,
                  ap: newAp,
                ),
              )
            : state.copyWith(
                guest: state.host.copyWith(
                  hand: newHand,
                  ap: newAp,
                ),
              )
        : hostIsMe()
            ? state.copyWith(
                guest: state.guest.copyWith(
                  hand: newHand,
                  ap: newAp,
                ),
              )
            : state.copyWith(
                host: state.host.copyWith(
                  hand: newHand,
                  ap: newAp,
                ),
              ));
  }

  Future<void> turnEndCommand() async {
    final turnActorId = state.turnState.turnActor == enemy().playerId
        ? enemy().playerId
        : me().playerId;

    final turnEndEvent = BattleEvent(
        seq: 0, actorId: turnActorId, type: 'turnEnd', targets: [], value: 0);

    await addEvent(turnEndEvent);
  }

  Future<void> drawCommand({required String actorId}) async {
    final drowCount =
        5 - (actorId == me().playerId ? me().hand.length : enemy().hand.length);

    final drowEvent = BattleEvent(
        seq: 0, actorId: actorId, type: 'draw', targets: [], value: drowCount);

    await addEvent(drowEvent);
  }

  Future<void> processPhaseCommand() async {
    final event = BattleEvent(
        seq: 0,
        actorId: state.turnState.turnActor,
        type: 'processPhase',
        targets: [],
        value: 0);

    await addEvent(event);
  }

  Future<void> changeTurn() async {
    print('ターンを変るよ！');
    final toMe = state.turnState.turnActor != me().playerId;

    await updateState(toMe
        ? state.copyWith(
            turnState: state.turnState.copyWith(
                turnActor: me().playerId,
                turnCount: state.turnState.turnCount + 1,
                phase: TurnPhase.startTurn),
          )
        : state.copyWith(
            turnState: state.turnState.copyWith(
                turnActor: enemy().playerId,
                turnCount: state.turnState.turnCount + 1,
                phase: TurnPhase.startTurn)));

    await drawCommand(actorId: toMe ? me().playerId : enemy().playerId);
    await processPhaseCommand();
  }

  /// 自分（host）または相手（guest）の山札から count 枚ドローして手札に追加する
  Future<List<CardModel>> drawMyCards(
      {required int count, required isMe}) async {
    // 対象の PlayerState を取得
    final player = hostIsMe()
        ? isMe
            ? state.host
            : state.guest
        : isMe
            ? state.guest
            : state.host;

    // 山札が不足していたら何もしない or エラー処理
    if (player.deck.length < count) {
      // ここで例外を投げる、ログを出すなどお好みで
      print('ドロー枚数($count)が山札枚数(${player.deck.length})を超えています');
      return [];
    }

    // deck の先頭 count 枚を取り出し、残りを newDeck に
    final drawn = player.deck.take(count).toList();
    final newDeck = player.deck.skip(count).toList();

    // 既存の手札に drawn を追加
    final newHand = [...player.hand, ...drawn];

    // state.host または state.guest を更新
    final newPlayerState = player.copyWith(
      deck: newDeck,
      hand: newHand,
    );

    final newState = isMe
        ? hostIsMe()
            ? state.copyWith(host: newPlayerState)
            : state.copyWith(guest: newPlayerState)
        : hostIsMe()
            ? state.copyWith(guest: newPlayerState)
            : state.copyWith(host: newPlayerState);

    // 状態更新（非同期処理なら await）
    await updateState(newState);

    return drawn;
  }

  Future<void> processPhase() async {
    await updateState(state.copyWith(
      turnState: state.turnState.copyWith(phase: TurnPhase.playCard),
    ));
  }

  Future<void> damageToEnemy(
      {required List<String> targetIds,
      required int damageValue,
      required String eventActor}) async {
    final target = eventActor == me().playerId ? enemy() : me();
    final newTargets = target.characters.map((c) {
      if (targetIds.contains(c.uuid)) {
        return c.copyWith(damageCount: c.damageCount + damageValue);
      } else {
        return c;
      }
    }).toList();

    // もしターゲットが自分なら
    await updateState(target.playerId == me().playerId
        // ホストが自分なら
        ? hostIsMe()
            // ホストのキャラクターを更新
            ? state.copyWith(host: state.host.copyWith(characters: newTargets))
            // そうじゃなければゲストのキャラクターを更新
            : state.copyWith(
                guest: state.guest.copyWith(characters: newTargets))
        // ホストが相手なら
        : hostIsMe()
            // ゲストのキャラクターを更新
            ? state.copyWith(
                guest: state.guest.copyWith(characters: newTargets))
            // そうじゃなければホストのキャラクターを更新
            : state.copyWith(
                host: state.host.copyWith(characters: newTargets)));
  }

  Future<void> healMyCharacter(
      {required List<String> targetIds,
      required int healValue,
      required String eventActor}) async {
    final target = eventActor == me().playerId ? me() : enemy();
    final newTargets = target.characters.map((c) {
      if (targetIds.contains(c.uuid)) {
        final newDamageCount =
            c.damageCount - min(healValue, c.damageCount).toInt();
        return c.copyWith(damageCount: newDamageCount);
      } else {
        return c;
      }
    }).toList();

    // もしターゲットが自分なら
    await updateState(target.playerId == me().playerId
        // ホストが自分なら
        ? hostIsMe()
            // ホストのキャラクターを更新
            ? state.copyWith(host: state.host.copyWith(characters: newTargets))
            // そうじゃなければゲストのキャラクターを更新
            : state.copyWith(
                guest: state.guest.copyWith(characters: newTargets))
        // ホストが相手なら
        : hostIsMe()
            // ゲストのキャラクターを更新
            ? state.copyWith(
                guest: state.guest.copyWith(characters: newTargets))
            // そうじゃなければホストのキャラクターを更新
            : state.copyWith(
                host: state.host.copyWith(characters: newTargets)));
  }

  Future<void> playCard({required bool isMe, required String cardId}) async {
    final player = isMe ? me() : enemy();

    // 1) マスターデータからカードを探す
    final cardMaster = await loadCardsFromJson();
    final masterIndex = cardMaster.indexWhere((c) => c.id == cardId);
    if (masterIndex == -1) return; // カード未発見なら何もしない
    final card = cardMaster[masterIndex];

    // 2) コストを取得してAPが足りるかチェック
    final cost = getCostApOrDefault(card, defaultValue: 0);
    final currentAp = player.ap;
    if (currentAp.length < cost) return; // AP不足なら何もしない

    // 3) 消費するAPと残APを分割
    final consumedAp = currentAp.sublist(0, cost);
    final newAp = currentAp.sublist(cost);

    // 4) 新しいトラッシュに、もともとのトラッシュ＋消費AP＋プレイしたカードを追加
    final newTrash = [
      ...player.trash,
      ...consumedAp,
      card,
    ];

    // 5) 新しい手札リストを作成（最初に見つかった１枚だけ削除）
    final newHand = [...player.hand];
    final handIndex = newHand.indexWhere((c) => c.id == cardId);
    if (handIndex != -1) {
      newHand.removeAt(handIndex);
    }

    // 6) 更新用の PlayerState を組み立て
    final updatedPlayer = player.copyWith(
      ap: newAp,
      trash: newTrash,
      hand: newHand,
    );

    // 7) BattleState を更新
    final newState = isMe
        ? hostIsMe()
            ? state.copyWith(host: updatedPlayer)
            : state.copyWith(guest: updatedPlayer)
        : hostIsMe()
            ? state.copyWith(guest: updatedPlayer)
            : state.copyWith(host: updatedPlayer);

    await updateState(newState);
  }

  Future<void> autoPlayCard({required bool isMe}) async {
    await Future.delayed(const Duration(seconds: 1));
    final player = isMe ? me() : enemy();
    final target = isMe ? enemy() : me();

    // 3回まで抽選
    for (var i = 0; i < 5; i++) {
      if (Random().nextBool()) {
        return;
      }

      final playableCards = playableHandCardIndexes(isMe: isMe)
          .map((i) => player.hand[i])
          .toList();
      final playCard = playableCards.length > 0
          ? playableCards[Random().nextInt(playableCards.length)]
          : null;

      if (playCard == null) {
        return;
      }

      String playCharacterId() {
        return player.characters[0].uuid;
      }

      List<String> targetCharacterIds() {
        return [target.characters[0].uuid];
      }

      await playCardCommand(
          playCharacterId: playCharacterId(),
          targetCharacterIds: targetCharacterIds(),
          card: playCard,
          isMe: isMe);
    }
  }

  Future<void> autoChargeAp({required bool isMe}) async {
    await Future.delayed(const Duration(seconds: 1));

    final player = isMe ? me() : enemy();

    final chargeCardIndexes = player.hand.map((c) => c.id).toList();

    await chargeApFromHandCommand(chargeCardIndexes);
  }

  /// 必要に応じて state のリセットや他の更新メソッドを追加可能
}

/// Riverpod Provider allowing external initial BattleState injection
final battleProcessorProvider = StateNotifierProvider.autoDispose
    .family<BattleProcessor, BattleState, BattleState>((ref, initialState) {
  return BattleProcessor(initialState);
});
