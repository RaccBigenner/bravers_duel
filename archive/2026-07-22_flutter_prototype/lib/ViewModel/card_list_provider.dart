import 'dart:convert';
import 'package:bravers_duel/Model/card_model.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// 必要なimport: card_model.dart

final cardListProvider = FutureProvider<List<CardModel>>((ref) async {
  final jsonString = await rootBundle.loadString('lib/assets/json/cards.json');
  final List<dynamic> jsonList = json.decode(jsonString);
  return jsonList.map((e) => CardModel.fromJson(e)).toList();
});
