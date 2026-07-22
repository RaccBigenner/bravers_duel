import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// ボタンタイプ（ポジティブ／ネガティブ／アクセント）
enum ButtonType { positive, negative, accent }

/// めちゃめちゃカッコ良い汎用ボタン
/// ・アイコンとテキストはそれぞれnull許容
/// ・onPressedもnull許容（nullなら無効化）/// ・ポジティブ／ネガティブ／アクセントの3スタイル対応
class BattleButton extends HookWidget {
  /// ボタン内に表示するアイコン（先頭）
  final Widget? icon;

  /// ボタン内に表示するテキスト
  final String? text;

  /// 押下時のコールバック（nullなら無効）
  final VoidCallback? onPressed;

  /// ボタンのビジュアルタイプ
  final ButtonType type;

  /// ボタンサイズ調整用のパディング
  final EdgeInsetsGeometry padding;

  const BattleButton({
    super.key,
    this.icon,
    this.text,
    this.onPressed,
    this.type = ButtonType.accent,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
  });

  @override
  Widget build(BuildContext context) {
    // 押下状態を管理
    final isPressed = useState(false);
    // 押下可能か
    final enabled = onPressed != null;

    // タイプごとの色設定
    final colors = _colorsFor(type, enabled: enabled);

    return GestureDetector(
      onTapDown: enabled ? (_) => isPressed.value = true : null,
      onTapUp: enabled
          ? (_) {
              isPressed.value = false;
              onPressed?.call();
            }
          : null,
      onTapCancel: enabled ? () => isPressed.value = false : null,
      child: AnimatedScale(
        scale: isPressed.value ? 0.96 : 1.0,
        duration: const Duration(milliseconds: 100),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: padding, // screenutil 対応
          decoration: BoxDecoration(
            gradient: enabled ? colors.gradient : _disabledGradient(),
            borderRadius: BorderRadius.circular(12.w),
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: colors.shadowColor.withOpacity(0.6),
                      blurRadius: 12.w,
                      spreadRadius: 2.w,
                      offset: Offset(0, 4.w),
                    ),
                  ]
                : null,
            border: Border.all(
              color: enabled ? Colors.transparent : Colors.grey.shade600,
              width: 1.w,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                IconTheme(
                  data: IconThemeData(
                    size: 24.w,
                    color: enabled ? colors.textColor : Colors.grey.shade400,
                  ),
                  child: icon!,
                ),
                SizedBox(width: text != null ? 8.w : 0),
              ],
              if (text != null)
                Text(
                  text!,
                  style: TextStyle(
                    fontSize: 16.sp,
                    fontWeight: FontWeight.bold,
                    color: enabled ? colors.textColor : Colors.grey.shade400,
                    shadows: enabled
                        ? [
                            Shadow(
                              color: colors.shadowColor.withOpacity(0.4),
                              offset: Offset(0, 2.w),
                              blurRadius: 4.w,
                            ),
                          ]
                        : null,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// タイプごとの色セット
class _ButtonColors {
  final Gradient gradient;
  final Color shadowColor;
  final Color textColor;
  _ButtonColors(this.gradient, this.shadowColor, this.textColor);
}

_ButtonColors _colorsFor(ButtonType type, {required bool enabled}) {
  switch (type) {
    case ButtonType.positive:
      return _ButtonColors(
        const LinearGradient(colors: [Colors.greenAccent, Colors.green]),
        Colors.green.shade900,
        Colors.white,
      );
    case ButtonType.negative:
      return _ButtonColors(
        const LinearGradient(colors: [Colors.redAccent, Colors.red]),
        Colors.red.shade900,
        Colors.white,
      );
    case ButtonType.accent:
    default:
      return _ButtonColors(
        const LinearGradient(colors: [Colors.blueAccent, Colors.indigo]),
        Colors.indigo.shade900,
        Colors.white,
      );
  }
}

/// 無効化時のグラデーション
Gradient _disabledGradient() => LinearGradient(
      colors: [Colors.grey.shade700, Colors.grey.shade800],
    );
