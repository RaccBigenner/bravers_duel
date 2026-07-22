import 'package:bravers_duel/Model/card_model.dart';
import 'package:bravers_duel/Widget/card_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

typedef CardTapCallback = void Function(CardModel card, int index);
typedef CardOverlayBuilder = Widget? Function(
    BuildContext context, CardModel card, int index);

class CardListView extends HookWidget {
  final List<CardModel> cards;
  final CardTapCallback? onTap;
  final CardTapCallback? onLongPress;
  final CardOverlayBuilder? overlayBuilder;
  final int crossAxisCount;
  final double spacing;
  final double runSpacing;
  final double? cardWidth;

  static const List<_CardTypeLabel> typeLabels = [
    _CardTypeLabel(typeCheck: _isCharacterCard, label: 'キャラクター'),
    _CardTypeLabel(typeCheck: _isSkillCard, label: 'スキル'),
    _CardTypeLabel(typeCheck: _isFieldCard, label: 'フィールド'),
    _CardTypeLabel(typeCheck: _isEquipmentCard, label: '装備'),
  ];

  const CardListView({
    super.key,
    required this.cards,
    this.onTap,
    this.onLongPress,
    this.overlayBuilder,
    this.crossAxisCount = 3,
    this.spacing = 6,
    this.runSpacing = 6,
    this.cardWidth,
  });

  @override
  Widget build(BuildContext context) {
    // 選択されたタイプごとに「typeCheck関数」を格納
    final selectedChecks = useState<Set<int>>({});

    // フィルタ後のリスト
    final filteredCards = selectedChecks.value.isEmpty
        ? cards
        : cards.where((c) {
            // 選択されているtypeCheckに一つでも合致すれば表示
            return selectedChecks.value
                .any((idx) => typeLabels[idx].typeCheck(c));
          }).toList();

    return Column(
      children: [
        // タイプセレクタ
        Padding(
          padding: EdgeInsets.symmetric(vertical: 8.w),
          child: Wrap(
            spacing: 2.w,
            children: List.generate(typeLabels.length, (idx) {
              final typeLabel = typeLabels[idx];
              final isSelected = selectedChecks.value.contains(idx);

              return FilterChip(
                label: Text(typeLabel.label),
                selected: isSelected,
                onSelected: (selected) {
                  final newSet = Set<int>.from(selectedChecks.value);
                  if (selected) {
                    newSet.add(idx);
                  } else {
                    newSet.remove(idx);
                  }
                  selectedChecks.value = newSet;
                },
                selectedColor:
                    Theme.of(context).colorScheme.primary.withOpacity(0.18),
                checkmarkColor: Theme.of(context).colorScheme.primary,
                labelStyle: TextStyle(
                  fontSize: 8.sp,
                  color: isSelected
                      ? Theme.of(context).colorScheme.primary
                      : Colors.black,
                ),
              );
            }),
          ),
        ),
        // カードリスト
        Expanded(
          child: GridView.builder(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: crossAxisCount,
              mainAxisSpacing: spacing.w,
              crossAxisSpacing: runSpacing.w,
              childAspectRatio: 0.7,
            ),
            itemCount: filteredCards.length,
            itemBuilder: (context, idx) {
              final card = filteredCards[idx];
              return LayoutBuilder(
                builder: (context, constraints) {
                  return GestureDetector(
                    onTap: onTap != null ? () => onTap!(card, idx) : null,
                    onLongPress: onLongPress != null
                        ? () => onLongPress!(card, idx)
                        : null,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        CardFrame(
                          card: card,
                          width: constraints.maxWidth,
                        ),
                        if (overlayBuilder != null)
                          overlayBuilder!(context, card, idx) ??
                              const SizedBox.shrink(),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

// 型判定用関数
bool _isCharacterCard(CardModel c) => c is CharacterCard;
bool _isSkillCard(CardModel c) => c is SkillCard;
bool _isFieldCard(CardModel c) => c is FieldCard;
bool _isEquipmentCard(CardModel c) => c is EquipmentCard;

class _CardTypeLabel {
  final bool Function(CardModel) typeCheck;
  final String label;
  const _CardTypeLabel({required this.typeCheck, required this.label});
}
