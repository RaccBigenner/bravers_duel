// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'deck_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

DeckModel _$DeckModelFromJson(Map<String, dynamic> json) {
  return _DeckModel.fromJson(json);
}

/// @nodoc
mixin _$DeckModel {
  String get id => throw _privateConstructorUsedError; // 固有ID
  String get name => throw _privateConstructorUsedError; // デッキ名
  bool get favorite => throw _privateConstructorUsedError; // お気に入り
  List<String> get characterIds =>
      throw _privateConstructorUsedError; // キャラクターカードID（最大3枚）
  List<String> get cardIds =>
      throw _privateConstructorUsedError; // カードIDリスト（最大30枚）
  int get pveBattleCount => throw _privateConstructorUsedError; // PvEバトル回数
  int get pveWinCount => throw _privateConstructorUsedError; // PvE勝利回数
  int get pvpBattleCount => throw _privateConstructorUsedError; // PvPバトル回数
  int get pvpWinCount => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $DeckModelCopyWith<DeckModel> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $DeckModelCopyWith<$Res> {
  factory $DeckModelCopyWith(DeckModel value, $Res Function(DeckModel) then) =
      _$DeckModelCopyWithImpl<$Res, DeckModel>;
  @useResult
  $Res call(
      {String id,
      String name,
      bool favorite,
      List<String> characterIds,
      List<String> cardIds,
      int pveBattleCount,
      int pveWinCount,
      int pvpBattleCount,
      int pvpWinCount});
}

/// @nodoc
class _$DeckModelCopyWithImpl<$Res, $Val extends DeckModel>
    implements $DeckModelCopyWith<$Res> {
  _$DeckModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? favorite = null,
    Object? characterIds = null,
    Object? cardIds = null,
    Object? pveBattleCount = null,
    Object? pveWinCount = null,
    Object? pvpBattleCount = null,
    Object? pvpWinCount = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      favorite: null == favorite
          ? _value.favorite
          : favorite // ignore: cast_nullable_to_non_nullable
              as bool,
      characterIds: null == characterIds
          ? _value.characterIds
          : characterIds // ignore: cast_nullable_to_non_nullable
              as List<String>,
      cardIds: null == cardIds
          ? _value.cardIds
          : cardIds // ignore: cast_nullable_to_non_nullable
              as List<String>,
      pveBattleCount: null == pveBattleCount
          ? _value.pveBattleCount
          : pveBattleCount // ignore: cast_nullable_to_non_nullable
              as int,
      pveWinCount: null == pveWinCount
          ? _value.pveWinCount
          : pveWinCount // ignore: cast_nullable_to_non_nullable
              as int,
      pvpBattleCount: null == pvpBattleCount
          ? _value.pvpBattleCount
          : pvpBattleCount // ignore: cast_nullable_to_non_nullable
              as int,
      pvpWinCount: null == pvpWinCount
          ? _value.pvpWinCount
          : pvpWinCount // ignore: cast_nullable_to_non_nullable
              as int,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$DeckModelImplCopyWith<$Res>
    implements $DeckModelCopyWith<$Res> {
  factory _$$DeckModelImplCopyWith(
          _$DeckModelImpl value, $Res Function(_$DeckModelImpl) then) =
      __$$DeckModelImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      bool favorite,
      List<String> characterIds,
      List<String> cardIds,
      int pveBattleCount,
      int pveWinCount,
      int pvpBattleCount,
      int pvpWinCount});
}

