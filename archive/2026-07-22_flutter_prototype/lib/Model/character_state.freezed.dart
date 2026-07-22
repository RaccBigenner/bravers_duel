// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'character_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

CharacterState _$CharacterStateFromJson(Map<String, dynamic> json) {
  return _CharacterState.fromJson(json);
}

/// @nodoc
mixin _$CharacterState {
  CharacterCard get character => throw _privateConstructorUsedError; // キャラクター本体
  String get uuid => throw _privateConstructorUsedError;
  int get damageCount => throw _privateConstructorUsedError; // 累積ダメージ
  List<String> get stateEffect => throw _privateConstructorUsedError; // 状態異常など
  CardModel? get equipment =>
      throw _privateConstructorUsedError; // 装備カード（null可）
  List<String> get addAttribute => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $CharacterStateCopyWith<CharacterState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $CharacterStateCopyWith<$Res> {
  factory $CharacterStateCopyWith(
          CharacterState value, $Res Function(CharacterState) then) =
      _$CharacterStateCopyWithImpl<$Res, CharacterState>;
  @useResult
  $Res call(
      {CharacterCard character,
      String uuid,
      int damageCount,
      List<String> stateEffect,
      CardModel? equipment,
      List<String> addAttribute});

  $CardModelCopyWith<$Res>? get equipment;
}

/// @nodoc
class _$CharacterStateCopyWithImpl<$Res, $Val extends CharacterState>
    implements $CharacterStateCopyWith<$Res> {
  _$CharacterStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? character = freezed,
    Object? uuid = null,
    Object? damageCount = null,
    Object? stateEffect = null,
    Object? equipment = freezed,
    Object? addAttribute = null,
  }) {
    return _then(_value.copyWith(
      character: freezed == character
          ? _value.character
          : character // ignore: cast_nullable_to_non_nullable
              as CharacterCard,
      uuid: null == uuid
          ? _value.uuid
          : uuid // ignore: cast_nullable_to_non_nullable
              as String,
      damageCount: null == damageCount
          ? _value.damageCount
          : damageCount // ignore: cast_nullable_to_non_nullable
              as int,
      stateEffect: null == stateEffect
          ? _value.stateEffect
          : stateEffect // ignore: cast_nullable_to_non_nullable
              as List<String>,
      equipment: freezed == equipment
          ? _value.equipment
          : equipment // ignore: cast_nullable_to_non_nullable
              as CardModel?,
      addAttribute: null == addAttribute
          ? _value.addAttribute
          : addAttribute // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $CardModelCopyWith<$Res>? get equipment {
    if (_value.equipment == null) {
      return null;
    }

    return $CardModelCopyWith<$Res>(_value.equipment!, (value) {
      return _then(_value.copyWith(equipment: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$CharacterStateImplCopyWith<$Res>
    implements $CharacterStateCopyWith<$Res> {
  factory _$$CharacterStateImplCopyWith(_$CharacterStateImpl value,
          $Res Function(_$CharacterStateImpl) then) =
      __$$CharacterStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {CharacterCard character,
      String uuid,
      int damageCount,
      List<String> stateEffect,
      CardModel? equipment,
      List<String> addAttribute});

  @override
  $CardModelCopyWith<$Res>? get equipment;
}

/// @nodoc
class __$$CharacterStateImplCopyWithImpl<$Res>
    extends _$CharacterStateCopyWithImpl<$Res, _$CharacterStateImpl>
    implements _$$CharacterStateImplCopyWith<$Res> {
  __$$CharacterStateImplCopyWithImpl(
      _$CharacterStateImpl _value, $Res Function(_$CharacterStateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? character = freezed,
    Object? uuid = null,
    Object? damageCount = null,
    Object? stateEffect = null,
    Object? equipment = freezed,
    Object? addAttribute = null,
  }) {
    return _then(_$CharacterStateImpl(
      character: freezed == character
          ? _value.character
          : character // ignore: cast_nullable_to_non_nullable
              as CharacterCard,
      uuid: null == uuid
          ? _value.uuid
          : uuid // ignore: cast_nullable_to_non_nullable
              as String,
      damageCount: null == damageCount
          ? _value.damageCount
          : damageCount // ignore: cast_nullable_to_non_nullable
              as int,
      stateEffect: null == stateEffect
          ? _value._stateEffect
          : stateEffect // ignore: cast_nullable_to_non_nullable
              as List<String>,
      equipment: freezed == equipment
          ? _value.equipment
          : equipment // ignore: cast_nullable_to_non_nullable
              as CardModel?,
      addAttribute: null == addAttribute
          ? _value._addAttribute
          : addAttribute // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$CharacterStateImpl implements _CharacterState {
  const _$CharacterStateImpl(
      {required this.character,
      required this.uuid,
      this.damageCount = 0,
      final List<String> stateEffect = const <String>[],
      this.equipment,
      final List<String> addAttribute = const <String>[]})
      : _stateEffect = stateEffect,
        _addAttribute = addAttribute;

  factory _$CharacterStateImpl.fromJson(Map<String, dynamic> json) =>
      _$$CharacterStateImplFromJson(json);

  @override
  final CharacterCard character;
// キャラクター本体
  @override
  final String uuid;
  @override
  @JsonKey()
  final int damageCount;
// 累積ダメージ
  final List<String> _stateEffect;
// 累積ダメージ
  @override
  @JsonKey()
  List<String> get stateEffect {
    if (_stateEffect is EqualUnmodifiableListView) return _stateEffect;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_stateEffect);
  }

// 状態異常など
  @override
  final CardModel? equipment;
// 装備カード（null可）
  final List<String> _addAttribute;
// 装備カード（null可）
  @override
  @JsonKey()
  List<String> get addAttribute {
    if (_addAttribute is EqualUnmodifiableListView) return _addAttribute;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_addAttribute);
  }

  @override
  String toString() {
    return 'CharacterState(character: $character, uuid: $uuid, damageCount: $damageCount, stateEffect: $stateEffect, equipment: $equipment, addAttribute: $addAttribute)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$CharacterStateImpl &&
            const DeepCollectionEquality().equals(other.character, character) &&
            (identical(other.uuid, uuid) || other.uuid == uuid) &&
            (identical(other.damageCount, damageCount) ||
                other.damageCount == damageCount) &&
            const DeepCollectionEquality()
                .equals(other._stateEffect, _stateEffect) &&
            (identical(other.equipment, equipment) ||
                other.equipment == equipment) &&
            const DeepCollectionEquality()
                .equals(other._addAttribute, _addAttribute));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      const DeepCollectionEquality().hash(character),
      uuid,
      damageCount,
      const DeepCollectionEquality().hash(_stateEffect),
      equipment,
      const DeepCollectionEquality().hash(_addAttribute));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$CharacterStateImplCopyWith<_$CharacterStateImpl> get copyWith =>
      __$$CharacterStateImplCopyWithImpl<_$CharacterStateImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$CharacterStateImplToJson(
      this,
    );
  }
}

abstract class _CharacterState implements CharacterState {
  const factory _CharacterState(
      {required final CharacterCard character,
      required final String uuid,
      final int damageCount,
      final List<String> stateEffect,
      final CardModel? equipment,
      final List<String> addAttribute}) = _$CharacterStateImpl;

  factory _CharacterState.fromJson(Map<String, dynamic> json) =
      _$CharacterStateImpl.fromJson;

  @override
  CharacterCard get character;
  @override // キャラクター本体
  String get uuid;
  @override
  int get damageCount;
  @override // 累積ダメージ
  List<String> get stateEffect;
  @override // 状態異常など
  CardModel? get equipment;
  @override // 装備カード（null可）
  List<String> get addAttribute;
  @override
  @JsonKey(ignore: true)
  _$$CharacterStateImplCopyWith<_$CharacterStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
