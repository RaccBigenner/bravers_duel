#!/usr/bin/env python3
"""SR の内側背景（黒銀のヘアライン）を作る。

    python3 tools/gen_inner_background_gunmetal.py

`assets/card_images/inner_background_gunmetal.webp` を上書きする。
乱数の種を固定しているので、何度実行しても同じ絵になる。

---- なぜこんな作りなのか ----

AI に「黒銀の金属面」を描かせると、14枚生成して14枚とも
**明るい縦帯か光の玉**ができた。カードの地に使うと、そこが視線を吸って絵と競う。
さらに出力はたいてい何枚かの板の貼り合わせになっていて、境界で傷の細かさが変わる。

かといって数式だけで描くと、今度は線が等間隔で並んで「規則正しすぎる」。

そこで **傷の不規則さだけを AI の生成物から借り、均一さはこちらで作る**。
手順は下の関数の順番どおり。

素材は tools/sources/sr_gunmetal/ に置いてある（生成し直したものを 1200x1668 に縮めたもの）。
素材を差し替えれば傷の表情が変わる。地の明るさ・照り・傷の強さは build() の引数で変えられる。
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

W, H = 1200, 1668
HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE / 'sources' / 'sr_gunmetal'
OUT = HERE.parent / 'assets' / 'card_images' / 'inner_background_gunmetal.webp'

rng = np.random.default_rng(4)  # 固定。変えると傷の並びが変わる

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx, ny = xx / W, yy / H


def detail_from(path, sigma=60.0):
    """素材から「細かい傷」だけを取り出す。

    1. 大きくぼかした自分自身を引く → 明るい帯・光の玉が消える
    2. 列ごとの平均を引く → 貼り合わせの縦筋が消える
       （横方向のヘアラインなので、列平均は本来どこも同じはず。まるごと引いてよい）
    3. 行ごとの平均を「ぼかしてから」引く → 太い横帯・段差が消える
       （行平均は傷そのものを含むので、まるごと引くと傷まで消えてしまう）
    """
    a = np.asarray(Image.open(path).convert('L').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
    d = a - gaussian_filter(a, sigma)
    d -= d.mean(axis=0, keepdims=True)
    d -= gaussian_filter(d.mean(axis=1), 6.0)[:, None]
    s = np.std(d)
    return (d / s) if s > 1e-6 else d


def mirror_pad(a):
    """左右反転をつないで倍幅にする。どこを切り出しても端で途切れない"""
    return np.concatenate([a, a[:, ::-1]], axis=1)


def quilt(paths):
    """素材を横帯として積み上げ、1枚の傷の地figureにする。

    帯ごとに 元素材・切り出し位置・左右反転 を変えるので繰り返しに見えない。
    上下は三角形の重みでなじませるため、境目も出ない。
    これで「板の境界で傷の細かさが変わる」問題が消える（明るさの違いではないので
    引き算では消せず、貼り替えるしかない）。
    """
    srcs = [mirror_pad(detail_from(p)) for p in paths]
    out = np.zeros((H, W), np.float32)
    weight = np.zeros((H, W), np.float32)

    overlap = 90  # 帯どうしをなじませる幅
    y = 0
    while y < H:
        y2 = min(H, y + int(rng.integers(230, 380)))
        h = y2 - y

        src = srcs[int(rng.integers(0, len(srcs)))]
        sy = int(rng.integers(0, H - h)) if H - h > 0 else 0
        sx = int(rng.integers(0, W))  # 倍幅なのでどこから切っても幅が足りる
        patch = src[sy:sy + h, sx:sx + W].copy()
        if rng.random() < 0.5:
            patch = patch[:, ::-1]

        wv = np.ones(h, np.float32)
        fade = min(overlap, h // 2)
        if y > 0 and fade > 0:
            wv[:fade] = np.linspace(0, 1, fade, dtype=np.float32)
        if y2 < H and fade > 0:
            wv[-fade:] = np.linspace(1, 0, fade, dtype=np.float32)

        out[y:y2] += patch * wv[:, None]
        weight[y:y2] += wv[:, None]
        y = y2 - (fade if y2 < H else 0)

    d = out / np.maximum(weight, 1e-6)
    # 積み上げで生じた緩いムラと筋を、もう一度落とす
    d -= gaussian_filter(d, 70.0)
    d -= d.mean(axis=0, keepdims=True)
    d -= gaussian_filter(d.mean(axis=1), 6.0)[:, None]
    return d / (np.std(d) + 1e-6)


def vignette(strength=0.40, power=1.6):
    """四隅を落とす。既存の地（グレー・赤）と同じ処理なので他レアリティと揃う"""
    cx, cy = nx - 0.5, ny - 0.5
    r = np.sqrt((cx * 1.05) ** 2 + (cy * 0.95) ** 2) / 0.72
    return 1.0 - strength * np.clip(r, 0, 1) ** power


def sheen(center=0.58, spread=0.32, dirx=0.72, diry=0.58):
    """斜めに一枚だけ流す弱い照り。金属らしさはほぼこれが担う。
    2枚以上入れると光の筋が交差して視線を集めるので、1枚に留める"""
    return np.exp(-(((nx * dirx + ny * diry) - center) ** 2) / (2 * spread ** 2))


def build(d, out, lift=0.130, gloss=0.070, grain=0.030):
    """傷の地に、明るさ・照り・四隅の落ちを乗せて書き出す。

    lift  地の明るさ。0 に近いほど黒。0.090=暗 / 0.130=中（採用） / 0.175=明
    gloss 照りの強さ。lift と合わせて動かす
    grain 傷の出し具合。0.022=弱 / 0.030=中（採用） / 0.042=強
    """
    slow = gaussian_filter(rng.normal(0, 1, (H, W)).astype(np.float32), 120.0)
    slow /= (np.std(slow) + 1e-6)
    lum = lift + d * grain + slow * 0.006 + sheen() * gloss
    lum = np.clip(lum * vignette(), 0, 1)
    # 寒色に寄せて銀色に見せる。等倍だとほぼ分からないが、赤やグレーと並べると効く
    rgb = np.stack([lum * 1.0, lum * 1.025, lum * 1.085], -1)
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(out, quality=92, method=6)
    print(f'{out}  地の明るさ {lum.mean() * 255:.0f}/255')


if __name__ == '__main__':
    paths = sorted(SOURCE_DIR.glob('brushed_*.webp'))
    if not paths:
        raise SystemExit(f'素材が見つかりません: {SOURCE_DIR}')
    build(quilt(paths), OUT)
