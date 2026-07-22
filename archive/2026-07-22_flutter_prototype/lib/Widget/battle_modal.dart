import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// 汎用バトルモーダルウィジェット
/// - 任意の child を中央に表示可能
/// - エントリーアニメーション付きのスケール＆フェード
/// - 背景タップ／クローズボタンで dismiss
class BattleModal extends HookWidget {
  /// 中央に配置するコンテンツ
  final Widget child;

  /// モーダルを閉じる際のコールバック
  final VoidCallback? onClose;

  /// アニメーション時間
  final Duration duration;

  const BattleModal({
    super.key,
    required this.child,
    this.onClose,
    this.duration = const Duration(milliseconds: 300),
  });

  @override
  Widget build(BuildContext context) {
    // アニメーションコントローラ
    final controller = useAnimationController(duration: duration)..forward();
    // スケールアニメーション（弾むようなイージング）
    final scale = CurvedAnimation(
      parent: controller,
      curve: Curves.elasticOut,
    );
    // 背景フェードイン
    final fade = Tween<double>(begin: 0.0, end: 0.95).animate(
      CurvedAnimation(parent: controller, curve: Curves.linear),
    );

    return FadeTransition(
      opacity: fade,
      child: Stack(
        children: [
          // 背景オーバーレイ（タップで閉じる）
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onClose,
          ),
          // 中央ポップアップ
          Center(
            child: ScaleTransition(
                scale: scale,
                child: Material(
                  child: Container(
                    padding: EdgeInsets.all(16.w),
                    decoration: BoxDecoration(
                      // 放射状グラデーション背景
                      gradient: const RadialGradient(
                        colors: [Colors.redAccent, Colors.deepPurple],
                        radius: 0.85,
                      ),
                      // 光沢ボーダー＆シャドウ
                      boxShadow: [
                        BoxShadow(
                          color: Colors.redAccent.withOpacity(0.6),
                          blurRadius: 12.w,
                          spreadRadius: 4.w,
                        ),
                        BoxShadow(
                          color: Colors.deepPurple.withOpacity(0.6),
                          blurRadius: 12.w,
                          spreadRadius: 4.w,
                        ),
                      ],
                    ),
                    child: Stack(
                      children: [
                        // メインコンテンツ
                        child,
                      ],
                    ),
                  ),
                )),
          ),
        ],
      ),
    );
  }
}
