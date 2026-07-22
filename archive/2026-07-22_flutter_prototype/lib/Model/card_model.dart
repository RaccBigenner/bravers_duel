import 'package:freezed_annotation/freezed_annotation.dart';

part 'card_model.freezed.dart';
part 'card_model.g.dart';

@Freezed(unionKey: 'type')
sealed class CardModel with _$CardModel {
  const factory CardModel.character({
    required String id,
    required int vol,
    required String code,
    required String rarity,
    required String name,
    required String effectText,
    required String flavorText,

    // character 固有
    required String size,
    required int hp,
    required List<String> attribute,
  }) = CharacterCard;

  const factory CardModel.skill({
    required String id,
    required int vol,
    required String code,
    required String rarity,
    required String name,
    required String effectText,
    required String flavorText,

    // skill 固有
    required int costAp,
    required List<String> conditionAttribute,
    required int baseValue,
    required String valueType, // attack / guard / support / heal
  }) = SkillCard;

  const factory CardModel.equipment({
    required String id,
    required int vol,
    required String code,
    required String rarity,
    required String name,
    required String effectText,
    required String flavorText,

    // equipment 固有
    required List<String> addAttribute,
  }) = EquipmentCard;

  const factory CardModel.field({
    required String id,
    required int vol,
    required String code,
    required String rarity,
    required String name,
    required String effectText,
    required String flavorText,
  }) = FieldCard;

  factory CardModel.fromJson(Map<String, dynamic> json) =>
      _$CardModelFromJson(json);
}

int getCostApOrDefault(CardModel card, {int defaultValue = 0}) {
  return card.maybeMap(
    skill: (skillCard) => skillCard.costAp,
    orElse: () => defaultValue,
  );
}
