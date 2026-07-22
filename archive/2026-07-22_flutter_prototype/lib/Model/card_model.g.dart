// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'card_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$CharacterCardImpl _$$CharacterCardImplFromJson(Map<String, dynamic> json) =>
    _$CharacterCardImpl(
      id: json['id'] as String,
      vol: (json['vol'] as num).toInt(),
      code: json['code'] as String,
      rarity: json['rarity'] as String,
      name: json['name'] as String,
      effectText: json['effectText'] as String,
      flavorText: json['flavorText'] as String,
      size: json['size'] as String,
      hp: (json['hp'] as num).toInt(),
      attribute:
          (json['attribute'] as List<dynamic>).map((e) => e as String).toList(),
      $type: json['type'] as String?,
    );

Map<String, dynamic> _$$CharacterCardImplToJson(_$CharacterCardImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'vol': instance.vol,
      'code': instance.code,
      'rarity': instance.rarity,
      'name': instance.name,
      'effectText': instance.effectText,
      'flavorText': instance.flavorText,
      'size': instance.size,
      'hp': instance.hp,
      'attribute': instance.attribute,
      'type': instance.$type,
    };

_$SkillCardImpl _$$SkillCardImplFromJson(Map<String, dynamic> json) =>
    _$SkillCardImpl(
      id: json['id'] as String,
      vol: (json['vol'] as num).toInt(),
      code: json['code'] as String,
      rarity: json['rarity'] as String,
      name: json['name'] as String,
      effectText: json['effectText'] as String,
      flavorText: json['flavorText'] as String,
      costAp: (json['costAp'] as num).toInt(),
      conditionAttribute: (json['conditionAttribute'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      baseValue: (json['baseValue'] as num).toInt(),
      valueType: json['valueType'] as String,
      $type: json['type'] as String?,
    );

Map<String, dynamic> _$$SkillCardImplToJson(_$SkillCardImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'vol': instance.vol,
      'code': instance.code,
      'rarity': instance.rarity,
      'name': instance.name,
      'effectText': instance.effectText,
      'flavorText': instance.flavorText,
      'costAp': instance.costAp,
      'conditionAttribute': instance.conditionAttribute,
      'baseValue': instance.baseValue,
      'valueType': instance.valueType,
      'type': instance.$type,
    };

_$EquipmentCardImpl _$$EquipmentCardImplFromJson(Map<String, dynamic> json) =>
    _$EquipmentCardImpl(
      id: json['id'] as String,
      vol: (json['vol'] as num).toInt(),
      code: json['code'] as String,
      rarity: json['rarity'] as String,
      name: json['name'] as String,
      effectText: json['effectText'] as String,
      flavorText: json['flavorText'] as String,
      addAttribute: (json['addAttribute'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      $type: json['type'] as String?,
    );

Map<String, dynamic> _$$EquipmentCardImplToJson(_$EquipmentCardImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'vol': instance.vol,
      'code': instance.code,
      'rarity': instance.rarity,
      'name': instance.name,
      'effectText': instance.effectText,
      'flavorText': instance.flavorText,
      'addAttribute': instance.addAttribute,
      'type': instance.$type,
    };

_$FieldCardImpl _$$FieldCardImplFromJson(Map<String, dynamic> json) =>
    _$FieldCardImpl(
      id: json['id'] as String,
      vol: (json['vol'] as num).toInt(),
      code: json['code'] as String,
      rarity: json['rarity'] as String,
      name: json['name'] as String,
      effectText: json['effectText'] as String,
      flavorText: json['flavorText'] as String,
      $type: json['type'] as String?,
    );

Map<String, dynamic> _$$FieldCardImplToJson(_$FieldCardImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'vol': instance.vol,
      'code': instance.code,
      'rarity': instance.rarity,
      'name': instance.name,
      'effectText': instance.effectText,
      'flavorText': instance.flavorText,
      'type': instance.$type,
    };
