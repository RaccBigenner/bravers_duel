// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'character_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$CharacterStateImpl _$$CharacterStateImplFromJson(Map<String, dynamic> json) =>
    _$CharacterStateImpl(
      character:
          CharacterCard.fromJson(json['character'] as Map<String, dynamic>),
      uuid: json['uuid'] as String,
      damageCount: (json['damageCount'] as num?)?.toInt() ?? 0,
      stateEffect: (json['stateEffect'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
      equipment: json['equipment'] == null
          ? null
          : CardModel.fromJson(json['equipment'] as Map<String, dynamic>),
      addAttribute: (json['addAttribute'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
    );

Map<String, dynamic> _$$CharacterStateImplToJson(
        _$CharacterStateImpl instance) =>
    <String, dynamic>{
      'character': instance.character,
      'uuid': instance.uuid,
      'damageCount': instance.damageCount,
      'stateEffect': instance.stateEffect,
      'equipment': instance.equipment,
      'addAttribute': instance.addAttribute,
    };
