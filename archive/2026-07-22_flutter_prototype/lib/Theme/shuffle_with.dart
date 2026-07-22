import 'dart:math';

extension ShuffleExtension<E> on List<E> {
  void shuffleWith([Random? random]) => shuffle(random ?? Random());
}
