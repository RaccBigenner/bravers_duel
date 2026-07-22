import 'package:bravers_duel/Model/card_model.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
part 'character_state.freezed.dart';
part 'character_state.g.dart';

@freezed
class CharacterState with _$CharacterState {
  const factory CharacterState({
    required CharacterCard character, // キャラクター本体
    required String uuid,
    @Default(0) int damageCount, // 累積ダメージ
    @Default(<String>[]) List<String> stateEffect, // 状態異常など
    CardModel? equipment, // 装備カード（null可）
    @Default(<String>[]) List<String> addAttribute, // 追加属性
  }) = _CharacterState;

  factory CharacterState.fromJson(Map<String, dynamic> json) =>
      _$CharacterStateFromJson(json);
}
