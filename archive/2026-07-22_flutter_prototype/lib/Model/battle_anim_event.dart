import 'package:freezed_annotation/freezed_annotation.dart';

part 'battle_anim_event.freezed.dart';
part 'battle_anim_event.g.dart';

@freezed
class BattleAnimEvent with _$BattleAnimEvent {
  const factory BattleAnimEvent({
    required String type,
    Map<String, dynamic>? payload,
  }) = _BattleAnimEvent;

  factory BattleAnimEvent.fromJson(Map<String, dynamic> json) =>
      _$BattleAnimEventFromJson(json);
}
