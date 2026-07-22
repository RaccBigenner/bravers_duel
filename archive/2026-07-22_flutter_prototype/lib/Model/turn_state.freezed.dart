// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'turn_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

TurnState _$TurnStateFromJson(Map<String, dynamic> json) {
  return _TurnState.fromJson(json);
}

/// @nodoc
mixin _$TurnState {
  int get turnCount => throw _privateConstructorUsedError;
  String get turnActor =>
      throw _privateConstructorUsedError; // 'player' or 'enemy'
  TurnPhase get phase => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $TurnStateCopyWith<TurnState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TurnStateCopyWith<$Res> {
  factory $TurnStateCopyWith(TurnState value, $Res Function(TurnState) then) =
      _$TurnStateCopyWithImpl<$Res, TurnState>;
  @useResult
  $Res call({int turnCount, String turnActor, TurnPhase phase});
}

/// @nodoc
class _$TurnStateCopyWithImpl<$Res, $Val extends TurnState>
    implements $TurnStateCopyWith<$Res> {
  _$TurnStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? turnCount = null,
    Object? turnActor = null,
    Object? phase = null,
  }) {
    return _then(_value.copyWith(
      turnCount: null == turnCount
          ? _value.turnCount
          : turnCount // ignore: cast_nullable_to_non_nullable
              as int,
      turnActor: null == turnActor
          ? _value.turnActor
          : turnActor // ignore: cast_nullable_to_non_nullable
              as String,
      phase: null == phase
          ? _value.phase
          : phase // ignore: cast_nullable_to_non_nullable
              as TurnPhase,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$TurnStateImplCopyWith<$Res>
    implements $TurnStateCopyWith<$Res> {
  factory _$$TurnStateImplCopyWith(
          _$TurnStateImpl value, $Res Function(_$TurnStateImpl) then) =
      __$$TurnStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({int turnCount, String turnActor, TurnPhase phase});
}

/// @nodoc
class __$$TurnStateImplCopyWithImpl<$Res>
    extends _$TurnStateCopyWithImpl<$Res, _$TurnStateImpl>
    implements _$$TurnStateImplCopyWith<$Res> {
  __$$TurnStateImplCopyWithImpl(
      _$TurnStateImpl _value, $Res Function(_$TurnStateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? turnCount = null,
    Object? turnActor = null,
    Object? phase = null,
  }) {
    return _then(_$TurnStateImpl(
      turnCount: null == turnCount
          ? _value.turnCount
          : turnCount // ignore: cast_nullable_to_non_nullable
              as int,
      turnActor: null == turnActor
          ? _value.turnActor
          : turnActor // ignore: cast_nullable_to_non_nullable
              as String,
      phase: null == phase
          ? _value.phase
          : phase // ignore: cast_nullable_to_non_nullable
              as TurnPhase,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$TurnStateImpl implements _TurnState {
  const _$TurnStateImpl(
      {required this.turnCount,
      required this.turnActor,
      this.phase = TurnPhase.playCard});

  factory _$TurnStateImpl.fromJson(Map<String, dynamic> json) =>
      _$$TurnStateImplFromJson(json);

  @override
  final int turnCount;
  @override
  final String turnActor;
// 'player' or 'enemy'
  @override
  @JsonKey()
  final TurnPhase phase;

  @override
  String toString() {
    return 'TurnState(turnCount: $turnCount, turnActor: $turnActor, phase: $phase)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TurnStateImpl &&
            (identical(other.turnCount, turnCount) ||
                other.turnCount == turnCount) &&
            (identical(other.turnActor, turnActor) ||
                other.turnActor == turnActor) &&
            (identical(other.phase, phase) || other.phase == phase));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, turnCount, turnActor, phase);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$TurnStateImplCopyWith<_$TurnStateImpl> get copyWith =>
      __$$TurnStateImplCopyWithImpl<_$TurnStateImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$TurnStateImplToJson(
      this,
    );
  }
}

abstract class _TurnState implements TurnState {
  const factory _TurnState(
      {required final int turnCount,
      required final String turnActor,
      final TurnPhase phase}) = _$TurnStateImpl;

  factory _TurnState.fromJson(Map<String, dynamic> json) =
      _$TurnStateImpl.fromJson;

  @override
  int get turnCount;
  @override
  String get turnActor;
  @override // 'player' or 'enemy'
  TurnPhase get phase;
  @override
  @JsonKey(ignore: true)
  _$$TurnStateImplCopyWith<_$TurnStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
