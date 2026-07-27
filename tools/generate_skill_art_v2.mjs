/**
 * スキルカードのイラスト生成 v2（OpenAI gpt-image-2）
 *
 * v1 の反省:
 *   プロンプトに「besieged fortress」などの例を書いたせいで、
 *   108枚すべてが「城壁 + 土埃の戦場 + 遠くの小さな人影 + 斜めの光の筋」になった。
 *
 * v2 の方針:
 *   場所・カメラ・時間帯/天候・配色・構図を、カードIDのハッシュから機械的に振り分ける。
 *   モデルに「自由に考えて」と言うと必ず同じ答えを出すので、こちらが振り幅を決める。
 *
 * 使い方:
 *   node tools/generate_skill_art_v2.mjs --test                   # 方向性の比較用サンプル
 *   node tools/generate_skill_art_v2.mjs --ids 1-A042-SR
 *   node tools/generate_skill_art_v2.mjs --all --skip-existing
 *   node tools/generate_skill_art_v2.mjs --all --style B --quality high
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY がありません');
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODEL = argValue('model') ?? 'gpt-image-2';
const QUALITY = argValue('quality') ?? 'medium';
const STYLE = argValue('style') ?? 'A';
const ONLY_IDS = argValue('ids')?.split(',');
const ALL = args.includes('--all');
const TEST = args.includes('--test');
const SKIP_EXISTING = args.includes('--skip-existing');
const OUT_DIR = argValue('out') ?? 'assets/card_images';
const MARK_DIR = 'tools/.generated_v2';

// ---------------------------------------------------------------- 絵柄の方向性
// 全108枚で「同じ画集から出てきた」と感じる統一感は、この1本だけで担保する。
// 場所や構図は下のバリエーション表で振るので、ここは絵柄の話だけを書く。
const STYLES = {
  // A: 現行路線の正統進化。水彩だが、にじみ任せにせず線と面をはっきりさせる
  A: [
    'Art direction: Japanese watercolor-and-ink illustration.',
    'Transparent watercolor washes with visible paper grain and hard-edged wet blooms,',
    'over confident dry-brush ink linework. Bold flat color shapes, not airbrushed gradients.',
    'Limited palette per image: two dominant hues plus one accent. Generous untouched paper as negative space.',
  ].join(' '),
  // B: 日本のデジタルTCG風。彩度と情報量で殴る、いちばんカードゲームらしい絵
  B: [
    'Art direction: high-end Japanese digital trading card game illustration.',
    'Painterly cel-shaded anime rendering, thick opaque brushwork, sharp specular highlights,',
    'saturated jewel-tone colors, strong rim light, dense rendered detail in the focal area and',
    'loose abstracted brushwork at the edges. Dramatic contrast, deep blacks.',
  ].join(' '),
  // C: ゲームのコンセプトアート風。厚塗りのグアッシュ、質感でAI臭を消す
  C: [
    'Art direction: hand-painted gouache concept art for a fantasy game.',
    'Opaque matte paint, chunky visible palette-knife and flat-brush strokes, slightly chalky texture,',
    'muted earthy base palette punched by one intensely saturated accent color.',
    'Shapes read at a glance; detail is suggested with a few decisive strokes, never rendered smooth.',
  ].join(' '),
};

// ------------------------------------------------------------ バリエーション表
// 「舞台」は v1 の失敗の中心。城と戦場だけを見せられたモデルは城しか描かない。
const SCENES = [
  'a frozen lake under a cracked ice sheet',
  'a narrow stone-paved market alley between tall shuttered houses',
  'the vaulted hall of an abandoned underground cistern',
  'a sea of clouds above jagged mountain peaks',
  'rolling desert dunes with half-buried pillars',
  'a towering library of leaning bookshelves',
  'a black-water swamp of drowned trees',
  'the rim of an active volcanic crater',
  'a windswept snowfield with a single road marker',
  'a dense bamboo grove striped with light',
  'a cliff-edge coastline hammered by surf',
  'floating ruins drifting in an empty sky',
  'a high mountain pass bridged by rope',
  'the marble throne hall of an emptied palace',
  'a rope bridge over a deep red canyon',
  'a golden wheat field before harvest',
  'a moonlit shrine gate on wet stone steps',
  'a working harbor of masts and cargo nets',
  'a blue crevasse inside a glacier',
  'a cavern of enormous quartz crystals',
  'a scorched grassland dotted with dead trees',
  'a rain-slick rooftop above a sleeping city',
  'a terraced rice paddy mirroring the sky',
  'the iron interior of a vast ruined machine',
  'a birch forest after fresh snow',
  'a dry riverbed of cracked clay',
  'a lantern-lit festival street at night',
  'a battlefield of broken siege engines',
  'the stone courtyard of a mountain monastery',
  'a coral shallows seen from just above the water',
];

const SHOTS = [
  'extreme close-up of the effect filling the frame, the environment only glimpsed at the edges',
  'wide establishing shot, the effect small but unmistakable against a vast landscape',
  'low camera angle looking steeply up, the effect towering over the viewer',
  "bird's-eye view looking almost straight down",
  'over-the-shoulder from behind a dark foreground silhouette',
  'macro detail: the exact instant of contact, everything else thrown out of focus',
  'the frame split by a strong foreground element the effect passes behind',
  'eye-level, the effect crossing the frame laterally at speed',
];

const MOMENTS = [
  'the split second before it lands, everything still',
  'the peak of the release, force at maximum',
  'the aftermath a heartbeat later, air still shaking',
  'mid-flight, the effect halfway to its target',
];

const LIGHTS = [
  'thin dawn mist, cold pale light',
  'harsh high noon, short black shadows',
  'golden hour, long warm rakes of light',
  'blue hour after sunset, deep cool shadows',
  'clear night, stars and a hard moon',
  'thunderstorm, rain sheets and sudden flashes',
  'heavy snowfall muting every sound',
  'thick fog that swallows the background',
  'overcast flat grey daylight',
  'an aurora burning green overhead',
];

const COMPOSITIONS = [
  'strong diagonal composition, subject on a third',
  'near-symmetrical centered composition',
  'spiral composition drawing the eye inward',
  'the subject framed through an opening in the foreground',
  'heavy negative space, subject pushed to one edge',
  'stacked horizontal bands, a calm and graphic layout',
];

const ATTR_MOTIF = {
  斬: 'clean blade arcs and cut trails',
  突: 'a single piercing thrust line',
  打: 'crushing impact and shockwave rings',
  射: 'arrows and shot trails in flight',
  飛: 'wind-borne flight, feathers and air streams',
  炎: 'flame and drifting embers',
  氷: 'ice crystal and frost shards',
  雷: 'lightning branches and electric sparks',
  風: 'gale spirals and torn air',
  土: 'earth, stone and dust bursts',
  木: 'growing vines, leaves and roots',
  聖: 'radiant golden light',
  闇: 'violet miasma and shadow tendrils',
  竜: 'draconic energy shaped like a dragon',
  獣: 'feral claw marks and beastly afterimages',
  補: 'glowing runes and drifting light motes',
  守: 'a barrier of hardened light',
};

const TYPE_MOOD = {
  attack: 'offensive force, violent and directional',
  guard: 'defensive force, solid and outward-blooming',
  support: 'a tactical, wondrous phenomenon, calm but strange',
  heal: 'gentle restorative light, warm and quiet',
};

/** カードIDから決まる疑似乱数。何度流しても同じ割り当てになる */
function hash(str, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
const pick = (arr, id, salt) => arr[hash(id, salt) % arr.length];

function buildPrompt(card, style = STYLE) {
  const motifs = [...new Set(card.conditionAttribute)].map((a) => ATTR_MOTIF[a]).filter(Boolean);
  const motifText = motifs.length > 0 ? motifs.join(' and ') : 'raw arcane energy';
  const flavor = card.flavorText ? ` Mood hint: 「${card.flavorText}」.` : '';
  return [
    `Illustration for a fantasy card game skill called "${card.name}".`,
    `What it does: ${card.effectText || 'a powerful straightforward technique'}.`,
    `The subject of the picture is the skill effect itself — ${TYPE_MOOD[card.valueType]} — rendered as ${motifText}.${flavor}`,
    `Setting: ${pick(SCENES, card.id, 1)}.`,
    `Lighting and weather: ${pick(LIGHTS, card.id, 2)}.`,
    `Camera: ${pick(SHOTS, card.id, 3)}.`,
    `Timing: ${pick(MOMENTS, card.id, 4)}.`,
    `Layout: ${pick(COMPOSITIONS, card.id, 5)}.`,
    'Human figures, if any, are distant or silhouetted and never the subject. No close-up faces.',
    STYLES[style],
    'Absolutely no text, letters, numbers, logos, watermarks, card frames or borders. Full-bleed artwork to all four edges.',
  ].join(' ');
}

async function generateOne(card, { style = STYLE, suffix = '' } = {}) {
  const isUsr = card.rarity === 'USR'; // USRは全面アート（縦長）
  const size = isUsr ? '1024x1536' : '1536x1024';
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, prompt: buildPrompt(card, style), size, quality: QUALITY, n: 1 }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error('画像データがありません');

  const png = Buffer.from(b64, 'base64');
  const width = isUsr ? 768 : 1152;
  const webp = await sharp(png).resize({ width }).webp({ quality: 82 }).toBuffer();
  writeFileSync(`${OUT_DIR}/${card.id}${suffix}.webp`, webp);
  if (!suffix) writeFileSync(`${MARK_DIR}/${card.id}`, new Date().toISOString());
  return webp.length;
}

