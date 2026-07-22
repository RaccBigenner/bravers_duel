import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:uuid/uuid.dart';

part 'deck_model.freezed.dart';
part 'deck_model.g.dart';

@freezed
class DeckModel with _$DeckModel {
  const factory DeckModel({
    required String id, // 固有ID
    required String name, // デッキ名
    @Default(false) bool favorite, // お気に入り
    required List<String> characterIds, // キャラクターカードID（最大3枚）
    required List<String> cardIds, // カードIDリスト（最大30枚）
    @Default(0) int pveBattleCount, // PvEバトル回数
    @Default(0) int pveWinCount, // PvE勝利回数
    @Default(0) int pvpBattleCount, // PvPバトル回数
    @Default(0) int pvpWinCount, // PvP勝利回数
  }) = _DeckModel;

  // ★ここでconst DeckModel._()を追加！
  const DeckModel._();

  /// 空のデッキを生成するファクトリ
  factory DeckModel.empty({String? id, String? name}) => DeckModel(
        id: const Uuid().v4(),
        name: name ?? '',
        favorite: false,
        characterIds: const [],
        cardIds: const [],
        pveBattleCount: 0,
        pveWinCount: 0,
        pvpBattleCount: 0,
        pvpWinCount: 0,
      );

  // 例：最大キャラ数判定
  bool get isMaxCharacter => characterIds.length >= 3;

  // 例：最大カード数判定
  bool get isMaxCard => cardIds.length >= 30;

  // 例：勝率
  double get pveWinRate =>
      pveBattleCount == 0 ? 0 : pveWinCount / pveBattleCount;

  factory DeckModel.fromJson(Map<String, dynamic> json) =>
      _$DeckModelFromJson(json);
}
