// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'battle_anim_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

BattleAnimEvent _$BattleAnimEventFromJson(Map<String, dynamic> json) {
  return _BattleAnimEvent.fromJson(json);
}

/// @nodoc
mixin _$BattleAnimEvent {
  String get type => throw _privateConstructorUsedError;
  Map<String, dynamic>? get payload => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $BattleAnimEventCopyWith<BattleAnimEvent> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BattleAnimEventCopyWith<$Res> {
  factory $BattleAnimEventCopyWith(
          BattleAnimEvent value, $Res Function(BattleAnimEvent) then) =
      _$BattleAnimEventCopyWithImpl<$Res, BattleAnimEvent>;
  @useResult
  $Res call({String type, Map<String, dynamic>? payload});
}

/// @nodoc
class _$BattleAnimEventCopyWithImpl<$Res, $Val extends BattleAnimEvent>
    implements $BattleAnimEventCopyWith<$Res> {
  _$BattleAnimEventCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? payload = freezed,
  }) {
    return _then(_value.copyWith(
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as String,
      payload: freezed == payload
          ? _value.payload
          : payload // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$BattleAnimEventImplCopyWith<$Res>
    implements $BattleAnimEventCopyWith<$Res> {
  factory _$$BattleAnimEventImplCopyWith(_$BattleAnimEventImpl value,
          $Res Function(_$BattleAnimEventImpl) then) =
      __$$BattleAnimEventImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String type, Map<String, dynamic>? payload});
}

/// @nodoc
class __$$BattleAnimEventImplCopyWithImpl<$Res>
    extends _$BattleAnimEventCopyWithImpl<$Res, _$BattleAnimEventImpl>
    implements _$$BattleAnimEventImplCopyWith<$Res> {
  __$$BattleAnimEventImplCopyWithImpl(
      _$BattleAnimEventImpl _value, $Res Function(_$BattleAnimEventImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? payload = freezed,
  }) {
    return _then(_$BattleAnimEventImpl(
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as String,
      payload: freezed == payload
          ? _value._payload
          : payload // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$BattleAnimEventImpl implements _BattleAnimEvent {
  const _$BattleAnimEventImpl(
      {required this.type, final Map<String, dynamic>? payload})
      : _payload = payload;

  factory _$BattleAnimEventImpl.fromJson(Map<String, dynamic> json) =>
      _$$BattleAnimEventImplFromJson(json);

  @override
  final String type;
  final Map<String, dynamic>? _payload;
  @override
  Map<String, dynamic>? get payload {
    final value = _payload;
    if (value == null) return null;
    if (_payload is EqualUnmodifiableMapView) return _payload;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  @override
  String toString() {
    return 'BattleAnimEvent(type: $type, payload: $payload)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BattleAnimEventImpl &&
            (identical(other.type, type) || other.type == type) &&
            const DeepCollectionEquality().equals(other._payload, _payload));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType, type, const DeepCollectionEquality().hash(_payload));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$BattleAnimEventImplCopyWith<_$BattleAnimEventImpl> get copyWith =>
      __$$BattleAnimEventImplCopyWithImpl<_$BattleAnimEventImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BattleAnimEventImplToJson(
      this,
    );
  }
}

abstract class _BattleAnimEvent implements BattleAnimEvent {
  const factory _BattleAnimEvent(
      {required final String type,
      final Map<String, dynamic>? payload}) = _$BattleAnimEventImpl;

  factory _BattleAnimEvent.fromJson(Map<String, dynamic> json) =
      _$BattleAnimEventImpl.fromJson;

  @override
  String get type;
  @override
  Map<String, dynamic>? get payload;
  @override
  @JsonKey(ignore: true)
  _$$BattleAnimEventImplCopyWith<_$BattleAnimEventImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