// ------------------------------------------------------------------------ 実行
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(MARK_DIR, { recursive: true });
const cards = JSON.parse(readFileSync('data/cards.json', 'utf8'));
const skills = cards.filter((c) => c.type === 'skill');

/** 方向性A/B/C を同じカードで見比べるためのお試し出力 */
const TEST_IDS = ['1-A042-SR', '1-A107-UC', '1-A122-C', '1-A077-R'];
let jobs;
if (TEST) {
  jobs = [];
  for (const id of TEST_IDS) {
    const card = skills.find((c) => c.id === id);
    for (const style of ['A', 'B', 'C']) jobs.push({ card, style, suffix: `__${style}` });
  }
} else {
  let target = skills;
  if (ONLY_IDS) target = target.filter((c) => ONLY_IDS.includes(c.id));
  else if (!ALL) {
    console.error('--ids か --all か --test を指定してください');
    process.exit(1);
  }
  if (SKIP_EXISTING) target = target.filter((c) => !existsSync(`${MARK_DIR}/${c.id}`));
  jobs = target.map((card) => ({ card, style: STYLE, suffix: '' }));
}

const CONCURRENCY = Number(argValue('concurrency') ?? 4);
const total = jobs.length;
let done = 0;
const failed = [];

async function worker() {
  while (jobs.length > 0) {
    const job = jobs.shift();
    try {
      const bytes = await generateOne(job.card, job);
      done++;
      console.log(`OK ${job.card.id}${job.suffix} ${job.card.name} (${Math.round(bytes / 1024)}KB) [${done}/${total}]`);
    } catch (e) {
      failed.push(job.card.id + job.suffix);
      console.error(`NG ${job.card.id}${job.suffix} ${job.card.name}: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n完了: ${done}枚 / 失敗: ${failed.length}枚 ${failed.join(',')}`);
