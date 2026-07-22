// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'deck_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$DeckModelImpl _$$DeckModelImplFromJson(Map<String, dynamic> json) =>
    _$DeckModelImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      favorite: json['favorite'] as bool? ?? false,
      characterIds: (json['characterIds'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      cardIds:
          (json['cardIds'] as List<dynamic>).map((e) => e as String).toList(),
      pveBattleCount: (json['pveBattleCount'] as num?)?.toInt() ?? 0,
      pveWinCount: (json['pveWinCount'] as num?)?.toInt() ?? 0,
      pvpBattleCount: (json['pvpBattleCount'] as num?)?.toInt() ?? 0,
      pvpWinCount: (json['pvpWinCount'] as num?)?.toInt() ?? 0,
    );

Map<String, dynamic> _$$DeckModelImplToJson(_$DeckModelImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'favorite': instance.favorite,
      'characterIds': instance.characterIds,
      'cardIds': instance.cardIds,
      'pveBattleCount': instance.pveBattleCount,
      'pveWinCount': instance.pveWinCount,
      'pvpBattleCount': instance.pvpBattleCount,
      'pvpWinCount': instance.pvpWinCount,
    };
