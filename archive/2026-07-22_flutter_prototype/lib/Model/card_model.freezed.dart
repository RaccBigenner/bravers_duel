// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'card_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

CardModel _$CardModelFromJson(Map<String, dynamic> json) {
  switch (json['type']) {
    case 'character':
      return CharacterCard.fromJson(json);
    case 'skill':
      return SkillCard.fromJson(json);
    case 'equipment':
      return EquipmentCard.fromJson(json);
    case 'field':
      return FieldCard.fromJson(json);

    default:
      throw CheckedFromJsonException(
          json, 'type', 'CardModel', 'Invalid union type "${json['type']}"!');
  }
}

/// @nodoc
mixin _$CardModel {
  String get id => throw _privateConstructorUsedError;
  int get vol => throw _privateConstructorUsedError;
  String get code => throw _privateConstructorUsedError;
  String get rarity => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get effectText => throw _privateConstructorUsedError;
  String get flavorText => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)
        character,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)
        skill,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)
        equipment,
    required TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)
        field,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult? Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(CharacterCard value) character,
    required TResult Function(SkillCard value) skill,
    required TResult Function(EquipmentCard value) equipment,
    required TResult Function(FieldCard value) field,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(CharacterCard value)? character,
    TResult? Function(SkillCard value)? skill,
    TResult? Function(EquipmentCard value)? equipment,
    TResult? Function(FieldCard value)? field,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(CharacterCard value)? character,
    TResult Function(SkillCard value)? skill,
    TResult Function(EquipmentCard value)? equipment,
    TResult Function(FieldCard value)? field,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $CardModelCopyWith<CardModel> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $CardModelCopyWith<$Res> {
  factory $CardModelCopyWith(CardModel value, $Res Function(CardModel) then) =
      _$CardModelCopyWithImpl<$Res, CardModel>;
  @useResult
  $Res call(
      {String id,
      int vol,
      String code,
      String rarity,
      String name,
      String effectText,
      String flavorText});
}

/// @nodoc
class _$CardModelCopyWithImpl<$Res, $Val extends CardModel>
    implements $CardModelCopyWith<$Res> {
  _$CardModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? vol = null,
    Object? code = null,
    Object? rarity = null,
    Object? name = null,
    Object? effectText = null,
    Object? flavorText = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      vol: null == vol
          ? _value.vol
          : vol // ignore: cast_nullable_to_non_nullable
              as int,
      code: null == code
          ? _value.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      rarity: null == rarity
          ? _value.rarity
          : rarity // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      effectText: null == effectText
          ? _value.effectText
          : effectText // ignore: cast_nullable_to_non_nullable
              as String,
      flavorText: null == flavorText
          ? _value.flavorText
          : flavorText // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$CharacterCardImplCopyWith<$Res>
    implements $CardModelCopyWith<$Res> {
  factory _$$CharacterCardImplCopyWith(
          _$CharacterCardImpl value, $Res Function(_$CharacterCardImpl) then) =
      __$$CharacterCardImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      int vol,
      String code,
      String rarity,
      String name,
      String effectText,
      String flavorText,
      String size,
      int hp,
      List<String> attribute});
}

