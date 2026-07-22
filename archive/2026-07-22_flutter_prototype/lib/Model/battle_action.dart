import 'package:freezed_annotation/freezed_annotation.dart';
part 'battle_action.freezed.dart';

// -----------------------------
// バトル操作を表すアクション型
// -----------------------------
@freezed
class BattleAction with _$BattleAction {
  const factory BattleAction.startTurn({required String actor}) = StartTurn;
  const factory BattleAction.playCard(
    String actor,
    int handIndex,
    int? fieldIndex, // スキルを使うキャラのindex
    // targetIndexなど「特殊な対象指定」が必要な時だけ追加
  ) = PlayCard;
  const factory BattleAction.chargeAP(
      {required String actor, required int handIndex}) = ChargeAP;
  const factory BattleAction.endTurn({required String actor}) = EndTurn;
  const factory BattleAction.nextPhase({required String actor}) = NextPhase;
}
