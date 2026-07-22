import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:flutter/material.dart';

class CardDetailScreen extends StatelessWidget {
  final CardModel card;

  const CardDetailScreen({super.key, required this.card});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(card.name),
      ),
      body: Center(
        child: CardWidget(
          card: card,
        ),
      ),
    );
  }
}
