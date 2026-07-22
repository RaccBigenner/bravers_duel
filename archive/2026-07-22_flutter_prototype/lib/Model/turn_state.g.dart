// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'turn_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$TurnStateImpl _$$TurnStateImplFromJson(Map<String, dynamic> json) =>
    _$TurnStateImpl(
      turnCount: (json['turnCount'] as num).toInt(),
      turnActor: json['turnActor'] as String,
      phase: $enumDecodeNullable(_$TurnPhaseEnumMap, json['phase']) ??
          TurnPhase.playCard,
    );

Map<String, dynamic> _$$TurnStateImplToJson(_$TurnStateImpl instance) =>
    <String, dynamic>{
      'turnCount': instance.turnCount,
      'turnActor': instance.turnActor,
      'phase': _$TurnPhaseEnumMap[instance.phase]!,
    };

const _$TurnPhaseEnumMap = {
  TurnPhase.startTurn: 'startTurn',
  TurnPhase.playCard: 'playCard',
  TurnPhase.chargeAP: 'chargeAP',
};