/// @nodoc
class __$$CharacterCardImplCopyWithImpl<$Res>
    extends _$CardModelCopyWithImpl<$Res, _$CharacterCardImpl>
    implements _$$CharacterCardImplCopyWith<$Res> {
  __$$CharacterCardImplCopyWithImpl(
      _$CharacterCardImpl _value, $Res Function(_$CharacterCardImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? vol = null,
    Object? code = null,
    Object? rarity = null,
    Object? name = null,
    Object? effectText = null,
    Object? flavorText = null,
    Object? size = null,
    Object? hp = null,
    Object? attribute = null,
  }) {
    return _then(_$CharacterCardImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      vol: null == vol
          ? _value.vol
          : vol // ignore: cast_nullable_to_non_nullable
              as int,
      code: null == code
          ? _value.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      rarity: null == rarity
          ? _value.rarity
          : rarity // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      effectText: null == effectText
          ? _value.effectText
          : effectText // ignore: cast_nullable_to_non_nullable
              as String,
      flavorText: null == flavorText
          ? _value.flavorText
          : flavorText // ignore: cast_nullable_to_non_nullable
              as String,
      size: null == size
          ? _value.size
          : size // ignore: cast_nullable_to_non_nullable
              as String,
      hp: null == hp
          ? _value.hp
          : hp // ignore: cast_nullable_to_non_nullable
              as int,
      attribute: null == attribute
          ? _value._attribute
          : attribute // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$CharacterCardImpl implements CharacterCard {
  const _$CharacterCardImpl(
      {required this.id,
      required this.vol,
      required this.code,
      required this.rarity,
      required this.name,
      required this.effectText,
      required this.flavorText,
      required this.size,
      required this.hp,
      required final List<String> attribute,
      final String? $type})
      : _attribute = attribute,
        $type = $type ?? 'character';

  factory _$CharacterCardImpl.fromJson(Map<String, dynamic> json) =>
      _$$CharacterCardImplFromJson(json);

  @override
  final String id;
  @override
  final int vol;
  @override
  final String code;
  @override
  final String rarity;
  @override
  final String name;
  @override
  final String effectText;
  @override
  final String flavorText;
// character 固有
  @override
  final String size;
  @override
  final int hp;
  final List<String> _attribute;
  @override
  List<String> get attribute {
    if (_attribute is EqualUnmodifiableListView) return _attribute;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_attribute);
  }

  @JsonKey(name: 'type')
  final String $type;

  @override
  String toString() {
    return 'CardModel.character(id: $id, vol: $vol, code: $code, rarity: $rarity, name: $name, effectText: $effectText, flavorText: $flavorText, size: $size, hp: $hp, attribute: $attribute)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$CharacterCardImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.vol, vol) || other.vol == vol) &&
            (identical(other.code, code) || other.code == code) &&
            (identical(other.rarity, rarity) || other.rarity == rarity) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.effectText, effectText) ||
                other.effectText == effectText) &&
            (identical(other.flavorText, flavorText) ||
                other.flavorText == flavorText) &&
            (identical(other.size, size) || other.size == size) &&
            (identical(other.hp, hp) || other.hp == hp) &&
            const DeepCollectionEquality()
                .equals(other._attribute, _attribute));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      vol,
      code,
      rarity,
      name,
      effectText,
      flavorText,
      size,
      hp,
      const DeepCollectionEquality().hash(_attribute));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$CharacterCardImplCopyWith<_$CharacterCardImpl> get copyWith =>
      __$$CharacterCardImplCopyWithImpl<_$CharacterCardImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)
        character,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)
        skill,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)
        equipment,
    required TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)
        field,
  }) {
    return character(id, vol, code, rarity, name, effectText, flavorText, size,
        hp, attribute);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult? Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
  }) {
    return character?.call(id, vol, code, rarity, name, effectText, flavorText,
        size, hp, attribute);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
    required TResult orElse(),
  }) {
    if (character != null) {
      return character(id, vol, code, rarity, name, effectText, flavorText,
          size, hp, attribute);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(CharacterCard value) character,
    required TResult Function(SkillCard value) skill,
    required TResult Function(EquipmentCard value) equipment,
    required TResult Function(FieldCard value) field,
  }) {
    return character(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(CharacterCard value)? character,
    TResult? Function(SkillCard value)? skill,
    TResult? Function(EquipmentCard value)? equipment,
    TResult? Function(FieldCard value)? field,
  }) {
    return character?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(CharacterCard value)? character,
    TResult Function(SkillCard value)? skill,
    TResult Function(EquipmentCard value)? equipment,
    TResult Function(FieldCard value)? field,
    required TResult orElse(),
  }) {
    if (character != null) {
      return character(this);
    }
    return orElse();
  }

  @override
  Map<String, dynamic> toJson() {
    return _$$CharacterCardImplToJson(
      this,
    );
  }
}

abstract class CharacterCard implements CardModel {
  const factory CharacterCard(
      {required final String id,
      required final int vol,
      required final String code,
      required final String rarity,
      required final String name,
      required final String effectText,
      required final String flavorText,
      required final String size,
      required final int hp,
      required final List<String> attribute}) = _$CharacterCardImpl;

  factory CharacterCard.fromJson(Map<String, dynamic> json) =
      _$CharacterCardImpl.fromJson;

  @override
  String get id;
  @override
  int get vol;
  @override
  String get code;
  @override
  String get rarity;
  @override
  String get name;
  @override
  String get effectText;
  @override
  String get flavorText; // character 固有
  String get size;
  int get hp;
  List<String> get attribute;
  @override
  @JsonKey(ignore: true)
  _$$CharacterCardImplCopyWith<_$CharacterCardImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$SkillCardImplCopyWith<$Res>
    implements $CardModelCopyWith<$Res> {
  factory _$$SkillCardImplCopyWith(
          _$SkillCardImpl value, $Res Function(_$SkillCardImpl) then) =
      __$$SkillCardImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      int vol,
      String code,
      String rarity,
      String name,
      String effectText,
      String flavorText,
      int costAp,
      List<String> conditionAttribute,
      int baseValue,
      String valueType});
}

