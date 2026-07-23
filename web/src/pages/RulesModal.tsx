/** 初心者向けのルール説明（やさしい日本語）。正しい情報源は docs/GAME_RULES.md */
export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog rules" onClick={(e) => e.stopPropagation()}>
        <h2>あそびかた</h2>
        <div className="rules-body">
          <section>
            <h3>勝ち負け</h3>
            <p>相手のキャラクターを<b>全て戦闘不能</b>にしたら勝ち！<br />
              相手の山札が切れて手札を5枚にできなくても勝ちです。</p>
          </section>
          <section>
            <h3>ターンの流れ</h3>
            <p>①<b>ドロー</b>: 手札が5枚になるまで引く<br />
              ②<b>プレイ</b>: スキルで攻撃したり、装備を付けたり<br />
              ③<b>チャージ</b>: 使わないカードをAP（エネルギー）にする<br />
              ④ターンエンドで相手の番へ</p>
          </section>
          <section>
            <h3>APとコスト</h3>
            <p>スキルを使うには<b>AP</b>が必要です。手札のカードをチャージするとAPになります（どのカードでもOK）。
              使ったAPはなくなるので、ためすぎ注意！チャージしすぎると山札が早く減ります。</p>
          </section>
          <section>
            <h3>アクター</h3>
            <p>前に出て戦っているキャラを<b>アクター</b>と呼びます（金色に光っているキャラ）。<br />
              スキルを使えるのはアクターだけ。<b>スキルを使うたびに次のキャラへ交代</b>します。
              攻撃が当たるのも相手のアクターです。</p>
          </section>
          <section>
            <h3>スキルの条件</h3>
            <p>スキルカードの左上の数字が<b>コストAP</b>、その下のアイコンが<b>必要な属性</b>です。
              アクターがその属性を持っていないと使えません。<b>明るく光っている手札＝今使えるカード</b>です。</p>
          </section>
          <section>
            <h3>ガード割り込み</h3>
            <p>相手に攻撃されたとき、手札の<b>ガードカード</b>で割り込んでダメージを減らせます。
              APは普通に必要。割り込みはガードカードだけの特権です。</p>
          </section>
          <section>
            <h3>その他のカード</h3>
            <p><b>キャラクターカード</b>: 場の同名キャラを2回復<br />
              <b>装備カード</b>: キャラに付けて強化（1キャラ1個・コストなし）<br />
              <b>フィールドカード</b>: 場全体のルールを変える（場に1枚）</p>
            <p className="rules-note">装備カードに描かれた属性は、スキルと違って<b>使うための条件ではありません</b>。
              装備したキャラに<b>その属性が追加されます</b>。
              属性が足りなくて使えなかったスキルも、装備で使えるようになります。</p>
          </section>
        </div>
        <button className="big-btn slim" onClick={onClose}>とじる</button>
      </div>
    </div>
  );
}
