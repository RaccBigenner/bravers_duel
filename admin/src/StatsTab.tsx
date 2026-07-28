/**
 * 弾の集計タブ。
 * 「この弾に何がどれだけ入っているか」を一目で見るための画面。
 * バランスの判断材料なので、数だけでなく割合の棒も出す。
 */
import type { MasterCard } from './api';
import { computeStats } from './order';

interface Props {
  cards: MasterCard[];
  images: Record<string, string>;
}

/** 数と割合を横棒で見せる小さな表 */
function Bars({ rows, total }: { rows: { key: string; label?: string; count: number; sub?: string }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <table className="stats-bars">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th>{r.label ?? r.key}</th>
            <td className="bar-cell">
              <span className="bar" style={{ width: `${(r.count / max) * 100}%` }} />
            </td>
            <td className="num">{r.count}</td>
            <td className="pct">{total > 0 ? `${Math.round((r.count / total) * 100)}%` : '-'}</td>
            {rows.some((x) => x.sub) && <td className="sub">{r.sub ?? ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatsTab({ cards, images }: Props) {
  const s = computeStats(cards, images);
  const skills = cards.filter((c) => c.type === 'skill').length;

  if (s.total === 0) return <p className="stats-empty">この弾にはまだカードがありません。</p>;

  return (
    <div className="stats-tab">
      <div className="stats-head">
        <span>
          全<b>{s.total}</b>枚
        </span>
        <span className={s.noImage ? 'warn' : ''}>画像なし {s.noImage}枚</span>
      </div>

      <section>
        <h3>種類</h3>
        <Bars rows={s.byType} total={s.total} />
      </section>

      <section>
        <h3>レアリティ</h3>
        <Bars rows={s.byRarity} total={s.total} />
      </section>

      {skills > 0 && (
        <>
          <section>
            <h3>スキルの種別</h3>
            <Bars rows={s.byValueType} total={skills} />
          </section>
          <section>
            <h3>スキルの消費AP</h3>
            <Bars rows={s.byCost.map((c) => ({ key: String(c.cost), label: `AP${c.cost}`, count: c.count }))} total={skills} />
          </section>
        </>
      )}

      <section>
        <h3>属性の使われ方</h3>
        <p className="stats-note">
          延べ数（同じカードが同じ属性を重ねて持つ場合は重複して数える）と、使っているカードの枚数。
        </p>
        <Bars
          rows={s.byAttribute.map((a) => ({ key: a.key, count: a.count, sub: `${a.cards}枚` }))}
          total={s.byAttribute.reduce((sum, a) => sum + a.count, 0)}
        />
      </section>
    </div>
  );
}