/// @nodoc
class __$$SkillCardImplCopyWithImpl<$Res>
    extends _$CardModelCopyWithImpl<$Res, _$SkillCardImpl>
    implements _$$SkillCardImplCopyWith<$Res> {
  __$$SkillCardImplCopyWithImpl(
      _$SkillCardImpl _value, $Res Function(_$SkillCardImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? vol = null,
    Object? code = null,
    Object? rarity = null,
    Object? name = null,
    Object? effectText = null,
    Object? flavorText = null,
    Object? costAp = null,
    Object? conditionAttribute = null,
    Object? baseValue = null,
    Object? valueType = null,
  }) {
    return _then(_$SkillCardImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      vol: null == vol
          ? _value.vol
          : vol // ignore: cast_nullable_to_non_nullable
              as int,
      code: null == code
          ? _value.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      rarity: null == rarity
          ? _value.rarity
          : rarity // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      effectText: null == effectText
          ? _value.effectText
          : effectText // ignore: cast_nullable_to_non_nullable
              as String,
      flavorText: null == flavorText
          ? _value.flavorText
          : flavorText // ignore: cast_nullable_to_non_nullable
              as String,
      costAp: null == costAp
          ? _value.costAp
          : costAp // ignore: cast_nullable_to_non_nullable
              as int,
      conditionAttribute: null == conditionAttribute
          ? _value._conditionAttribute
          : conditionAttribute // ignore: cast_nullable_to_non_nullable
              as List<String>,
      baseValue: null == baseValue
          ? _value.baseValue
          : baseValue // ignore: cast_nullable_to_non_nullable
              as int,
      valueType: null == valueType
          ? _value.valueType
          : valueType // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$SkillCardImpl implements SkillCard {
  const _$SkillCardImpl(
      {required this.id,
      required this.vol,
      required this.code,
      required this.rarity,
      required this.name,
      required this.effectText,
      required this.flavorText,
      required this.costAp,
      required final List<String> conditionAttribute,
      required this.baseValue,
      required this.valueType,
      final String? $type})
      : _conditionAttribute = conditionAttribute,
        $type = $type ?? 'skill';

  factory _$SkillCardImpl.fromJson(Map<String, dynamic> json) =>
      _$$SkillCardImplFromJson(json);

  @override
  final String id;
  @override
  final int vol;
  @override
  final String code;
  @override
  final String rarity;
  @override
  final String name;
  @override
  final String effectText;
  @override
  final String flavorText;
// skill 固有
  @override
  final int costAp;
  final List<String> _conditionAttribute;
  @override
  List<String> get conditionAttribute {
    if (_conditionAttribute is EqualUnmodifiableListView)
      return _conditionAttribute;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_conditionAttribute);
  }

  @override
  final int baseValue;
  @override
  final String valueType;

  @JsonKey(name: 'type')
  final String $type;

  @override
  String toString() {
    return 'CardModel.skill(id: $id, vol: $vol, code: $code, rarity: $rarity, name: $name, effectText: $effectText, flavorText: $flavorText, costAp: $costAp, conditionAttribute: $conditionAttribute, baseValue: $baseValue, valueType: $valueType)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SkillCardImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.vol, vol) || other.vol == vol) &&
            (identical(other.code, code) || other.code == code) &&
            (identical(other.rarity, rarity) || other.rarity == rarity) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.effectText, effectText) ||
                other.effectText == effectText) &&
            (identical(other.flavorText, flavorText) ||
                other.flavorText == flavorText) &&
            (identical(other.costAp, costAp) || other.costAp == costAp) &&
            const DeepCollectionEquality()
                .equals(other._conditionAttribute, _conditionAttribute) &&
            (identical(other.baseValue, baseValue) ||
                other.baseValue == baseValue) &&
            (identical(other.valueType, valueType) ||
                other.valueType == valueType));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      vol,
      code,
      rarity,
      name,
      effectText,
      flavorText,
      costAp,
      const DeepCollectionEquality().hash(_conditionAttribute),
      baseValue,
      valueType);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$SkillCardImplCopyWith<_$SkillCardImpl> get copyWith =>
      __$$SkillCardImplCopyWithImpl<_$SkillCardImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)
        character,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)
        skill,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)
        equipment,
    required TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)
        field,
  }) {
    return skill(id, vol, code, rarity, name, effectText, flavorText, costAp,
        conditionAttribute, baseValue, valueType);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult? Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
  }) {
    return skill?.call(id, vol, code, rarity, name, effectText, flavorText,
        costAp, conditionAttribute, baseValue, valueType);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
    required TResult orElse(),
  }) {
    if (skill != null) {
      return skill(id, vol, code, rarity, name, effectText, flavorText, costAp,
          conditionAttribute, baseValue, valueType);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(CharacterCard value) character,
    required TResult Function(SkillCard value) skill,
    required TResult Function(EquipmentCard value) equipment,
    required TResult Function(FieldCard value) field,
  }) {
    return skill(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(CharacterCard value)? character,
    TResult? Function(SkillCard value)? skill,
    TResult? Function(EquipmentCard value)? equipment,
    TResult? Function(FieldCard value)? field,
  }) {
    return skill?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(CharacterCard value)? character,
    TResult Function(SkillCard value)? skill,
    TResult Function(EquipmentCard value)? equipment,
    TResult Function(FieldCard value)? field,
    required TResult orElse(),
  }) {
    if (skill != null) {
      return skill(this);
    }
    return orElse();
  }

  @override
  Map<String, dynamic> toJson() {
    return _$$SkillCardImplToJson(
      this,
    );
  }
}

