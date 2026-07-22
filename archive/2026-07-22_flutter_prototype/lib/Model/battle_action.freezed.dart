// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'battle_action.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

/// @nodoc
mixin _$BattleAction {
  String get actor => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;

  @JsonKey(ignore: true)
  $BattleActionCopyWith<BattleAction> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BattleActionCopyWith<$Res> {
  factory $BattleActionCopyWith(
          BattleAction value, $Res Function(BattleAction) then) =
      _$BattleActionCopyWithImpl<$Res, BattleAction>;
  @useResult
  $Res call({String actor});
}

/// @nodoc
class _$BattleActionCopyWithImpl<$Res, $Val extends BattleAction>
    implements $BattleActionCopyWith<$Res> {
  _$BattleActionCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
  }) {
    return _then(_value.copyWith(
      actor: null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$StartTurnImplCopyWith<$Res>
    implements $BattleActionCopyWith<$Res> {
  factory _$$StartTurnImplCopyWith(
          _$StartTurnImpl value, $Res Function(_$StartTurnImpl) then) =
      __$$StartTurnImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String actor});
}

/// @nodoc
class __$$StartTurnImplCopyWithImpl<$Res>
    extends _$BattleActionCopyWithImpl<$Res, _$StartTurnImpl>
    implements _$$StartTurnImplCopyWith<$Res> {
  __$$StartTurnImplCopyWithImpl(
      _$StartTurnImpl _value, $Res Function(_$StartTurnImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
  }) {
    return _then(_$StartTurnImpl(
      actor: null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _$StartTurnImpl implements StartTurn {
  const _$StartTurnImpl({required this.actor});

  @override
  final String actor;

  @override
  String toString() {
    return 'BattleAction.startTurn(actor: $actor)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$StartTurnImpl &&
            (identical(other.actor, actor) || other.actor == actor));
  }

  @override
  int get hashCode => Object.hash(runtimeType, actor);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$StartTurnImplCopyWith<_$StartTurnImpl> get copyWith =>
      __$$StartTurnImplCopyWithImpl<_$StartTurnImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) {
    return startTurn(actor);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) {
    return startTurn?.call(actor);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) {
    if (startTurn != null) {
      return startTurn(actor);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) {
    return startTurn(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) {
    return startTurn?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) {
    if (startTurn != null) {
      return startTurn(this);
    }
    return orElse();
  }
}

abstract class StartTurn implements BattleAction {
  const factory StartTurn({required final String actor}) = _$StartTurnImpl;

  @override
  String get actor;
  @override
  @JsonKey(ignore: true)
  _$$StartTurnImplCopyWith<_$StartTurnImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$PlayCardImplCopyWith<$Res>
    implements $BattleActionCopyWith<$Res> {
  factory _$$PlayCardImplCopyWith(
          _$PlayCardImpl value, $Res Function(_$PlayCardImpl) then) =
      __$$PlayCardImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String actor, int handIndex, int? fieldIndex});
}

/// @nodoc
class __$$PlayCardImplCopyWithImpl<$Res>
    extends _$BattleActionCopyWithImpl<$Res, _$PlayCardImpl>
    implements _$$PlayCardImplCopyWith<$Res> {
  __$$PlayCardImplCopyWithImpl(
      _$PlayCardImpl _value, $Res Function(_$PlayCardImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
    Object? handIndex = null,
    Object? fieldIndex = freezed,
  }) {
    return _then(_$PlayCardImpl(
      null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
      null == handIndex
          ? _value.handIndex
          : handIndex // ignore: cast_nullable_to_non_nullable
              as int,
      freezed == fieldIndex
          ? _value.fieldIndex
          : fieldIndex // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc

class _$PlayCardImpl implements PlayCard {
  const _$PlayCardImpl(this.actor, this.handIndex, this.fieldIndex);

  @override
  final String actor;
  @override
  final int handIndex;
  @override
  final int? fieldIndex;

  @override
  String toString() {
    return 'BattleAction.playCard(actor: $actor, handIndex: $handIndex, fieldIndex: $fieldIndex)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlayCardImpl &&
            (identical(other.actor, actor) || other.actor == actor) &&
            (identical(other.handIndex, handIndex) ||
                other.handIndex == handIndex) &&
            (identical(other.fieldIndex, fieldIndex) ||
                other.fieldIndex == fieldIndex));
  }

  @override
  int get hashCode => Object.hash(runtimeType, actor, handIndex, fieldIndex);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PlayCardImplCopyWith<_$PlayCardImpl> get copyWith =>
      __$$PlayCardImplCopyWithImpl<_$PlayCardImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) {
    return playCard(actor, handIndex, fieldIndex);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) {
    return playCard?.call(actor, handIndex, fieldIndex);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) {
    if (playCard != null) {
      return playCard(actor, handIndex, fieldIndex);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) {
    return playCard(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) {
    return playCard?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) {
    if (playCard != null) {
      return playCard(this);
    }
    return orElse();
  }
}

abstract class PlayCard implements BattleAction {
  const factory PlayCard(
          final String actor, final int handIndex, final int? fieldIndex) =
      _$PlayCardImpl;

  @override
  String get actor;
  int get handIndex;
  int? get fieldIndex;
  @override
  @JsonKey(ignore: true)
  _$$PlayCardImplCopyWith<_$PlayCardImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$ChargeAPImplCopyWith<$Res>
    implements $BattleActionCopyWith<$Res> {
  factory _$$ChargeAPImplCopyWith(
          _$ChargeAPImpl value, $Res Function(_$ChargeAPImpl) then) =
      __$$ChargeAPImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String actor, int handIndex});
}

/// @nodoc
class __$$ChargeAPImplCopyWithImpl<$Res>
    extends _$BattleActionCopyWithImpl<$Res, _$ChargeAPImpl>
    implements _$$ChargeAPImplCopyWith<$Res> {
  __$$ChargeAPImplCopyWithImpl(
      _$ChargeAPImpl _value, $Res Function(_$ChargeAPImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
    Object? handIndex = null,
  }) {
    return _then(_$ChargeAPImpl(
      actor: null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
      handIndex: null == handIndex
          ? _value.handIndex
          : handIndex // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class _$ChargeAPImpl implements ChargeAP {
  const _$ChargeAPImpl({required this.actor, required this.handIndex});

  @override
  final String actor;
  @override
  final int handIndex;

  @override
  String toString() {
    return 'BattleAction.chargeAP(actor: $actor, handIndex: $handIndex)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChargeAPImpl &&
            (identical(other.actor, actor) || other.actor == actor) &&
            (identical(other.handIndex, handIndex) ||
                other.handIndex == handIndex));
  }

  @override
  int get hashCode => Object.hash(runtimeType, actor, handIndex);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$ChargeAPImplCopyWith<_$ChargeAPImpl> get copyWith =>
      __$$ChargeAPImplCopyWithImpl<_$ChargeAPImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) {
    return chargeAP(actor, handIndex);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) {
    return chargeAP?.call(actor, handIndex);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) {
    if (chargeAP != null) {
      return chargeAP(actor, handIndex);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) {
    return chargeAP(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) {
    return chargeAP?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) {
    if (chargeAP != null) {
      return chargeAP(this);
    }
    return orElse();
  }
}

abstract class ChargeAP implements BattleAction {
  const factory ChargeAP(
      {required final String actor,
      required final int handIndex}) = _$ChargeAPImpl;

  @override
  String get actor;
  int get handIndex;
  @override
  @JsonKey(ignore: true)
  _$$ChargeAPImplCopyWith<_$ChargeAPImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$EndTurnImplCopyWith<$Res>
    implements $BattleActionCopyWith<$Res> {
  factory _$$EndTurnImplCopyWith(
          _$EndTurnImpl value, $Res Function(_$EndTurnImpl) then) =
      __$$EndTurnImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String actor});
}

/// @nodoc
class __$$EndTurnImplCopyWithImpl<$Res>
    extends _$BattleActionCopyWithImpl<$Res, _$EndTurnImpl>
    implements _$$EndTurnImplCopyWith<$Res> {
  __$$EndTurnImplCopyWithImpl(
      _$EndTurnImpl _value, $Res Function(_$EndTurnImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
  }) {
    return _then(_$EndTurnImpl(
      actor: null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _$EndTurnImpl implements EndTurn {
  const _$EndTurnImpl({required this.actor});

  @override
  final String actor;

  @override
  String toString() {
    return 'BattleAction.endTurn(actor: $actor)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EndTurnImpl &&
            (identical(other.actor, actor) || other.actor == actor));
  }

  @override
  int get hashCode => Object.hash(runtimeType, actor);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$EndTurnImplCopyWith<_$EndTurnImpl> get copyWith =>
      __$$EndTurnImplCopyWithImpl<_$EndTurnImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) {
    return endTurn(actor);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) {
    return endTurn?.call(actor);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) {
    if (endTurn != null) {
      return endTurn(actor);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) {
    return endTurn(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) {
    return endTurn?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) {
    if (endTurn != null) {
      return endTurn(this);
    }
    return orElse();
  }
}

abstract class EndTurn implements BattleAction {
  const factory EndTurn({required final String actor}) = _$EndTurnImpl;

  @override
  String get actor;
  @override
  @JsonKey(ignore: true)
  _$$EndTurnImplCopyWith<_$EndTurnImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$NextPhaseImplCopyWith<$Res>
    implements $BattleActionCopyWith<$Res> {
  factory _$$NextPhaseImplCopyWith(
          _$NextPhaseImpl value, $Res Function(_$NextPhaseImpl) then) =
      __$$NextPhaseImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String actor});
}

/// @nodoc
class __$$NextPhaseImplCopyWithImpl<$Res>
    extends _$BattleActionCopyWithImpl<$Res, _$NextPhaseImpl>
    implements _$$NextPhaseImplCopyWith<$Res> {
  __$$NextPhaseImplCopyWithImpl(
      _$NextPhaseImpl _value, $Res Function(_$NextPhaseImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? actor = null,
  }) {
    return _then(_$NextPhaseImpl(
      actor: null == actor
          ? _value.actor
          : actor // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _$NextPhaseImpl implements NextPhase {
  const _$NextPhaseImpl({required this.actor});

  @override
  final String actor;

  @override
  String toString() {
    return 'BattleAction.nextPhase(actor: $actor)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$NextPhaseImpl &&
            (identical(other.actor, actor) || other.actor == actor));
  }

  @override
  int get hashCode => Object.hash(runtimeType, actor);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$NextPhaseImplCopyWith<_$NextPhaseImpl> get copyWith =>
      __$$NextPhaseImplCopyWithImpl<_$NextPhaseImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String actor) startTurn,
    required TResult Function(String actor, int handIndex, int? fieldIndex)
        playCard,
    required TResult Function(String actor, int handIndex) chargeAP,
    required TResult Function(String actor) endTurn,
    required TResult Function(String actor) nextPhase,
  }) {
    return nextPhase(actor);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String actor)? startTurn,
    TResult? Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult? Function(String actor, int handIndex)? chargeAP,
    TResult? Function(String actor)? endTurn,
    TResult? Function(String actor)? nextPhase,
  }) {
    return nextPhase?.call(actor);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String actor)? startTurn,
    TResult Function(String actor, int handIndex, int? fieldIndex)? playCard,
    TResult Function(String actor, int handIndex)? chargeAP,
    TResult Function(String actor)? endTurn,
    TResult Function(String actor)? nextPhase,
    required TResult orElse(),
  }) {
    if (nextPhase != null) {
      return nextPhase(actor);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(StartTurn value) startTurn,
    required TResult Function(PlayCard value) playCard,
    required TResult Function(ChargeAP value) chargeAP,
    required TResult Function(EndTurn value) endTurn,
    required TResult Function(NextPhase value) nextPhase,
  }) {
    return nextPhase(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(StartTurn value)? startTurn,
    TResult? Function(PlayCard value)? playCard,
    TResult? Function(ChargeAP value)? chargeAP,
    TResult? Function(EndTurn value)? endTurn,
    TResult? Function(NextPhase value)? nextPhase,
  }) {
    return nextPhase?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(StartTurn value)? startTurn,
    TResult Function(PlayCard value)? playCard,
    TResult Function(ChargeAP value)? chargeAP,
    TResult Function(EndTurn value)? endTurn,
    TResult Function(NextPhase value)? nextPhase,
    required TResult orElse(),
  }) {
    if (nextPhase != null) {
      return nextPhase(this);
    }
    return orElse();
  }
}

abstract class NextPhase implements BattleAction {
  const factory NextPhase({required final String actor}) = _$NextPhaseImpl;

  @override
  String get actor;
  @override
  @JsonKey(ignore: true)
  _$$NextPhaseImplCopyWith<_$NextPhaseImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
