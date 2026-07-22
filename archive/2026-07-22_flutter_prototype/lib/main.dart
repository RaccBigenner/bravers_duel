import 'dart:async';

import 'package:bravers_duel/Model/battle_state.dart';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Repository/card_data.dart';
import 'package:bravers_duel/Theme/sample_maker.dart';
import 'package:bravers_duel/View/battle_screen.dart';
import 'package:bravers_duel/View/card_detail_screen_view.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 縦持ち固定
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      child: ScreenUtilInit(
        designSize: const Size(360, 690),
        minTextAdapt: true,
        splitScreenMode: true,
        builder: (context, child) {
          return MaterialApp(
            title: 'BRAVER\'S DUEL',
            theme: ThemeData(
              colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
              useMaterial3: true,
            ),
            home: const BattleLoaderScreen(),
          );
        },
      ),
    );
  }
}

// 仮自分のID
const playerId = 'mamamamamamam';
const enemyId = 'enenenenenenen';

class BattleLoaderScreen extends HookWidget {
  const BattleLoaderScreen({super.key});
  @override
  Widget build(BuildContext context) {
    // カードマスターのロード
    final cardsFuture = useMemoized(loadCardsFromJson, const []);
    final cardsSnapshot = useFuture(cardsFuture);

    if (!cardsSnapshot.hasData) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final cardMaster = cardsSnapshot.data!;

    // デッキサンプル（今回は0番を両者に流用、必要に応じて変えてOK）
    final playerDeck = deckSampleMaker(0);
    final enemyDeck = deckSampleMaker(0);

    // BattleStateの初期化
    final battleState = BattleState.initial(
      playerId: playerId,
      playerDeckModel: playerDeck,
      enemyId: enemyId,
      enemyDeckModel: enemyDeck,
      cardMaster: cardMaster,
    );

    return BattleScreen(initial: battleState);
  }
}

class CardListScreen extends StatefulWidget {
  const CardListScreen({super.key});

  @override
  State<CardListScreen> createState() => _CardListScreenState();
}

class _CardListScreenState extends State<CardListScreen> {
  List<CardModel> allCards = [];
  int displayedCount = 0;

  @override
  void initState() {
    super.initState();
    loadCardsAndStartTimer();
  }

  Future<void> loadCardsAndStartTimer() async {
    final jsonString =
        await rootBundle.loadString('lib/assets/json/cards.json');
    final List<dynamic> jsonList = json.decode(jsonString);
    allCards = jsonList.map((e) => CardModel.fromJson(e)).toList();

    // タイマーで0.5秒ごとに1枚ずつ表示
    Timer.periodic(const Duration(milliseconds: 5), (timer) {
      if (displayedCount >= allCards.length) {
        timer.cancel();
      } else {
        setState(() {
          displayedCount++;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final cards = allCards.take(displayedCount).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('カード描画テスト'),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(8),
          child: Wrap(
            spacing: 2.w,
            runSpacing: 2.w,
            children: cards.map((card) {
              return GestureDetector(
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CardDetailScreen(card: card),
                      ),
                    );
                  },
                  child: CardFrame(
                    card: card,
                    width: 100.w,
                  ));
            }).toList(),
          ),
        ),
      ),
    );
  }
}