abstract class SkillCard implements CardModel {
  const factory SkillCard(
      {required final String id,
      required final int vol,
      required final String code,
      required final String rarity,
      required final String name,
      required final String effectText,
      required final String flavorText,
      required final int costAp,
      required final List<String> conditionAttribute,
      required final int baseValue,
      required final String valueType}) = _$SkillCardImpl;

  factory SkillCard.fromJson(Map<String, dynamic> json) =
      _$SkillCardImpl.fromJson;

  @override
  String get id;
  @override
  int get vol;
  @override
  String get code;
  @override
  String get rarity;
  @override
  String get name;
  @override
  String get effectText;
  @override
  String get flavorText; // skill 固有
  int get costAp;
  List<String> get conditionAttribute;
  int get baseValue;
  String get valueType;
  @override
  @JsonKey(ignore: true)
  _$$SkillCardImplCopyWith<_$SkillCardImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$EquipmentCardImplCopyWith<$Res>
    implements $CardModelCopyWith<$Res> {
  factory _$$EquipmentCardImplCopyWith(
          _$EquipmentCardImpl value, $Res Function(_$EquipmentCardImpl) then) =
      __$$EquipmentCardImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      int vol,
      String code,
      String rarity,
      String name,
      String effectText,
      String flavorText,
      List<String> addAttribute});
}

