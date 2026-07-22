import 'package:flutter/material.dart';

class OutlinedText extends StatelessWidget {
  final String text;
  final TextStyle style;
  final double strokeWidth;
  final Color strokeColor;
  final TextAlign textAlign;

  const OutlinedText({
    super.key,
    required this.text,
    required this.style,
    this.strokeWidth = 2,
    this.strokeColor = Colors.white,
    this.textAlign = TextAlign.left,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // 縁取り（白など）
        Text(
          text,
          style: style.copyWith(
            foreground: Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = strokeWidth
              ..color = strokeColor,
          ),
          textAlign: textAlign,
        ),
        // 本体
        Text(
          text,
          style: style,
          textAlign: textAlign,
        ),
      ],
    );
  }
}