/// @nodoc
class __$$DeckModelImplCopyWithImpl<$Res>
    extends _$DeckModelCopyWithImpl<$Res, _$DeckModelImpl>
    implements _$$DeckModelImplCopyWith<$Res> {
  __$$DeckModelImplCopyWithImpl(
      _$DeckModelImpl _value, $Res Function(_$DeckModelImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? favorite = null,
    Object? characterIds = null,
    Object? cardIds = null,
    Object? pveBattleCount = null,
    Object? pveWinCount = null,
    Object? pvpBattleCount = null,
    Object? pvpWinCount = null,
  }) {
    return _then(_$DeckModelImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      favorite: null == favorite
          ? _value.favorite
          : favorite // ignore: cast_nullable_to_non_nullable
              as bool,
      characterIds: null == characterIds
          ? _value._characterIds
          : characterIds // ignore: cast_nullable_to_non_nullable
              as List<String>,
      cardIds: null == cardIds
          ? _value._cardIds
          : cardIds // ignore: cast_nullable_to_non_nullable
              as List<String>,
      pveBattleCount: null == pveBattleCount
          ? _value.pveBattleCount
          : pveBattleCount // ignore: cast_nullable_to_non_nullable
              as int,
      pveWinCount: null == pveWinCount
          ? _value.pveWinCount
          : pveWinCount // ignore: cast_nullable_to_non_nullable
              as int,
      pvpBattleCount: null == pvpBattleCount
          ? _value.pvpBattleCount
          : pvpBattleCount // ignore: cast_nullable_to_non_nullable
              as int,
      pvpWinCount: null == pvpWinCount
          ? _value.pvpWinCount
          : pvpWinCount // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$DeckModelImpl extends _DeckModel {
  const _$DeckModelImpl(
      {required this.id,
      required this.name,
      this.favorite = false,
      required final List<String> characterIds,
      required final List<String> cardIds,
      this.pveBattleCount = 0,
      this.pveWinCount = 0,
      this.pvpBattleCount = 0,
      this.pvpWinCount = 0})
      : _characterIds = characterIds,
        _cardIds = cardIds,
        super._();

  factory _$DeckModelImpl.fromJson(Map<String, dynamic> json) =>
      _$$DeckModelImplFromJson(json);

  @override
  final String id;
// 固有ID
  @override
  final String name;
// デッキ名
  @override
  @JsonKey()
  final bool favorite;
// お気に入り
  final List<String> _characterIds;
// お気に入り
  @override
  List<String> get characterIds {
    if (_characterIds is EqualUnmodifiableListView) return _characterIds;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_characterIds);
  }

// キャラクターカードID（最大3枚）
  final List<String> _cardIds;
// キャラクターカードID（最大3枚）
  @override
  List<String> get cardIds {
    if (_cardIds is EqualUnmodifiableListView) return _cardIds;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_cardIds);
  }

// カードIDリスト（最大30枚）
  @override
  @JsonKey()
  final int pveBattleCount;
// PvEバトル回数
  @override
  @JsonKey()
  final int pveWinCount;
// PvE勝利回数
  @override
  @JsonKey()
  final int pvpBattleCount;
// PvPバトル回数
  @override
  @JsonKey()
  final int pvpWinCount;

  @override
  String toString() {
    return 'DeckModel(id: $id, name: $name, favorite: $favorite, characterIds: $characterIds, cardIds: $cardIds, pveBattleCount: $pveBattleCount, pveWinCount: $pveWinCount, pvpBattleCount: $pvpBattleCount, pvpWinCount: $pvpWinCount)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$DeckModelImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.favorite, favorite) ||
                other.favorite == favorite) &&
            const DeepCollectionEquality()
                .equals(other._characterIds, _characterIds) &&
            const DeepCollectionEquality().equals(other._cardIds, _cardIds) &&
            (identical(other.pveBattleCount, pveBattleCount) ||
                other.pveBattleCount == pveBattleCount) &&
            (identical(other.pveWinCount, pveWinCount) ||
                other.pveWinCount == pveWinCount) &&
            (identical(other.pvpBattleCount, pvpBattleCount) ||
                other.pvpBattleCount == pvpBattleCount) &&
            (identical(other.pvpWinCount, pvpWinCount) ||
                other.pvpWinCount == pvpWinCount));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      name,
      favorite,
      const DeepCollectionEquality().hash(_characterIds),
      const DeepCollectionEquality().hash(_cardIds),
      pveBattleCount,
      pveWinCount,
      pvpBattleCount,
      pvpWinCount);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$DeckModelImplCopyWith<_$DeckModelImpl> get copyWith =>
      __$$DeckModelImplCopyWithImpl<_$DeckModelImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$DeckModelImplToJson(
      this,
    );
  }
}

abstract class _DeckModel extends DeckModel {
  const factory _DeckModel(
      {required final String id,
      required final String name,
      final bool favorite,
      required final List<String> characterIds,
      required final List<String> cardIds,
      final int pveBattleCount,
      final int pveWinCount,
      final int pvpBattleCount,
      final int pvpWinCount}) = _$DeckModelImpl;
  const _DeckModel._() : super._();

  factory _DeckModel.fromJson(Map<String, dynamic> json) =
      _$DeckModelImpl.fromJson;

  @override
  String get id;
  @override // 固有ID
  String get name;
  @override // デッキ名
  bool get favorite;
  @override // お気に入り
  List<String> get characterIds;
  @override // キャラクターカードID（最大3枚）
  List<String> get cardIds;
  @override // カードIDリスト（最大30枚）
  int get pveBattleCount;
  @override // PvEバトル回数
  int get pveWinCount;
  @override // PvE勝利回数
  int get pvpBattleCount;
  @override // PvPバトル回数
  int get pvpWinCount;
  @override
  @JsonKey(ignore: true)
  _$$DeckModelImplCopyWith<_$DeckModelImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