/// @nodoc
class __$$EquipmentCardImplCopyWithImpl<$Res>
    extends _$CardModelCopyWithImpl<$Res, _$EquipmentCardImpl>
    implements _$$EquipmentCardImplCopyWith<$Res> {
  __$$EquipmentCardImplCopyWithImpl(
      _$EquipmentCardImpl _value, $Res Function(_$EquipmentCardImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? vol = null,
    Object? code = null,
    Object? rarity = null,
    Object? name = null,
    Object? effectText = null,
    Object? flavorText = null,
    Object? addAttribute = null,
  }) {
    return _then(_$EquipmentCardImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      vol: null == vol
          ? _value.vol
          : vol // ignore: cast_nullable_to_non_nullable
              as int,
      code: null == code
          ? _value.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      rarity: null == rarity
          ? _value.rarity
          : rarity // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      effectText: null == effectText
          ? _value.effectText
          : effectText // ignore: cast_nullable_to_non_nullable
              as String,
      flavorText: null == flavorText
          ? _value.flavorText
          : flavorText // ignore: cast_nullable_to_non_nullable
              as String,
      addAttribute: null == addAttribute
          ? _value._addAttribute
          : addAttribute // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$EquipmentCardImpl implements EquipmentCard {
  const _$EquipmentCardImpl(
      {required this.id,
      required this.vol,
      required this.code,
      required this.rarity,
      required this.name,
      required this.effectText,
      required this.flavorText,
      required final List<String> addAttribute,
      final String? $type})
      : _addAttribute = addAttribute,
        $type = $type ?? 'equipment';

  factory _$EquipmentCardImpl.fromJson(Map<String, dynamic> json) =>
      _$$EquipmentCardImplFromJson(json);

  @override
  final String id;
  @override
  final int vol;
  @override
  final String code;
  @override
  final String rarity;
  @override
  final String name;
  @override
  final String effectText;
  @override
  final String flavorText;
// equipment 固有
  final List<String> _addAttribute;
// equipment 固有
  @override
  List<String> get addAttribute {
    if (_addAttribute is EqualUnmodifiableListView) return _addAttribute;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_addAttribute);
  }

  @JsonKey(name: 'type')
  final String $type;

  @override
  String toString() {
    return 'CardModel.equipment(id: $id, vol: $vol, code: $code, rarity: $rarity, name: $name, effectText: $effectText, flavorText: $flavorText, addAttribute: $addAttribute)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EquipmentCardImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.vol, vol) || other.vol == vol) &&
            (identical(other.code, code) || other.code == code) &&
            (identical(other.rarity, rarity) || other.rarity == rarity) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.effectText, effectText) ||
                other.effectText == effectText) &&
            (identical(other.flavorText, flavorText) ||
                other.flavorText == flavorText) &&
            const DeepCollectionEquality()
                .equals(other._addAttribute, _addAttribute));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      vol,
      code,
      rarity,
      name,
      effectText,
      flavorText,
      const DeepCollectionEquality().hash(_addAttribute));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$EquipmentCardImplCopyWith<_$EquipmentCardImpl> get copyWith =>
      __$$EquipmentCardImplCopyWithImpl<_$EquipmentCardImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)
        character,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)
        skill,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)
        equipment,
    required TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)
        field,
  }) {
    return equipment(
        id, vol, code, rarity, name, effectText, flavorText, addAttribute);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult? Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
  }) {
    return equipment?.call(
        id, vol, code, rarity, name, effectText, flavorText, addAttribute);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
    required TResult orElse(),
  }) {
    if (equipment != null) {
      return equipment(
          id, vol, code, rarity, name, effectText, flavorText, addAttribute);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(CharacterCard value) character,
    required TResult Function(SkillCard value) skill,
    required TResult Function(EquipmentCard value) equipment,
    required TResult Function(FieldCard value) field,
  }) {
    return equipment(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(CharacterCard value)? character,
    TResult? Function(SkillCard value)? skill,
    TResult? Function(EquipmentCard value)? equipment,
    TResult? Function(FieldCard value)? field,
  }) {
    return equipment?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(CharacterCard value)? character,
    TResult Function(SkillCard value)? skill,
    TResult Function(EquipmentCard value)? equipment,
    TResult Function(FieldCard value)? field,
    required TResult orElse(),
  }) {
    if (equipment != null) {
      return equipment(this);
    }
    return orElse();
  }

  @override
  Map<String, dynamic> toJson() {
    return _$$EquipmentCardImplToJson(
      this,
    );
  }
}

abstract class EquipmentCard implements CardModel {
  const factory EquipmentCard(
      {required final String id,
      required final int vol,
      required final String code,
      required final String rarity,
      required final String name,
      required final String effectText,
      required final String flavorText,
      required final List<String> addAttribute}) = _$EquipmentCardImpl;

  factory EquipmentCard.fromJson(Map<String, dynamic> json) =
      _$EquipmentCardImpl.fromJson;

  @override
  String get id;
  @override
  int get vol;
  @override
  String get code;
  @override
  String get rarity;
  @override
  String get name;
  @override
  String get effectText;
  @override
  String get flavorText; // equipment 固有
  List<String> get addAttribute;
  @override
  @JsonKey(ignore: true)
  _$$EquipmentCardImplCopyWith<_$EquipmentCardImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$FieldCardImplCopyWith<$Res>
    implements $CardModelCopyWith<$Res> {
  factory _$$FieldCardImplCopyWith(
          _$FieldCardImpl value, $Res Function(_$FieldCardImpl) then) =
      __$$FieldCardImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      int vol,
      String code,
      String rarity,
      String name,
      String effectText,
      String flavorText});
}

