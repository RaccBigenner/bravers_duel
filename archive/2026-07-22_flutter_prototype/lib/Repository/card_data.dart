import 'dart:convert';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:flutter/services.dart';

Future<List<CardModel>> loadCardsFromJson() async {
  final jsonString = await rootBundle.loadString('lib/assets/json/cards.json');
  final List<dynamic> jsonList = json.decode(jsonString);

  return jsonList.map((e) => CardModel.fromJson(e)).toList();
}
