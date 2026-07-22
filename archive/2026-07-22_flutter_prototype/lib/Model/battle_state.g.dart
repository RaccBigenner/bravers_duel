// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'battle_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$BattleStateImpl _$$BattleStateImplFromJson(Map<String, dynamic> json) =>
    _$BattleStateImpl(
      battleUuid: json['battleUuid'] as String,
      host: PlayerState.fromJson(json['host'] as Map<String, dynamic>),
      guest: PlayerState.fromJson(json['guest'] as Map<String, dynamic>),
      turnState: TurnState.fromJson(json['turnState'] as Map<String, dynamic>),
      fieldCard: json['fieldCard'] == null
          ? null
          : CardModel.fromJson(json['fieldCard'] as Map<String, dynamic>),
      events: (json['events'] as List<dynamic>?)
              ?.map((e) => BattleEvent.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );

Map<String, dynamic> _$$BattleStateImplToJson(_$BattleStateImpl instance) =>
    <String, dynamic>{
      'battleUuid': instance.battleUuid,
      'host': instance.host,
      'guest': instance.guest,
      'turnState': instance.turnState,
      'fieldCard': instance.fieldCard,
      'events': instance.events,
    };

_$PlayerStateImpl _$$PlayerStateImplFromJson(Map<String, dynamic> json) =>
    _$PlayerStateImpl(
      playerId: json['playerId'] as String,
      deck: (json['deck'] as List<dynamic>)
          .map((e) => CardModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      hand: (json['hand'] as List<dynamic>)
          .map((e) => CardModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      trash: (json['trash'] as List<dynamic>)
          .map((e) => CardModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      ap: (json['ap'] as List<dynamic>)
          .map((e) => CardModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      characters: (json['characters'] as List<dynamic>)
          .map((e) => CharacterState.fromJson(e as Map<String, dynamic>))
          .toList(),
      processedSeq: (json['processedSeq'] as num).toInt(),
    );

Map<String, dynamic> _$$PlayerStateImplToJson(_$PlayerStateImpl instance) =>
    <String, dynamic>{
      'playerId': instance.playerId,
      'deck': instance.deck,
      'hand': instance.hand,
      'trash': instance.trash,
      'ap': instance.ap,
      'characters': instance.characters,
      'processedSeq': instance.processedSeq,
    };

_$BattleEventImpl _$$BattleEventImplFromJson(Map<String, dynamic> json) =>
    _$BattleEventImpl(
      seq: (json['seq'] as num).toInt(),
      actorId: json['actorId'] as String,
      type: json['type'] as String,
      targets:
          (json['targets'] as List<dynamic>).map((e) => e as String).toList(),
      value: (json['value'] as num).toInt(),
    );

Map<String, dynamic> _$$BattleEventImplToJson(_$BattleEventImpl instance) =>
    <String, dynamic>{
      'seq': instance.seq,
      'actorId': instance.actorId,
      'type': instance.type,
      'targets': instance.targets,
      'value': instance.value,
    };
