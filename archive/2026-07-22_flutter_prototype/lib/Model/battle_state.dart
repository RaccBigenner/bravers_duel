import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Model/deck_model.dart';
import 'package:bravers_duel/Model/turn_state.dart';
import 'package:bravers_duel/Theme/shuffle_with.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:uuid/uuid.dart';
import 'character_state.dart';
part 'battle_state.freezed.dart';
part 'battle_state.g.dart';

@freezed
class BattleState with _$BattleState {
  const factory BattleState(
      {
      // ゲーム進行面
      required String battleUuid,
      required PlayerState host,
      required PlayerState guest,
      required TurnState turnState,
      CardModel? fieldCard,
      @Default([]) List<BattleEvent> events}) = _BattleState;

  factory BattleState.fromJson(Map<String, dynamic> json) =>
      _$BattleStateFromJson(json);

  /// マスターデータ・デッキ情報を渡して初期バトル状態を生成
  factory BattleState.initial({
    required String playerId,
    required DeckModel playerDeckModel,
    required String enemyId,
    required DeckModel enemyDeckModel,
    required List<CardModel> cardMaster, // 全カードマスターデータ
  }) {
    // 1. ヘルパー：カードIDからCardModelを取得
    CardModel cardById(String id) =>
        cardMaster.firstWhere((c) => c.id == id, orElse: () {
          throw Exception('Card ID not found in master: $id');
        });

    // 2. キャラクターfieldを生成（キャラIDからCharacterCard, CharacterStateへ）
    List<CharacterState> makeField(List<String> charIds) =>
        charIds.map((charId) {
          final card = cardById(charId);
          if (card is! CharacterCard) {
            throw Exception('ID $charId is not a CharacterCard');
          }
          return CharacterState(
            uuid: const Uuid().v4(),
            character: card,
            damageCount: 0,
            stateEffect: [],
            equipment: null,
            addAttribute: [],
          );
        }).toList();

    // 3. デッキを構築（カードIDからCardModel）
    List<CardModel> makeDeck(List<String> cardIds) =>
        cardIds.map(cardById).toList();

    // 4. 各プレイヤー/敵の初期値を生成
    final playerDeck = makeDeck(playerDeckModel.cardIds)..shuffleWith();
    final playerHand = playerDeck.take(5).toList();
    final playerField = makeField(playerDeckModel.characterIds);

    final enemyDeck = makeDeck(playerDeckModel.cardIds)..shuffleWith();
    final enemyHand = playerDeck.take(5).toList();
    final enemyField = makeField(playerDeckModel.characterIds);

    final uuid = const Uuid().v4();

    return BattleState(
      battleUuid: uuid,
      host: PlayerState(
          processedSeq: 0,
          playerId: playerId,
          deck: playerDeck,
          hand: playerHand,
          trash: [],
          ap: [],
          characters: playerField),
      guest: PlayerState(
          processedSeq: 0,
          playerId: enemyId,
          deck: enemyDeck,
          hand: enemyHand,
          trash: [],
          ap: [],
          characters: enemyField),
      turnState: TurnState(turnCount: 1, turnActor: playerId),
    );
  }
}

@freezed
class PlayerState with _$PlayerState {
  const factory PlayerState(
      {
      // ゲーム進行面
      required String playerId,
      required List<CardModel> deck,
      required List<CardModel> hand,
      required List<CardModel> trash,
      required List<CardModel> ap,
      required List<CharacterState> characters,
      required int processedSeq}) = _PlayerState;

  factory PlayerState.fromJson(Map<String, dynamic> json) =>
      _$PlayerStateFromJson(json);
}

@freezed
class BattleEvent with _$BattleEvent {
  const factory BattleEvent({
    // ゲーム進行面
    required int seq,
    required String actorId,
    required String
        type, // playCard/attackTo/damage/draw/trashTo/chargeFromDeck/etc...
    required List<String> targets,
    required int value,
  }) = _BattleEvent;

  factory BattleEvent.fromJson(Map<String, dynamic> json) =>
      _$BattleEventFromJson(json);
}
