import 'dart:math' as math;
import 'package:flutter/material.dart';

class TiltWidget extends StatefulWidget {
  final Widget child;
  final double maxAngle; // 傾きの最大角度（度）

  const TiltWidget({
    super.key,
    required this.child,
    this.maxAngle = 30.0, // 最大角度（内部で縮小補正）
  });

  @override
  State<TiltWidget> createState() => _TiltWidgetState();
}

class _TiltWidgetState extends State<TiltWidget> {
  double _rotationX = 0.0;
  double _rotationY = 0.0;

  void _updateRotation(Offset localPosition, Size size) {
    final dx = localPosition.dx / size.width - 0.5;
    final dy = localPosition.dy / size.height - 0.5;

    final maxRadian = widget.maxAngle * math.pi / 180;

    setState(() {
      // Y軸は小さめに（左右傾き）
      _rotationY = -dx * maxRadian * 0.5;

      // X軸はやや強め（上下傾き）、特に手前方向（dy > 0）を強調
      _rotationX = dy >= 0
          ? dy * maxRadian * 1.2 // 下方向（手前）強調
          : dy * maxRadian * 0.6; // 上方向（奥）は弱め
    });
  }

  void _resetRotation() {
    setState(() {
      _rotationX = 0.0;
      _rotationY = 0.0;
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      return GestureDetector(
        onPanUpdate: (details) {
          _updateRotation(details.localPosition, constraints.biggest);
        },
        onPanEnd: (_) => _resetRotation(),
        onPanCancel: _resetRotation,
        child: Transform(
          alignment: Alignment.center,
          transform: Matrix4.identity()
            ..setEntry(3, 2, 0.001)
            ..rotateX(_rotationX)
            ..rotateY(_rotationY),
          child: widget.child,
        ),
      );
    });
  }
}
