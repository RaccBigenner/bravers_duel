import 'dart:convert';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Model/deck_model.dart';
import 'package:bravers_duel/Theme/sample_maker.dart';
import 'package:bravers_duel/View/card_detail_screen_view.dart';
import 'package:bravers_duel/View/deck_edit_screen.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter/services.dart';

class DeckDetailScreen extends HookWidget {
  final DeckModel deck;

  const DeckDetailScreen({
    super.key,
    required this.deck,
  });

  Future<List<CardModel>> loadCardsFromJson() async {
    final jsonString =
        await rootBundle.loadString('lib/assets/json/cards.json');
    final List<dynamic> jsonList = json.decode(jsonString);
    return jsonList.map((e) => CardModel.fromJson(e)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final allCardsAsync = useFuture(useMemoized(loadCardsFromJson, const []));

    if (!allCardsAsync.hasData) {
      // ローディング中
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final allCards = allCardsAsync.data!;

    // キャラクターカード
    final characterCards =
        allCards.where((card) => deck.characterIds.contains(card.id)).toList();

    // デッキカード（重複・順番あり）
    final deckCards = deck.cardIds
        .map((id) => allCards.firstWhere((card) => card.id == id))
        .toList();

    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => DeckEditScreen(
                    deck: deck,
                    ownedCardIds: holdCardsSample(), // 必要に応じて変更
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: Padding(
        padding: EdgeInsets.all(12.w),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // デッキ名
              Text(
                deck.name,
                style: TextStyle(
                  fontSize: 22.sp,
                  fontWeight: FontWeight.bold,
                ),
              ),
              SizedBox(height: 16.w),

              // キャラクター一覧
              Text('キャラクター (${characterCards.length}/3)',
                  style:
                      TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold)),
              SizedBox(height: 8.w),
              Row(
                children: characterCards
                    .map(
                      (chara) => Padding(
                        padding: EdgeInsets.only(right: 8.w),
                        child: GestureDetector(
                          onLongPress: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => CardDetailScreen(card: chara),
                              ),
                            );
                          },
                          child: CardFrame(
                            card: chara,
                            width: 60.w,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
              SizedBox(height: 24.w),

              // カード一覧
              Text('カード一覧 (${deckCards.length}/30)',
                  style:
                      TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold)),
              SizedBox(height: 8.w),
              Wrap(
                spacing: 4.w,
                runSpacing: 4.w,
                children: deckCards
                    .map(
                      (card) => GestureDetector(
                        onLongPress: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => CardDetailScreen(card: card),
                            ),
                          );
                        },
                        child: CardFrame(
                          card: card,
                          width: 48.w,
                        ),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
