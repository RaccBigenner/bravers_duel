// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'battle_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

BattleState _$BattleStateFromJson(Map<String, dynamic> json) {
  return _BattleState.fromJson(json);
}

/// @nodoc
mixin _$BattleState {
// ゲーム進行面
  String get battleUuid => throw _privateConstructorUsedError;
  PlayerState get host => throw _privateConstructorUsedError;
  PlayerState get guest => throw _privateConstructorUsedError;
  TurnState get turnState => throw _privateConstructorUsedError;
  CardModel? get fieldCard => throw _privateConstructorUsedError;
  List<BattleEvent> get events => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $BattleStateCopyWith<BattleState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BattleStateCopyWith<$Res> {
  factory $BattleStateCopyWith(
          BattleState value, $Res Function(BattleState) then) =
      _$BattleStateCopyWithImpl<$Res, BattleState>;
  @useResult
  $Res call(
      {String battleUuid,
      PlayerState host,
      PlayerState guest,
      TurnState turnState,
      CardModel? fieldCard,
      List<BattleEvent> events});

  $PlayerStateCopyWith<$Res> get host;
  $PlayerStateCopyWith<$Res> get guest;
  $TurnStateCopyWith<$Res> get turnState;
  $CardModelCopyWith<$Res>? get fieldCard;
}

/// @nodoc
class _$BattleStateCopyWithImpl<$Res, $Val extends BattleState>
    implements $BattleStateCopyWith<$Res> {
  _$BattleStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? battleUuid = null,
    Object? host = null,
    Object? guest = null,
    Object? turnState = null,
    Object? fieldCard = freezed,
    Object? events = null,
  }) {
    return _then(_value.copyWith(
      battleUuid: null == battleUuid
          ? _value.battleUuid
          : battleUuid // ignore: cast_nullable_to_non_nullable
              as String,
      host: null == host
          ? _value.host
          : host // ignore: cast_nullable_to_non_nullable
              as PlayerState,
      guest: null == guest
          ? _value.guest
          : guest // ignore: cast_nullable_to_non_nullable
              as PlayerState,
      turnState: null == turnState
          ? _value.turnState
          : turnState // ignore: cast_nullable_to_non_nullable
              as TurnState,
      fieldCard: freezed == fieldCard
          ? _value.fieldCard
          : fieldCard // ignore: cast_nullable_to_non_nullable
              as CardModel?,
      events: null == events
          ? _value.events
          : events // ignore: cast_nullable_to_non_nullable
              as List<BattleEvent>,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $PlayerStateCopyWith<$Res> get host {
    return $PlayerStateCopyWith<$Res>(_value.host, (value) {
      return _then(_value.copyWith(host: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $PlayerStateCopyWith<$Res> get guest {
    return $PlayerStateCopyWith<$Res>(_value.guest, (value) {
      return _then(_value.copyWith(guest: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $TurnStateCopyWith<$Res> get turnState {
    return $TurnStateCopyWith<$Res>(_value.turnState, (value) {
      return _then(_value.copyWith(turnState: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $CardModelCopyWith<$Res>? get fieldCard {
    if (_value.fieldCard == null) {
      return null;
    }

    return $CardModelCopyWith<$Res>(_value.fieldCard!, (value) {
      return _then(_value.copyWith(fieldCard: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$BattleStateImplCopyWith<$Res>
    implements $BattleStateCopyWith<$Res> {
  factory _$$BattleStateImplCopyWith(
          _$BattleStateImpl value, $Res Function(_$BattleStateImpl) then) =
      __$$BattleStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String battleUuid,
      PlayerState host,
      PlayerState guest,
      TurnState turnState,
      CardModel? fieldCard,
      List<BattleEvent> events});

  @override
  $PlayerStateCopyWith<$Res> get host;
  @override
  $PlayerStateCopyWith<$Res> get guest;
  @override
  $TurnStateCopyWith<$Res> get turnState;
  @override
  $CardModelCopyWith<$Res>? get fieldCard;
}

/// @nodoc
class __$$BattleStateImplCopyWithImpl<$Res>
    extends _$BattleStateCopyWithImpl<$Res, _$BattleStateImpl>
    implements _$$BattleStateImplCopyWith<$Res> {
  __$$BattleStateImplCopyWithImpl(
      _$BattleStateImpl _value, $Res Function(_$BattleStateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? battleUuid = null,
    Object? host = null,
    Object? guest = null,
    Object? turnState = null,
    Object? fieldCard = freezed,
    Object? events = null,
  }) {
    return _then(_$BattleStateImpl(
      battleUuid: null == battleUuid
          ? _value.battleUuid
          : battleUuid // ignore: cast_nullable_to_non_nullable
              as String,
      host: null == host
          ? _value.host
          : host // ignore: cast_nullable_to_non_nullable
              as PlayerState,
      guest: null == guest
          ? _value.guest
          : guest // ignore: cast_nullable_to_non_nullable
              as PlayerState,
      turnState: null == turnState
          ? _value.turnState
          : turnState // ignore: cast_nullable_to_non_nullable
              as TurnState,
      fieldCard: freezed == fieldCard
          ? _value.fieldCard
          : fieldCard // ignore: cast_nullable_to_non_nullable
              as CardModel?,
      events: null == events
          ? _value._events
          : events // ignore: cast_nullable_to_non_nullable
              as List<BattleEvent>,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$BattleStateImpl implements _BattleState {
  const _$BattleStateImpl(
      {required this.battleUuid,
      required this.host,
      required this.guest,
      required this.turnState,
      this.fieldCard,
      final List<BattleEvent> events = const []})
      : _events = events;

  factory _$BattleStateImpl.fromJson(Map<String, dynamic> json) =>
      _$$BattleStateImplFromJson(json);

// ゲーム進行面
  @override
  final String battleUuid;
  @override
  final PlayerState host;
  @override
  final PlayerState guest;
  @override
  final TurnState turnState;
  @override
  final CardModel? fieldCard;
  final List<BattleEvent> _events;
  @override
  @JsonKey()
  List<BattleEvent> get events {
    if (_events is EqualUnmodifiableListView) return _events;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_events);
  }

  @override
  String toString() {
    return 'BattleState(battleUuid: $battleUuid, host: $host, guest: $guest, turnState: $turnState, fieldCard: $fieldCard, events: $events)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BattleStateImpl &&
            (identical(other.battleUuid, battleUuid) ||
                other.battleUuid == battleUuid) &&
            (identical(other.host, host) || other.host == host) &&
            (identical(other.guest, guest) || other.guest == guest) &&
            (identical(other.turnState, turnState) ||
                other.turnState == turnState) &&
            (identical(other.fieldCard, fieldCard) ||
                other.fieldCard == fieldCard) &&
            const DeepCollectionEquality().equals(other._events, _events));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, battleUuid, host, guest,
      turnState, fieldCard, const DeepCollectionEquality().hash(_events));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$BattleStateImplCopyWith<_$BattleStateImpl> get copyWith =>
      __$$BattleStateImplCopyWithImpl<_$BattleStateImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BattleStateImplToJson(
      this,
    );
  }
}

abstract class _BattleState implements BattleState {
  const factory _BattleState(
      {required final String battleUuid,
      required final PlayerState host,
      required final PlayerState guest,
      required final TurnState turnState,
      final CardModel? fieldCard,
      final List<BattleEvent> events}) = _$BattleStateImpl;

  factory _BattleState.fromJson(Map<String, dynamic> json) =
      _$BattleStateImpl.fromJson;

  @override // ゲーム進行面
  String get battleUuid;
  @override
  PlayerState get host;
  @override
  PlayerState get guest;
  @override
  TurnState get turnState;
  @override
  CardModel? get fieldCard;
  @override
  List<BattleEvent> get events;
  @override
  @JsonKey(ignore: true)
  _$$BattleStateImplCopyWith<_$BattleStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PlayerState _$PlayerStateFromJson(Map<String, dynamic> json) {
  return _PlayerState.fromJson(json);
}

/// @nodoc
mixin _$PlayerState {
// ゲーム進行面
  String get playerId => throw _privateConstructorUsedError;
  List<CardModel> get deck => throw _privateConstructorUsedError;
  List<CardModel> get hand => throw _privateConstructorUsedError;
  List<CardModel> get trash => throw _privateConstructorUsedError;
  List<CardModel> get ap => throw _privateConstructorUsedError;
  List<CharacterState> get characters => throw _privateConstructorUsedError;
  int get processedSeq => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $PlayerStateCopyWith<PlayerState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PlayerStateCopyWith<$Res> {
  factory $PlayerStateCopyWith(
          PlayerState value, $Res Function(PlayerState) then) =
      _$PlayerStateCopyWithImpl<$Res, PlayerState>;
  @useResult
  $Res call(
      {String playerId,
      List<CardModel> deck,
      List<CardModel> hand,
      List<CardModel> trash,
      List<CardModel> ap,
      List<CharacterState> characters,
      int processedSeq});
}

/// @nodoc
class _$PlayerStateCopyWithImpl<$Res, $Val extends PlayerState>
    implements $PlayerStateCopyWith<$Res> {
  _$PlayerStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? playerId = null,
    Object? deck = null,
    Object? hand = null,
    Object? trash = null,
    Object? ap = null,
    Object? characters = null,
    Object? processedSeq = null,
  }) {
    return _then(_value.copyWith(
      playerId: null == playerId
          ? _value.playerId
          : playerId // ignore: cast_nullable_to_non_nullable
              as String,
      deck: null == deck
          ? _value.deck
          : deck // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      hand: null == hand
          ? _value.hand
          : hand // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      trash: null == trash
          ? _value.trash
          : trash // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      ap: null == ap
          ? _value.ap
          : ap // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      characters: null == characters
          ? _value.characters
          : characters // ignore: cast_nullable_to_non_nullable
              as List<CharacterState>,
      processedSeq: null == processedSeq
          ? _value.processedSeq
          : processedSeq // ignore: cast_nullable_to_non_nullable
              as int,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$PlayerStateImplCopyWith<$Res>
    implements $PlayerStateCopyWith<$Res> {
  factory _$$PlayerStateImplCopyWith(
          _$PlayerStateImpl value, $Res Function(_$PlayerStateImpl) then) =
      __$$PlayerStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String playerId,
      List<CardModel> deck,
      List<CardModel> hand,
      List<CardModel> trash,
      List<CardModel> ap,
      List<CharacterState> characters,
      int processedSeq});
}

/// @nodoc
class __$$PlayerStateImplCopyWithImpl<$Res>
    extends _$PlayerStateCopyWithImpl<$Res, _$PlayerStateImpl>
    implements _$$PlayerStateImplCopyWith<$Res> {
  __$$PlayerStateImplCopyWithImpl(
      _$PlayerStateImpl _value, $Res Function(_$PlayerStateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? playerId = null,
    Object? deck = null,
    Object? hand = null,
    Object? trash = null,
    Object? ap = null,
    Object? characters = null,
    Object? processedSeq = null,
  }) {
    return _then(_$PlayerStateImpl(
      playerId: null == playerId
          ? _value.playerId
          : playerId // ignore: cast_nullable_to_non_nullable
              as String,
      deck: null == deck
          ? _value._deck
          : deck // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      hand: null == hand
          ? _value._hand
          : hand // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      trash: null == trash
          ? _value._trash
          : trash // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      ap: null == ap
          ? _value._ap
          : ap // ignore: cast_nullable_to_non_nullable
              as List<CardModel>,
      characters: null == characters
          ? _value._characters
          : characters // ignore: cast_nullable_to_non_nullable
              as List<CharacterState>,
      processedSeq: null == processedSeq
          ? _value.processedSeq
          : processedSeq // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$PlayerStateImpl implements _PlayerState {
  const _$PlayerStateImpl(
      {required this.playerId,
      required final List<CardModel> deck,
      required final List<CardModel> hand,
      required final List<CardModel> trash,
      required final List<CardModel> ap,
      required final List<CharacterState> characters,
      required this.processedSeq})
      : _deck = deck,
        _hand = hand,
        _trash = trash,
        _ap = ap,
        _characters = characters;

  factory _$PlayerStateImpl.fromJson(Map<String, dynamic> json) =>
      _$$PlayerStateImplFromJson(json);

// ゲーム進行面
  @override
  final String playerId;
  final List<CardModel> _deck;
  @override
  List<CardModel> get deck {
    if (_deck is EqualUnmodifiableListView) return _deck;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_deck);
  }

  final List<CardModel> _hand;
  @override
  List<CardModel> get hand {
    if (_hand is EqualUnmodifiableListView) return _hand;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_hand);
  }

  final List<CardModel> _trash;
  @override
  List<CardModel> get trash {
    if (_trash is EqualUnmodifiableListView) return _trash;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_trash);
  }

  final List<CardModel> _ap;
  @override
  List<CardModel> get ap {
    if (_ap is EqualUnmodifiableListView) return _ap;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_ap);
  }

  final List<CharacterState> _characters;
  @override
  List<CharacterState> get characters {
    if (_characters is EqualUnmodifiableListView) return _characters;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_characters);
  }

  @override
  final int processedSeq;

  @override
  String toString() {
    return 'PlayerState(playerId: $playerId, deck: $deck, hand: $hand, trash: $trash, ap: $ap, characters: $characters, processedSeq: $processedSeq)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlayerStateImpl &&
            (identical(other.playerId, playerId) ||
                other.playerId == playerId) &&
            const DeepCollectionEquality().equals(other._deck, _deck) &&
            const DeepCollectionEquality().equals(other._hand, _hand) &&
            const DeepCollectionEquality().equals(other._trash, _trash) &&
            const DeepCollectionEquality().equals(other._ap, _ap) &&
            const DeepCollectionEquality()
                .equals(other._characters, _characters) &&
            (identical(other.processedSeq, processedSeq) ||
                other.processedSeq == processedSeq));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      playerId,
      const DeepCollectionEquality().hash(_deck),
      const DeepCollectionEquality().hash(_hand),
      const DeepCollectionEquality().hash(_trash),
      const DeepCollectionEquality().hash(_ap),
      const DeepCollectionEquality().hash(_characters),
      processedSeq);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PlayerStateImplCopyWith<_$PlayerStateImpl> get copyWith =>
      __$$PlayerStateImplCopyWithImpl<_$PlayerStateImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PlayerStateImplToJson(
      this,
    );
  }
}

abstract class _PlayerState implements PlayerState {
  const factory _PlayerState(
      {required final String playerId,
      required final List<CardModel> deck,
      required final List<CardModel> hand,
      required final List<CardModel> trash,
      required final List<CardModel> ap,
      required final List<CharacterState> characters,
      required final int processedSeq}) = _$PlayerStateImpl;

  factory _PlayerState.fromJson(Map<String, dynamic> json) =
      _$PlayerStateImpl.fromJson;

  @override // ゲーム進行面
  String get playerId;
  @override
  List<CardModel> get deck;
  @override
  List<CardModel> get hand;
  @override
  List<CardModel> get trash;
  @override
  List<CardModel> get ap;
  @override
  List<CharacterState> get characters;
  @override
  int get processedSeq;
  @override
  @JsonKey(ignore: true)
  _$$PlayerStateImplCopyWith<_$PlayerStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

BattleEvent _$BattleEventFromJson(Map<String, dynamic> json) {
  return _BattleEvent.fromJson(json);
}

/// @nodoc
mixin _$BattleEvent {
// ゲーム進行面
  int get seq => throw _privateConstructorUsedError;
  String get actorId => throw _privateConstructorUsedError;
  String get type =>
      throw _privateConstructorUsedError; // playCard/attackTo/damage/draw/trashTo/chargeFromDeck/etc...
  List<String> get targets => throw _privateConstructorUsedError;
  int get value => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $BattleEventCopyWith<BattleEvent> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BattleEventCopyWith<$Res> {
  factory $BattleEventCopyWith(
          BattleEvent value, $Res Function(BattleEvent) then) =
      _$BattleEventCopyWithImpl<$Res, BattleEvent>;
  @useResult
  $Res call(
      {int seq, String actorId, String type, List<String> targets, int value});
}

/// @nodoc
class _$BattleEventCopyWithImpl<$Res, $Val extends BattleEvent>
    implements $BattleEventCopyWith<$Res> {
  _$BattleEventCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? seq = null,
    Object? actorId = null,
    Object? type = null,
    Object? targets = null,
    Object? value = null,
  }) {
    return _then(_value.copyWith(
      seq: null == seq
          ? _value.seq
          : seq // ignore: cast_nullable_to_non_nullable
              as int,
      actorId: null == actorId
          ? _value.actorId
          : actorId // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as String,
      targets: null == targets
          ? _value.targets
          : targets // ignore: cast_nullable_to_non_nullable
              as List<String>,
      value: null == value
          ? _value.value
          : value // ignore: cast_nullable_to_non_nullable
              as int,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$BattleEventImplCopyWith<$Res>
    implements $BattleEventCopyWith<$Res> {
  factory _$$BattleEventImplCopyWith(
          _$BattleEventImpl value, $Res Function(_$BattleEventImpl) then) =
      __$$BattleEventImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {int seq, String actorId, String type, List<String> targets, int value});
}

/// @nodoc
class __$$BattleEventImplCopyWithImpl<$Res>
    extends _$BattleEventCopyWithImpl<$Res, _$BattleEventImpl>
    implements _$$BattleEventImplCopyWith<$Res> {
  __$$BattleEventImplCopyWithImpl(
      _$BattleEventImpl _value, $Res Function(_$BattleEventImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? seq = null,
    Object? actorId = null,
    Object? type = null,
    Object? targets = null,
    Object? value = null,
  }) {
    return _then(_$BattleEventImpl(
      seq: null == seq
          ? _value.seq
          : seq // ignore: cast_nullable_to_non_nullable
              as int,
      actorId: null == actorId
          ? _value.actorId
          : actorId // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as String,
      targets: null == targets
          ? _value._targets
          : targets // ignore: cast_nullable_to_non_nullable
              as List<String>,
      value: null == value
          ? _value.value
          : value // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$BattleEventImpl implements _BattleEvent {
  const _$BattleEventImpl(
      {required this.seq,
      required this.actorId,
      required this.type,
      required final List<String> targets,
      required this.value})
      : _targets = targets;

  factory _$BattleEventImpl.fromJson(Map<String, dynamic> json) =>
      _$$BattleEventImplFromJson(json);

// ゲーム進行面
  @override
  final int seq;
  @override
  final String actorId;
  @override
  final String type;
// playCard/attackTo/damage/draw/trashTo/chargeFromDeck/etc...
  final List<String> _targets;
// playCard/attackTo/damage/draw/trashTo/chargeFromDeck/etc...
  @override
  List<String> get targets {
    if (_targets is EqualUnmodifiableListView) return _targets;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_targets);
  }

  @override
  final int value;

  @override
  String toString() {
    return 'BattleEvent(seq: $seq, actorId: $actorId, type: $type, targets: $targets, value: $value)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BattleEventImpl &&
            (identical(other.seq, seq) || other.seq == seq) &&
            (identical(other.actorId, actorId) || other.actorId == actorId) &&
            (identical(other.type, type) || other.type == type) &&
            const DeepCollectionEquality().equals(other._targets, _targets) &&
            (identical(other.value, value) || other.value == value));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, seq, actorId, type,
      const DeepCollectionEquality().hash(_targets), value);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$BattleEventImplCopyWith<_$BattleEventImpl> get copyWith =>
      __$$BattleEventImplCopyWithImpl<_$BattleEventImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BattleEventImplToJson(
      this,
    );
  }
}

abstract class _BattleEvent implements BattleEvent {
  const factory _BattleEvent(
      {required final int seq,
      required final String actorId,
      required final String type,
      required final List<String> targets,
      required final int value}) = _$BattleEventImpl;

  factory _BattleEvent.fromJson(Map<String, dynamic> json) =
      _$BattleEventImpl.fromJson;

  @override // ゲーム進行面
  int get seq;
  @override
  String get actorId;
  @override
  String get type;
  @override // playCard/attackTo/damage/draw/trashTo/chargeFromDeck/etc...
  List<String> get targets;
  @override
  int get value;
  @override
  @JsonKey(ignore: true)
  _$$BattleEventImplCopyWith<_$BattleEventImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
