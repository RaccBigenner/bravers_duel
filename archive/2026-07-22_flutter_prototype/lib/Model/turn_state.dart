import 'package:freezed_annotation/freezed_annotation.dart';
part 'turn_state.freezed.dart';
part 'turn_state.g.dart';

enum TurnPhase {
  startTurn,
  playCard, // カードプレイフェーズ
  chargeAP, // APチャージフェーズ
}

@freezed
class TurnState with _$TurnState {
  const factory TurnState({
    required int turnCount,
    required String turnActor, // 'player' or 'enemy'
    @Default(TurnPhase.playCard) TurnPhase phase, // 追加
  }) = _TurnState;

  factory TurnState.fromJson(Map<String, dynamic> json) =>
      _$TurnStateFromJson(json);
}