/// @nodoc
class __$$FieldCardImplCopyWithImpl<$Res>
    extends _$CardModelCopyWithImpl<$Res, _$FieldCardImpl>
    implements _$$FieldCardImplCopyWith<$Res> {
  __$$FieldCardImplCopyWithImpl(
      _$FieldCardImpl _value, $Res Function(_$FieldCardImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? vol = null,
    Object? code = null,
    Object? rarity = null,
    Object? name = null,
    Object? effectText = null,
    Object? flavorText = null,
  }) {
    return _then(_$FieldCardImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      vol: null == vol
          ? _value.vol
          : vol // ignore: cast_nullable_to_non_nullable
              as int,
      code: null == code
          ? _value.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      rarity: null == rarity
          ? _value.rarity
          : rarity // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      effectText: null == effectText
          ? _value.effectText
          : effectText // ignore: cast_nullable_to_non_nullable
              as String,
      flavorText: null == flavorText
          ? _value.flavorText
          : flavorText // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$FieldCardImpl implements FieldCard {
  const _$FieldCardImpl(
      {required this.id,
      required this.vol,
      required this.code,
      required this.rarity,
      required this.name,
      required this.effectText,
      required this.flavorText,
      final String? $type})
      : $type = $type ?? 'field';

  factory _$FieldCardImpl.fromJson(Map<String, dynamic> json) =>
      _$$FieldCardImplFromJson(json);

  @override
  final String id;
  @override
  final int vol;
  @override
  final String code;
  @override
  final String rarity;
  @override
  final String name;
  @override
  final String effectText;
  @override
  final String flavorText;

  @JsonKey(name: 'type')
  final String $type;

  @override
  String toString() {
    return 'CardModel.field(id: $id, vol: $vol, code: $code, rarity: $rarity, name: $name, effectText: $effectText, flavorText: $flavorText)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$FieldCardImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.vol, vol) || other.vol == vol) &&
            (identical(other.code, code) || other.code == code) &&
            (identical(other.rarity, rarity) || other.rarity == rarity) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.effectText, effectText) ||
                other.effectText == effectText) &&
            (identical(other.flavorText, flavorText) ||
                other.flavorText == flavorText));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, vol, code, rarity, name, effectText, flavorText);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$FieldCardImplCopyWith<_$FieldCardImpl> get copyWith =>
      __$$FieldCardImplCopyWithImpl<_$FieldCardImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)
        character,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)
        skill,
    required TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)
        equipment,
    required TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)
        field,
  }) {
    return field(id, vol, code, rarity, name, effectText, flavorText);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult? Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult? Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
  }) {
    return field?.call(id, vol, code, rarity, name, effectText, flavorText);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            String size,
            int hp,
            List<String> attribute)?
        character,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            int costAp,
            List<String> conditionAttribute,
            int baseValue,
            String valueType)?
        skill,
    TResult Function(
            String id,
            int vol,
            String code,
            String rarity,
            String name,
            String effectText,
            String flavorText,
            List<String> addAttribute)?
        equipment,
    TResult Function(String id, int vol, String code, String rarity,
            String name, String effectText, String flavorText)?
        field,
    required TResult orElse(),
  }) {
    if (field != null) {
      return field(id, vol, code, rarity, name, effectText, flavorText);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(CharacterCard value) character,
    required TResult Function(SkillCard value) skill,
    required TResult Function(EquipmentCard value) equipment,
    required TResult Function(FieldCard value) field,
  }) {
    return field(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(CharacterCard value)? character,
    TResult? Function(SkillCard value)? skill,
    TResult? Function(EquipmentCard value)? equipment,
    TResult? Function(FieldCard value)? field,
  }) {
    return field?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(CharacterCard value)? character,
    TResult Function(SkillCard value)? skill,
    TResult Function(EquipmentCard value)? equipment,
    TResult Function(FieldCard value)? field,
    required TResult orElse(),
  }) {
    if (field != null) {
      return field(this);
    }
    return orElse();
  }

  @override
  Map<String, dynamic> toJson() {
    return _$$FieldCardImplToJson(
      this,
    );
  }
}

abstract class FieldCard implements CardModel {
  const factory FieldCard(
      {required final String id,
      required final int vol,
      required final String code,
      required final String rarity,
      required final String name,
      required final String effectText,
      required final String flavorText}) = _$FieldCardImpl;

  factory FieldCard.fromJson(Map<String, dynamic> json) =
      _$FieldCardImpl.fromJson;

  @override
  String get id;
  @override
  int get vol;
  @override
  String get code;
  @override
  String get rarity;
  @override
  String get name;
  @override
  String get effectText;
  @override
  String get flavorText;
  @override
  @JsonKey(ignore: true)
  _$$FieldCardImplCopyWith<_$FieldCardImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
