import 'dart:convert';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Model/deck_model.dart';
import 'package:bravers_duel/View/card_detail_screen_view.dart';
import 'package:bravers_duel/Widget/card_list.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter/services.dart';
// import 'card_model.dart';
// import 'deck_model.dart';
// import 'card_frame.dart';
// import 'card_detail_screen.dart';

class DeckEditScreen extends HookWidget {
  final DeckModel deck;
  final List<String> ownedCardIds;

  const DeckEditScreen({
    super.key,
    required this.deck,
    required this.ownedCardIds,
  });

  Future<List<CardModel>> loadCardsFromJson() async {
    final jsonString =
        await rootBundle.loadString('lib/assets/json/cards.json');
    final List<dynamic> jsonList = json.decode(jsonString);
    return jsonList.map((e) => CardModel.fromJson(e)).toList();
  }

  @override
  Widget build(BuildContext context) {
    // カードマスターのロード
    final allCardsAsync = useFuture(useMemoized(loadCardsFromJson, const []));
    final editingCardIds = useState<List<String>>(List.of(deck.cardIds));
    final editingCharacterIds =
        useState<List<String>>(List.of(deck.characterIds));

    // ローディング中
    if (!allCardsAsync.hasData) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final allCards = allCardsAsync.data!;

    // 保有カードのID→枚数Map
    final Map<String, int> ownedCount = {};
    for (final id in ownedCardIds) {
      ownedCount[id] = (ownedCount[id] ?? 0) + 1;
    }

    // デッキのカードID→枚数Map
    final Map<String, int> deckCount = {};
    for (final id in editingCardIds.value) {
      deckCount[id] = (deckCount[id] ?? 0) + 1;
    }

    // 重複なし保有カード
    final uniqueOwnedIds = ownedCount.keys.toList();
    final ownedCards = uniqueOwnedIds
        .map((id) => allCards.firstWhere((card) => card.id == id))
        .toList();

    // キャラクターカード
    final characterCards = editingCharacterIds.value
        .map((id) => allCards.firstWhere((c) => c.id == id))
        .toList();

    // デッキカードリスト
    final deckCards = editingCardIds.value
        .map((id) => allCards.firstWhere((c) => c.id == id))
        .toList();

    // キャラがlegendaryLargeなら2枚でOK
    bool hasLegendaryLarge = characterCards.any(
      (c) => c is CharacterCard && c.size == 'legendaryLarge',
    );
    int characterLimit = hasLegendaryLarge ? 2 : 3;
    bool validCharCount = characterCards.length == characterLimit;
    bool validCardCount = editingCardIds.value.length == 30;
    bool canSubmit = validCharCount && validCardCount;

    return Scaffold(
      appBar: AppBar(
        title: const Text('デッキ編集'),
      ),
      body: Column(
        children: [
          // 上部1/4
          SizedBox(
            height: 180.h,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // キャラクターカード
                Text('キャラクター（${characterCards.length}/$characterLimit）',
                    style: TextStyle(
                        fontSize: 14.sp, fontWeight: FontWeight.bold)),
                SizedBox(
                  height: 77.w,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: characterCards.length,
                    separatorBuilder: (_, __) => SizedBox(width: 8.w),
                    itemBuilder: (context, idx) => CardFrame(
                      card: characterCards[idx],
                      width: 56.w,
                    ),
                  ),
                ),
                SizedBox(height: 8.w),
                // デッキカード
                Text('カード（${editingCardIds.value.length}/30）',
                    style: TextStyle(
                        fontSize: 14.sp, fontWeight: FontWeight.bold)),
                SizedBox(
                  height: 64.w,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: deckCards.length,
                    separatorBuilder: (_, __) => SizedBox(width: 4.w),
                    itemBuilder: (context, idx) => Stack(
                      alignment: Alignment.topRight,
                      children: [
                        GestureDetector(
                          onLongPress: () {
                            Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) =>
                                  CardDetailScreen(card: deckCards[idx]),
                            ));
                          },
                          child: CardFrame(
                            card: deckCards[idx],
                            width: 40.w,
                          ),
                        ),
                        // マイナスボタン
                        Positioned(
                          top: 0,
                          right: 0,
                          child: IconButton(
                            icon: const Icon(Icons.remove),
                            iconSize: 18.w,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () {
                              final updated =
                                  List<String>.from(editingCardIds.value);
                              updated.removeAt(idx);
                              editingCardIds.value = updated;
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // 下部3/4
          Expanded(
            child: CardListView(
              cards: ownedCards,
              crossAxisCount: 3,
              onTap: (card, idx) {
                final own = ownedCount[card.id] ?? 0;
                final deck = deckCount[card.id] ?? 0;
                final canAdd =
                    own > deck && deck < 3 && editingCardIds.value.length < 30;
                if (canAdd) {
                  final updated = List<String>.from(editingCardIds.value);
                  updated.add(card.id);
                  editingCardIds.value = updated;
                }
              },
              onLongPress: (card, idx) {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CardDetailScreen(card: card),
                  ),
                );
              },
              overlayBuilder: (context, card, idx) {
                final own = ownedCount[card.id] ?? 0;
                final deck = deckCount[card.id] ?? 0;
                return Positioned(
                  bottom: 6.w,
                  left: 0,
                  right: 0,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: EdgeInsets.symmetric(
                            horizontal: 6.w, vertical: 2.w),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(deck > 0 ? 0.5 : 0.3),
                          borderRadius: BorderRadius.circular(10.w),
                        ),
                        child: Text('$deck/$own',
                            style: TextStyle(
                                color: Colors.white, fontSize: 12.sp)),
                      ),
                      // マイナスボタン（デッキに入っていれば表示）
                      if (deck > 0)
                        Padding(
                          padding: EdgeInsets.only(left: 8.w),
                          child: GestureDetector(
                            onTap: () {
                              // 該当カードIDの最初の1枚だけremove
                              final updated =
                                  List<String>.from(editingCardIds.value);
                              final removeIdx = updated.indexOf(card.id);
                              if (removeIdx >= 0) {
                                updated.removeAt(removeIdx);
                                editingCardIds.value = updated;
                              }
                            },
                            child: Container(
                              width: 24.w,
                              height: 24.w,
                              decoration: const BoxDecoration(
                                color: Colors.redAccent,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.remove,
                                  color: Colors.white, size: 16),
                            ),
                          ),
                        ),
                    ],
                  ),
                );
              },
              cardWidth: double.infinity, // グリッド幅に合わせる
            ),
          ),
          // 確定ボタン
          Padding(
            padding: EdgeInsets.all(8.w),
            child: ElevatedButton(
              onPressed: canSubmit ? () {} : null,
              child: const Text('デッキを確定'),
            ),
          ),
        ],
      ),
    );
  }
}
