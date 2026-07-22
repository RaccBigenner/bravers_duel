import 'package:flutter/material.dart';

/// 汎用グラデーション取得関数（レアリティに限らず使用可）
LinearGradient? getCardGradient(String key) {
  switch (key) {
    case 'C': // 明るめのグレー
      return const LinearGradient(
        colors: [
          Color(0xFFeeeeee),
          Color(0xFFf8f8f8),
          Color(0xFFdcdcdc),
        ],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );

    case 'R': // 銀
      return const LinearGradient(
        colors: [
          Color(0xFFD9D9D9),
          Color(0xFFBFBFBF),
          Color(0xFFEEEEEE),
        ],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );

    case 'SR': // 金
      return const LinearGradient(
        colors: [
          Color(0xFFFFF8DC), // cornsilk
          Color(0xFFFFD700), // gold
          Color(0xFFFFE135), // banana yellow
        ],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );

    case 'USR': // 虹
      return const LinearGradient(
        colors: [
          Colors.red,
          Colors.orange,
          Colors.yellow,
          Colors.green,
          Colors.blue,
          Colors.indigo,
          Colors.purple,
        ],
        stops: [0.0, 0.16, 0.32, 0.48, 0.64, 0.80, 1.0],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );

    default:
      return null;
  }
}
